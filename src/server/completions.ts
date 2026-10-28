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
  // Strings
  { name: 'lower', desc: 'Converts a given string to lowercase.', snippet: 'lower(${1:string})' },
  { name: 'upper', desc: 'Converts a given string to uppercase.', snippet: 'upper(${1:string})' },
  { name: 'trim', desc: 'Removes leading and trailing whitespace from a string.', snippet: 'trim(${1:string})' },
  { name: 'trimprefix', desc: 'Removes the specified prefix from a string if present.', snippet: 'trimprefix(${1:string}, ${2:prefix})' },
  { name: 'trimsuffix', desc: 'Removes the specified suffix from a string if present.', snippet: 'trimsuffix(${1:string}, ${2:suffix})' },
  { name: 'startswith', desc: 'Determines if a string starts with the given prefix.', snippet: 'startswith(${1:string}, ${2:prefix})' },
  { name: 'endswith', desc: 'Determines if a string ends with the given suffix.', snippet: 'endswith(${1:string}, ${2:suffix})' },
  { name: 'replace', desc: 'Searches a string for substrings and replaces them.', snippet: 'replace(${1:string}, ${2:search}, ${3:replace})' },
  { name: 'split', desc: 'Produces a list by dividing a string at all occurrences of a separator.', snippet: 'split(${1:separator}, ${2:string})' },
  { name: 'join', desc: 'Concatenates list elements with a specified delimiter.', snippet: 'join(${1:delimiter}, ${2:list})' },
  { name: 'format', desc: 'Produces a formatted string using sprintf-like syntax.', snippet: 'format("${1:%s}", ${2:arg})' },
  { name: 'substr', desc: 'Extracts a substring from a string given offset and length.', snippet: 'substr(${1:string}, ${2:offset}, ${3:length})' },

  // Collections & Logic
  { name: 'contains', desc: 'Determines whether a list contains a given value or key.', snippet: 'contains(${1:list}, ${2:value})' },
  { name: 'coalesce', desc: 'Returns the first non-empty value from the given arguments.', snippet: 'coalesce(${1:val1}, ${2:val2})' },
  { name: 'lookup', desc: 'Retrieves a single element from a map with an optional fallback.', snippet: 'lookup(${1:map}, ${2:key}, ${3:default})' },
  { name: 'length', desc: 'Determines the length of a string, list, or map.', snippet: 'length(${1:collection})' },
  { name: 'element', desc: 'Retrieves a single element from a list by index.', snippet: 'element(${1:list}, ${2:index})' },
  { name: 'slice', desc: 'Extracts a sublist from a list given start and end index.', snippet: 'slice(${1:list}, ${2:start}, ${3:end})' },
  { name: 'merge', desc: 'Combines multiple maps into a single map.', snippet: 'merge(${1:map1}, ${2:map2})' },

  // System & Encoding
  { name: 'env', desc: 'Reads the value of an environment variable.', snippet: 'env("${1:VAR_NAME}")' },
  { name: 'uuid', desc: 'Generates a random UUID (version 4).', snippet: 'uuid()' },
  { name: 'timestamp', desc: 'Returns current UTC execution date and time formatted in RFC 3339.', snippet: 'timestamp()' },
  { name: 'jsonencode', desc: 'Encodes a value to its valid JSON string representation.', snippet: 'jsonencode(${1:value})' },
  { name: 'jsondecode', desc: 'Parses a valid JSON string into an object or list.', snippet: 'jsondecode(${1:json_string})' },
  { name: 'file', desc: 'Reads the contents of a local file as a string.', snippet: 'file("${1:path/to/file}")' }
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
        insertText: fn.snippet
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
        detail: 'Resource: Testcase feature (@testcase)',
        insertText: 'testcase'
      },
      {
        label: 'testrun',
        kind: CompletionItemKind.Keyword,
        detail: 'Resource: Execution run feature (@testrun)',
        insertText: 'testrun'
      },
      {
        label: 'testplan',
        kind: CompletionItemKind.Keyword,
        detail: 'Resource: Master quality gate plan (@testplan)',
        insertText: 'testplan'
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
