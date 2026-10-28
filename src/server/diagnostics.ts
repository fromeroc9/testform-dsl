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

  // 3. Check @depends_on("...")
  const dependsOnRegex = /@depends_on\s*\(\s*([^)]*)\s*\)/g;
  while ((match = dependsOnRegex.exec(text)) !== null) {
    const argsContent = match[1].trim();
    const matchOffset = match.index;

    // Check for empty dependency: @depends_on("") or @depends_on()
    if (!argsContent || argsContent === '""' || argsContent === "''") {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: textDocument.positionAt(matchOffset),
          end: textDocument.positionAt(matchOffset + match[0].length)
        },
        message: `Error en directiva: @depends_on no puede tener un destino vacío. Especifica una referencia como '@tc-1' o 'modulo/login.case.feature.@tc-1'.`,
        source: 'Testform'
      });
      continue;
    }

    const targetMatches = [...argsContent.matchAll(/["']([^"']*)["']/g)];
    for (const tm of targetMatches) {
      const targetAddress = tm[1].trim();

      if (!targetAddress) {
        const startOffset = matchOffset + (tm.index || 0);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: textDocument.positionAt(startOffset),
            end: textDocument.positionAt(startOffset + tm[0].length)
          },
          message: `Error en directiva: la referencia de dependencia no puede estar vacía.`,
          source: 'Testform'
        });
        continue;
      }

      // 3.1 Internal reference (starts with @, e.g. @tc-1) -> must exist in the same feature file
      if (targetAddress.startsWith('@')) {
        const tagRegex = new RegExp(`^\\s*${targetAddress.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm');
        if (!tagRegex.test(text)) {
          const startOffset = matchOffset + (tm.index || 0);
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: textDocument.positionAt(startOffset),
              end: textDocument.positionAt(startOffset + tm[0].length)
            },
            message: `Referencia interna no encontrada: el tag '${targetAddress}' no existe en este archivo feature.`,
            source: 'Testform'
          });
        }
      } else {
        // 3.2 External reference (contains path or .feature) -> check in workspace addresses
        const targetExists = scanner.config.scenarioAddresses.has(targetAddress);
        if (!targetExists) {
          const startOffset = matchOffset + (tm.index || 0);
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: textDocument.positionAt(startOffset),
              end: textDocument.positionAt(startOffset + tm[0].length)
            },
            message: `Referencia de dependencia no encontrada: '${targetAddress}' no existe en el workspace.`,
            source: 'Testform'
          });
        }
      }
    }
  }

  // 4. Check for duplicate identity tags WITHIN THIS SAME FEATURE FILE
  const lines = text.split(/\r?\n/);
  const seenTagsInFile = new Map<string, number>(); // tag -> first line 0-based

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idMatches = [...line.matchAll(/@(tc|tr|tp)-([0-9]+)/gi)];
    for (const idMatch of idMatches) {
      const tag = idMatch[0].toLowerCase();
      if (seenTagsInFile.has(tag)) {
        const firstLine = seenTagsInFile.get(tag)!;
        const tagCol = line.indexOf(idMatch[0]);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: i, character: tagCol },
            end: { line: i, character: tagCol + idMatch[0].length }
          },
          message: `ID de escenario duplicado en este archivo: '${idMatch[0]}' ya fue declarado en la línea ${firstLine + 1}.`,
          source: 'Testform'
        });
      } else {
        seenTagsInFile.set(tag, i);
      }
    }
  }

  // 5. Validate Resource tags vs configured patterns in main.yml
  const uri = textDocument.uri.toLowerCase();
  const tcPattern = scanner.config.scopes.testcase || '*.case.feature';
  const trPattern = scanner.config.scopes.testrun || '*.run.feature';
  const tpPattern = scanner.config.scopes.testplan || '*.plan.feature';

  const matchesPattern = (pathStr: string, pattern: string) => {
    const cleanPattern = pattern.replace(/\*/g, '.*');
    return new RegExp(`${cleanPattern}$`, 'i').test(pathStr);
  };

  if (matchesPattern(uri, tcPattern)) {
    if (!text.includes('@testcase')) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: `Aviso de Resource: El archivo coincide con '${tcPattern}' pero no incluye la etiqueta de recurso '@testcase'.`,
        source: 'Testform'
      });
    }
  } else if (matchesPattern(uri, trPattern)) {
    if (!text.includes('@testrun')) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: `Aviso de Resource: El archivo coincide con '${trPattern}' pero no incluye la etiqueta de recurso '@testrun'.`,
        source: 'Testform'
      });
    }
  } else if (matchesPattern(uri, tpPattern)) {
    if (!text.includes('@testplan')) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: `Aviso de Resource: El archivo coincide con '${tpPattern}' pero no incluye la etiqueta de recurso '@testplan'.`,
        source: 'Testform'
      });
    }
  }

  return diagnostics;
}
