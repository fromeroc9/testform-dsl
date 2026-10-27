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

      // Check data.<type>.<name>
      const dataMatch = exprContent.match(/\bdata\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\b/);
      if (dataMatch) {
        const dataKey = `${dataMatch[1]}.${dataMatch[2]}`;
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
    }
  }

  return null;
}
