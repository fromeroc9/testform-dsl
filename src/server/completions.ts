import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
  MarkupKind
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceScanner } from './workspace-scanner';

const BUILTIN_FUNCTIONS = [
  { name: 'lower', desc: 'Converts a string to lowercase' },
  { name: 'upper', desc: 'Converts a string to uppercase' },
  { name: 'trim', desc: 'Removes leading and trailing whitespace' },
  { name: 'replace', desc: 'Replaces substrings within a string' },
  { name: 'split', desc: 'Splits a string into a list' },
  { name: 'join', desc: 'Joins a list into a string' },
  { name: 'length', desc: 'Determines the length of a string or list' },
  { name: 'coalesce', desc: 'Returns the first non-null argument' },
  { name: 'default', desc: 'Returns a fallback value if expression is empty' },
  { name: 'jsonencode', desc: 'Encodes a value to JSON string' },
  { name: 'jsondecode', desc: 'Decodes a JSON string to object' }
];

export function provideCompletions(
  document: TextDocument,
  position: Position,
  scanner: WorkspaceScanner
): CompletionItem[] {
  const lineText = document.getText({
    start: { line: position.line, character: 0 },
    end: position
  });

  const items: CompletionItem[] = [];

  // 1. Variable completion: ${var.
  if (/\$\{var\.[a-zA-Z0-9_]*$/.test(lineText)) {
    for (const [name, info] of scanner.config.variables.entries()) {
      items.push({
        label: name,
        kind: CompletionItemKind.Variable,
        detail: `(${info.type || 'string'}) ${info.sourceFile.split(/[/\\]/).pop()}`,
        documentation: {
          kind: MarkupKind.Markdown,
          value: `**Testform Variable:** \`${name}\`\n\n${info.description || 'No description provided.'}\n\n**Default:** \`${JSON.stringify(info.defaultValue)}\`\n\n*Source:* \`${info.sourceFile}\``
        },
        insertText: name
      });
    }
    return items;
  }

  // 2. Local completion: ${local.
  if (/\$\{local\.[a-zA-Z0-9_]*$/.test(lineText)) {
    for (const [name, info] of scanner.config.locals.entries()) {
      items.push({
        label: name,
        kind: CompletionItemKind.Value,
        detail: `Local: ${info.expression}`,
        documentation: {
          kind: MarkupKind.Markdown,
          value: `**Testform Local:** \`${name}\`\n\nExpression: \`${info.expression}\`\n\n*Source:* \`${info.sourceFile}\``
        },
        insertText: name
      });
    }
    return items;
  }

  // 3. Data source completion: ${data.
  if (/\$\{data\.[a-zA-Z0-9_.]*$/.test(lineText)) {
    for (const [key, info] of scanner.config.dataSources.entries()) {
      items.push({
        label: key,
        kind: CompletionItemKind.Class,
        detail: `Data Source: ${info.type}`,
        documentation: {
          kind: MarkupKind.Markdown,
          value: `**Data Source:** \`data.${key}\`\n\n*Source:* \`${info.sourceFile}\``
        },
        insertText: key
      });
    }
    return items;
  }

  // 4. Expression prefix: ${
  if (/\$\{[a-zA-Z0-9_]*$/.test(lineText)) {
    items.push(
      {
        label: 'var.',
        kind: CompletionItemKind.Module,
        detail: 'Reference an input variable',
        insertText: 'var.'
      },
      {
        label: 'local.',
        kind: CompletionItemKind.Module,
        detail: 'Reference a computed local value',
        insertText: 'local.'
      },
      {
        label: 'data.',
        kind: CompletionItemKind.Module,
        detail: 'Reference an external data source',
        insertText: 'data.'
      },
      {
        label: 'env.',
        kind: CompletionItemKind.Module,
        detail: 'Reference an environment variable',
        insertText: 'env.'
      }
    );

    for (const fn of BUILTIN_FUNCTIONS) {
      items.push({
        label: fn.name,
        kind: CompletionItemKind.Function,
        detail: `Testform Function: ${fn.name}()`,
        documentation: fn.desc,
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: `${fn.name}(\${1:arg})`
      });
    }

    return items;
  }

  // 5. DSL Mark Status: mark status =
  if (/mark\s+status\s*=\s*[a-zA-Z]*$/i.test(lineText)) {
    const statuses = ['passed', 'failed', 'skipped', 'blocked', 'unexecuted'];
    return statuses.map(s => ({
      label: s,
      kind: CompletionItemKind.EnumMember,
      detail: `Execution Status: ${s}`,
      insertText: s
    }));
  }

  // 6. Tags completion: @
  if (/@([a-zA-Z0-9_-]*)$/.test(lineText)) {
    // Scopes
    items.push(
      {
        label: 'testcase',
        kind: CompletionItemKind.Keyword,
        detail: 'Scope: Testcase feature (@testcase)',
        insertText: 'testcase'
      },
      {
        label: 'testrun',
        kind: CompletionItemKind.Keyword,
        detail: 'Scope: Execution run feature (@testrun)',
        insertText: 'testrun'
      },
      {
        label: 'testplan',
        kind: CompletionItemKind.Keyword,
        detail: 'Scope: Master quality gate plan (@testplan)',
        insertText: 'testplan'
      },
      {
        label: 'smoke',
        kind: CompletionItemKind.Property,
        detail: 'Category Tag: Smoke suite',
        insertText: 'smoke'
      },
      {
        label: 'regression',
        kind: CompletionItemKind.Property,
        detail: 'Category Tag: Regression suite',
        insertText: 'regression'
      },
      {
        label: 'depends_on',
        kind: CompletionItemKind.Snippet,
        detail: 'Dependency constraint: @depends_on(target="@tc-1")',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'depends_on(target="${1:@tc-1}")'
      }
    );

    // Modules
    for (const mod of scanner.installedModules) {
      items.push({
        label: `module(${mod})`,
        kind: CompletionItemKind.Module,
        detail: `Installed Module: .testform/modules/${mod}`,
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: `module(name="${mod}", source="${mod}")`
      });
    }

    return items;
  }

  return items;
}
