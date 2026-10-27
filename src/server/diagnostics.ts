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

      const range: Range = {
        start: startPos,
        end: endPos
      };

      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range,
        message: `Undeclared variable 'var.${varName}'. Declare it in main.yml, variables.yml, or a domain YAML manifest.`,
        source: 'Testform'
      });
    }
  }

  // 2. Validate scope tags vs filename convention
  const uri = textDocument.uri.toLowerCase();
  const lines = text.split('\n');

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
