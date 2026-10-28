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

      // Check data.<type>.<name>
      const dataMatch = exprContent.match(/\bdata\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\b/);
      if (dataMatch) {
        const dataKey = `${dataMatch[1]}.${dataMatch[2]}`;
        const info = scanner.config.dataSources.get(dataKey);

        if (info) {
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: [
                `### Testform Data Source: \`${dataKey}\``,
                `**Type:** \`${info.type}\``,
                `**Instance:** \`${info.name}\``,
                `---`,
                `*Declared in:* \`${info.sourceFile}\``
              ].join('\n\n')
            }
          };
        }
      }
    }
  }

  // Match tags hover: @module(...)
  const lineText = document.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 }
  });

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
