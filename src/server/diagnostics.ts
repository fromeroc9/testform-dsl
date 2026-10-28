import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceScanner } from './workspace-scanner';

export function validateTextDocument(
  textDocument: TextDocument,
  scanner: WorkspaceScanner
): Diagnostic[] {
  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  // 1. Check for undeclared variables in ${var.name}
  const varRegex = /\$\{var\.([a-zA-Z0-9_]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = varRegex.exec(text)) !== null) {
    const varName = match[1];
    if (!scanner.config.variables.has(varName)) {
      const startPos = textDocument.positionAt(match.index);
      const endPos = textDocument.positionAt(match.index + match[0].length);

      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: { start: startPos, end: endPos },
        message: `Variable no declarada: 'var.${varName}'. Declárala en variable.yml o un manifiesto YAML del workspace.`,
        source: 'Testform'
      });
    }
  }

  // 2. Check for undeclared locals in ${local.name}
  const localRegex = /\$\{local\.([a-zA-Z0-9_]+)\}/g;
  while ((match = localRegex.exec(text)) !== null) {
    const localName = match[1];
    if (!scanner.config.locals.has(localName)) {
      const startPos = textDocument.positionAt(match.index);
      const endPos = textDocument.positionAt(match.index + match[0].length);

      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: { start: startPos, end: endPos },
        message: `Local no definido: 'local.${localName}'. Defínelo en un bloque 'locals:' en el workspace.`,
        source: 'Testform'
      });
    }
  }

  // 3. Check for broken @depends_on("...")
  const dependsOnRegex = /@depends_on\s*\(\s*([^)]+)\s*\)/g;
  while ((match = dependsOnRegex.exec(text)) !== null) {
    const argsContent = match[1];
    const matchOffset = match.index;
    const targetMatches = [...argsContent.matchAll(/["']([^"']+)["']/g)];

    for (const tm of targetMatches) {
      const targetAddress = tm[1];
      const targetExists = scanner.config.scenarioAddresses.has(targetAddress) || scanner.config.scenarios.has(targetAddress);

      if (!targetExists) {
        const startOffset = matchOffset + (tm.index || 0);
        const endOffset = startOffset + tm[0].length;

        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: textDocument.positionAt(startOffset),
            end: textDocument.positionAt(endOffset)
          },
          message: `Referencia de dependencia no encontrada: '${targetAddress}' no existe en el workspace.`,
          source: 'Testform'
        });
      }
    }
  }

  // 4. Check for duplicate identity tags in workspace
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idMatch = line.match(/@(tc|tr|tp)-([0-9]+)/i);
    if (idMatch) {
      const tag = idMatch[0].toLowerCase();
      const duplicates = scanner.config.duplicateScenarioTags.get(tag);
      if (duplicates && duplicates.length > 1) {
        const tagCol = line.indexOf(idMatch[0]);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: i, character: tagCol },
            end: { line: i, character: tagCol + idMatch[0].length }
          },
          message: `ID de escenario duplicado: '${idMatch[0]}' está definido en múltiples archivos (${duplicates.join(', ')}).`,
          source: 'Testform'
        });
      }
    }
  }

  // 5. Validate scope tags vs filename convention
  const uri = textDocument.uri.toLowerCase();

  if (uri.endsWith('.case.feature')) {
    if (!text.includes('@testcase')) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: `Scope Warning: Feature file matching '*.case.feature' is missing the root '@testcase' scope tag.`,
        source: 'Testform'
      });
    }
  } else if (uri.endsWith('.run.feature')) {
    if (!text.includes('@testrun')) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: `Scope Warning: Feature file matching '*.run.feature' is missing the root '@testrun' scope tag.`,
        source: 'Testform'
      });
    }
  } else if (uri.endsWith('.plan.feature')) {
    if (!text.includes('@testplan')) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: `Scope Warning: Feature file matching '*.plan.feature' is missing the root '@testplan' scope tag.`,
        source: 'Testform'
      });
    }
  }

  return diagnostics;
}
