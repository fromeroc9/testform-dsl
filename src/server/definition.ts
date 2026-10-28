import { Definition, Location, Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { pathToFileURL } from 'url';
import { WorkspaceScanner } from './workspace-scanner';

export function provideDefinition(
  document: TextDocument,
  position: Position,
  scanner: WorkspaceScanner
): Definition | null {
  const text = document.getText();
  const offset = document.offsetAt(position);

  const exprRegex = /\$\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = exprRegex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (offset >= start && offset <= end) {
      const exprContent = match[1].trim();

      // Check var.<name>
      const varMatch = exprContent.match(/\bvar\.([a-zA-Z0-9_]+)\b/);
      if (varMatch) {
        const varName = varMatch[1];
        const info = scanner.config.variables.get(varName);
        if (info && info.sourceFile) {
          const uri = pathToFileURL(info.sourceFile).href;
          const range: Range = {
            start: { line: info.line, character: 0 },
            end: { line: info.line, character: 100 }
          };
          return Location.create(uri, range);
        }
      }

      // Check local.<name>
      const localMatch = exprContent.match(/\blocal\.([a-zA-Z0-9_]+)\b/);
      if (localMatch) {
        const localName = localMatch[1];
        const info = scanner.config.locals.get(localName);
        if (info && info.sourceFile) {
          const uri = pathToFileURL(info.sourceFile).href;
          const range: Range = {
            start: { line: info.line, character: 0 },
            end: { line: info.line, character: 100 }
          };
          return Location.create(uri, range);
        }
      }

      // Check data.<name> or data.<type>.<name>
      const dataMatch = exprContent.match(/\bdata\.([a-zA-Z0-9_.]+)\b/);
      if (dataMatch) {
        const dataKey = dataMatch[1];
        const info = scanner.config.dataSources.get(dataKey);
        if (info && info.sourceFile) {
          const uri = pathToFileURL(info.sourceFile).href;
          const range: Range = {
            start: { line: info.line, character: 0 },
            end: { line: info.line, character: 100 }
          };
          return Location.create(uri, range);
        }
      }

      // Check module.<name>
      const modMatch = exprContent.match(/\bmodule\.([a-zA-Z0-9_]+)\b/);
      if (modMatch) {
        const modName = modMatch[1];
        const modInfo = scanner.declaredModules.get(modName);
        if (modInfo && modInfo.source) {
          const modUri = pathToFileURL(modInfo.source).href;
          return Location.create(modUri, { start: { line: 0, character: 0 }, end: { line: 0, character: 100 } });
        }
      }
    }
  }

  // 2. Line context: Go to definition on @depends_on("...")
  const lineText = document.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 }
  });

  const dependsOnMatch = lineText.match(/@depends_on\s*\(\s*([^)]+)\s*\)/);
  if (dependsOnMatch) {
    const targetMatches = [...dependsOnMatch[1].matchAll(/["']([^"']+)["']/g)];
    for (const tm of targetMatches) {
      const address = tm[1].trim();
      if (!address) continue;

      if (address.startsWith('@')) {
        // Internal reference to tag in the current feature file
        const lines = document.getText().split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (i !== position.line && new RegExp(`^\\s*${address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lines[i])) {
            return Location.create(document.uri, {
              start: { line: i, character: 0 },
              end: { line: i, character: 100 }
            });
          }
        }
      } else {
        // External reference by address
        const targetScenario = scanner.config.scenarioAddresses.get(address) || scanner.config.scenarios.get(address);
        if (targetScenario) {
          const uri = pathToFileURL(targetScenario.sourceFile).href;
          return Location.create(uri, {
            start: { line: targetScenario.line, character: 0 },
            end: { line: targetScenario.line, character: 100 }
          });
        }
      }
    }
  }

  // 3. Line context: Rule file reference (e.g. Rule: auth/login.case.feature or Rule: suites/smoke.run.feature)
  const ruleMatch = lineText.match(/^(?:\s*Rule|\s*Regla):\s*([a-zA-Z0-9_./-]+\.(?:case|run|plan)\.feature)/i);
  if (ruleMatch) {
    const rawPath = ruleMatch[1].trim();
    const feat = scanner.featureFiles.get(rawPath) ||
      [...scanner.featureFiles.values()].find(f => f.relPath.endsWith(rawPath) || f.fullPath.endsWith(rawPath));
    if (feat) {
      return Location.create(pathToFileURL(feat.fullPath).href, {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 100 }
      });
    }
  }

  // 3.1 Line context: Scenario address in Testrun (e.g. Scenario: login.case.feature.@tc-1)
  const addrMatch = lineText.match(/([a-zA-Z0-9_./-]+\.(?:case|run|plan)\.feature(?:\.@(?:tc|tr|tp)-[0-9]+)?)/i);
  if (addrMatch) {
    const rawAddr = addrMatch[1];
    const targetScenario = scanner.config.scenarioAddresses.get(rawAddr);
    if (targetScenario) {
      const uri = pathToFileURL(targetScenario.sourceFile).href;
      return Location.create(uri, {
        start: { line: targetScenario.line, character: 0 },
        end: { line: targetScenario.line, character: 100 }
      });
    }
    // If it's a file without scenario, jump to start of file
    const feat = scanner.featureFiles.get(rawAddr) ||
      [...scanner.featureFiles.values()].find(f => f.relPath.endsWith(rawAddr) || f.fullPath.endsWith(rawAddr));
    if (feat) {
      return Location.create(pathToFileURL(feat.fullPath).href, {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 100 }
      });
    }
  }

  // 4. Line context: @tc-X reference in step or tag
  const tcTagMatch = lineText.match(/@(tc|tr|tp)-([0-9]+)/i);
  if (tcTagMatch) {
    const tag = `@${tcTagMatch[1].toLowerCase()}-${tcTagMatch[2]}`;
    const scenario = scanner.config.scenarios.get(tag);
    if (scenario) {
      const uri = pathToFileURL(scenario.sourceFile).href;
      return Location.create(uri, {
        start: { line: scenario.line, character: 0 },
        end: { line: scenario.line, character: 100 }
      });
    }
  }

  return null;
}
