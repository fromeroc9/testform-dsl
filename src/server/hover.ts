import { Hover, MarkupKind, Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceScanner } from './workspace-scanner';

export function provideHover(
  document: TextDocument,
  position: Position,
  scanner: WorkspaceScanner
): Hover | null {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Match expressions: ${...}
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

        if (info) {
          const fileName = info.sourceFile.split(/[/\\]/).pop();
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: [
                `### Testform Variable: \`${varName}\``,
                `**Type:** \`${info.type || 'string'}\``,
                `**Default:** \`${JSON.stringify(info.defaultValue ?? null)}\``,
                info.description ? `**Description:** ${info.description}` : '',
                `---`,
                `*Declarado en:* \`${fileName}\` (${info.sourceFile})`
              ].filter(Boolean).join('\n\n')
            }
          };
        } else {
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: `⚠️ **Variable no declarada:** \`${varName}\`\n\nEsta variable está referenciada pero no ha sido declarada en ningún bloque \`variable:\` del workspace.`
            }
          };
        }
      }

      // Check local.<name>
      const localMatch = exprContent.match(/\blocal\.([a-zA-Z0-9_]+)\b/);
      if (localMatch) {
        const localName = localMatch[1];
        const info = scanner.config.locals.get(localName);

        if (info) {
          const fileName = info.sourceFile.split(/[/\\]/).pop();
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: [
                `### Testform Local: \`${localName}\``,
                `**Expression:** \`${info.expression}\``,
                `---`,
                `*Declarado en:* \`${fileName}\` (${info.sourceFile})`
              ].join('\n\n')
            }
          };
        } else {
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: `⚠️ **Local no definido:** \`${localName}\`\n\nEste valor local está referenciado pero no ha sido definido en ningún bloque \`locals:\` del workspace.`
            }
          };
        }
      }

      // Check module.<name>.<output>
      const modMatch = exprContent.match(/\bmodule\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\b/);
      if (modMatch) {
        const modName = modMatch[1];
        const outName = modMatch[2];
        const modInfo = scanner.declaredModules.get(modName);
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: [
              `### Testform Module Output: \`${modName}.${outName}\``,
              modInfo ? `**Module Source:** \`${modInfo.source}\`` : `*Custom declared module*`,
              `---`,
              `*Exported output attribute from module*`
            ].join('\n\n')
          }
        };
      }

      // Check data.<name> or data.<type>.<name>
      const dataMatch = exprContent.match(/\bdata\.([a-zA-Z0-9_.]+)\b/);
      if (dataMatch) {
        const dataKey = dataMatch[1];
        const info = scanner.config.dataSources.get(dataKey);

        if (info) {
          const fileName = info.sourceFile.split(/[/\\]/).pop();
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: [
                `### Testform Data Source: \`${dataKey}\``,
                `**Type:** \`${info.type}\``,
                `**Instance:** \`${info.name}\``,
                `---`,
                `*Declarado en:* \`${fileName}\` (${info.sourceFile})`
              ].join('\n\n')
            }
          };
        }
      }
    }
  }

  // Line context hover
  const lineText = document.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 }
  });

  // 2. Hover on @depends_on("...")
  const dependsOnMatch = lineText.match(/@depends_on\s*\(\s*([^)]+)\s*\)/);
  if (dependsOnMatch) {
    // Check if cursor is on one of the targets
    const targetMatches = [...dependsOnMatch[1].matchAll(/["']([^"']+)["']/g)];
    for (const tm of targetMatches) {
      const address = tm[1];
      const targetScenario = scanner.config.scenarioAddresses.get(address) || scanner.config.scenarios.get(address);
      if (targetScenario) {
        const fileName = targetScenario.sourceFile.split(/[/\\]/).pop();
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: [
              `### Testform Dependency: \`${targetScenario.tag}\``,
              `**Scenario:** ${targetScenario.title}`,
              `**Scope:** \`${targetScenario.scope}\``,
              `**Address:** \`${targetScenario.address}\``,
              `---`,
              `*Target Defined in:* \`${fileName}\` (line ${targetScenario.line + 1})`
            ].join('\n\n')
          }
        };
      }
    }
  }

  // 3. Hover on Identity Tag: @tc-X, @tr-X, @tp-X
  const idTagMatch = lineText.match(/@(tc|tr|tp)-[0-9]+/i);
  if (idTagMatch) {
    const tag = idTagMatch[0].toLowerCase();
    const scenario = scanner.config.scenarios.get(tag);
    if (scenario) {
      const fileName = scenario.sourceFile.split(/[/\\]/).pop();
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: [
            `### Testform Scenario Identity: \`${scenario.tag}\``,
            `**Title:** ${scenario.title}`,
            `**Scope:** \`${scenario.scope}\``,
            `**Ledger Address:** \`${scenario.address}\``,
            `---`,
            `*File:* \`${fileName}\` (line ${scenario.line + 1})`
          ].join('\n\n')
        }
      };
    }
  }

  // 4. Hover on DSL Status: * mark status = [status]
  const statusMatch = lineText.match(/mark\s+status\s*=\s*([a-zA-Z]+)/i);
  if (statusMatch) {
    const status = statusMatch[1].toLowerCase();
    const STATUS_DOCS: Record<string, string> = {
      passed: 'Test passed successfully. Reconciles state ledger to mark resource passed.',
      failed: 'Test failed. Signals assertion error in testrun and halts execution pipeline if critical.',
      pending: 'Test is scheduled but pending execution. Leaves ledger in pending state.',
      skipped: 'Test execution was skipped due to unsatisfied conditions or tag filters.',
      blocked: 'Test is blocked by a prerequisite or unresolved dependency in @depends_on.',
      unexecuted: 'Initial state before execution run is applied.'
    };
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### Testform Execution Status: \`${status}\``,
          STATUS_DOCS[status] || `Declared execution outcome status for this scenario.`
        ].join('\n\n')
      }
    };
  }

  // 5. Match tags hover: @module(...)
  const moduleMatch = lineText.match(/@module\s*\(\s*(?:name\s*=\s*)?["']?([^"',\s)]+)["']?/);
  if (moduleMatch) {
    const modName = moduleMatch[1];
    const isInstalled = scanner.installedModules.includes(modName);
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### Testform Module: \`${modName}\``,
          isInstalled
            ? `✅ Installed in \`.testform/modules/${modName}\``
            : `⚠️ Not yet installed in \`.testform/modules/\`. Run \`testform init\` to download.`
        ].join('\n\n')
      }
    };
  }

  return null;
}
