import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
  MarkupKind
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceScanner } from './workspace-scanner';

export const BUILTIN_FUNCTIONS = [
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

function getNextIdForDocument(docText: string, prefix: 'tc' | 'tr' | 'tp', fallbackMax: number): string {
  const regex = new RegExp(`@${prefix}-([0-9]+)\\b`, 'gi');
  let maxNum = 0;
  let padLength = 0;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(docText)) !== null) {
    const digits = match[1];
    const num = parseInt(digits, 10);
    if (!isNaN(num) && num > maxNum) {
      maxNum = num;
      padLength = digits.length;
    }
  }

  if (maxNum === 0) {
    if (prefix === 'tc') {
      return 'tc-01';
    }
    return `${prefix}-${fallbackMax + 1}`;
  }

  const nextNum = maxNum + 1;
  const nextStr = padLength > 1
    ? String(nextNum).padStart(padLength, '0')
    : String(nextNum);

  return `${prefix}-${nextStr}`;
}

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

  // 3.1 Module completion: ${module.
  if (/\$\{module\.[a-zA-Z0-9_.]*$/.test(lineText)) {
    for (const [modName, modInfo] of scanner.declaredModules.entries()) {
      if (modInfo.outputs.length > 0) {
        for (const outName of modInfo.outputs) {
          items.push({
            label: `${modName}.${outName}`,
            kind: CompletionItemKind.Property,
            detail: `Module Output: ${modName}.${outName}`,
            documentation: {
              kind: MarkupKind.Markdown,
              value: `**Module Output:** \`${modName}.${outName}\`\n\n*Source:* \`${modInfo.source}\``
            },
            insertText: `${modName}.${outName}`
          });
        }
      } else {
        items.push({
          label: modName,
          kind: CompletionItemKind.Module,
          detail: `Module: ${modName} (${modInfo.source})`,
          insertText: modName
        });
      }
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
        label: 'module.',
        kind: CompletionItemKind.Module,
        detail: 'Reference a module output',
        insertText: 'module.'
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

  // 4.5 Rule path completion in testrun and testplan
  const ruleMatch = lineText.match(/^\s*(?:Rule|Regla):\s*([a-zA-Z0-9_./-]*)$/i);
  if (ruleMatch) {
    const docText = document.getText();
    const uri = document.uri.toLowerCase();
    const isTestplan = uri.endsWith('.plan.feature') || /@testplan\b/i.test(docText);
    const isTestrun = uri.endsWith('.run.feature') || /@testrun\b/i.test(docText);

    if (isTestplan) {
      // In a testplan, Rule: must suggest testrun suite files (*.run.feature)
      for (const [relPath, feat] of scanner.featureFiles.entries()) {
        if (feat.scope === 'testrun') {
          items.push({
            label: relPath,
            kind: CompletionItemKind.File,
            detail: `Test Run: ${feat.title}`,
            documentation: {
              kind: MarkupKind.Markdown,
              value: `### 🚀 Test Run Target\n\n**Title:** ${feat.title}\n\n**Path:** \`${relPath}\``
            },
            insertText: relPath
          });
        }
      }
      return items;
    } else if (isTestrun) {
      // In a testrun, Rule: must suggest testcase feature files (*.case.feature)
      for (const [relPath, feat] of scanner.featureFiles.entries()) {
        if (feat.scope === 'testcase') {
          items.push({
            label: relPath,
            kind: CompletionItemKind.File,
            detail: `Feature: ${feat.title}`,
            documentation: {
              kind: MarkupKind.Markdown,
              value: `### 🧪 Test Case Feature Target\n\n**Title:** ${feat.title}\n\n**Path:** \`${relPath}\``
            },
            insertText: relPath
          });
        }
      }
      return items;
    }
  }

  // 4.6 Scenario address completion inside a testrun Rule
  const scenarioKeywordMatch = lineText.match(/^\s*(?:Scenario|Escenario):\s*([a-zA-Z0-9_./-]*)$/i);
  if (scenarioKeywordMatch) {
    const docText = document.getText();
    const uri = document.uri.toLowerCase();
    const isTestrun = uri.endsWith('.run.feature') || /@testrun\b/i.test(docText);

    if (isTestrun) {
      const linesBefore = document.getText({ start: { line: 0, character: 0 }, end: position }).split(/\r?\n/);
      let enclosingRulePath = '';
      for (let i = linesBefore.length - 1; i >= 0; i--) {
        const m = linesBefore[i].trim().match(/^(?:Rule|Regla):\s*(.+)$/i);
        if (m) {
          enclosingRulePath = m[1].trim();
          break;
        }
      }

      if (enclosingRulePath) {
        const normRule = enclosingRulePath.toLowerCase();
        for (const [addr, info] of scanner.config.scenarioAddresses.entries()) {
          if (info.sourceFile.toLowerCase().endsWith(normRule) || addr.toLowerCase().startsWith(normRule)) {
            items.push({
              label: addr,
              kind: CompletionItemKind.Reference,
              detail: info.title,
              documentation: {
                kind: MarkupKind.Markdown,
                value: `### Linked Test Case\n\n**Title:** ${info.title}\n\n**Tag:** \`${info.tag}\`\n\n*Address:* \`${addr}\``
              },
              insertText: addr
            });
          }
        }
        if (items.length > 0) return items;
      }
    }
  }

  // 5. DSL Mark Status Step completion
  if (/^\s*\*\s*(m|ma|mar|mark)?\s*$/i.test(lineText)) {
    items.push({
      label: 'mark status = ...',
      kind: CompletionItemKind.Snippet,
      detail: 'Testform DSL: Asignar resultado de ejecución',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'mark status = ${1|passed,failed,pending,skipped,blocked,unexecuted|}'
    });
    return items;
  }

  if (/mark\s+status\s*=\s*[a-zA-Z]*$/i.test(lineText)) {
    const statuses = ['passed', 'failed', 'pending', 'skipped', 'blocked', 'unexecuted'];
    return statuses.map(s => ({
      label: s,
      kind: CompletionItemKind.EnumMember,
      detail: `Execution Status: ${s}`,
      insertText: s
    }));
  }

  // 5.1 DSL Field Step completion: * field <name> = <value>
  if (/^\s*(?:\*|Given|When|Then|And|Dado|Cuando|Entonces|Y)?\s*(f|fi|fie|fiel|field)\s*$/i.test(lineText)) {
    items.push({
      label: 'field <name> = ...',
      kind: CompletionItemKind.Snippet,
      detail: 'Testform DSL: Asignar metadato personalizado de campo',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'field ${1:priority} = ${2:High}'
    });
    return items;
  }

  // 5.2 Suggest field names after "field "
  const fieldNameMatch = lineText.match(/(?:^|\s+)field\s+([a-zA-Z0-9_.-]*)$/i);
  if (fieldNameMatch) {
    // 1. Defined fields in main.yml / workspace
    for (const [name, info] of scanner.customFields.entries()) {
      const enumDetail = info.enum && info.enum.length > 0 ? ` [${info.enum.join(' | ')}]` : '';
      items.push({
        label: name,
        kind: CompletionItemKind.Property,
        detail: `Testform Field: ${name}${info.required ? ' (required)' : ''}${enumDetail}`,
        insertText: `${name} = `
      });
    }

    // 2. Default standard fields if not already declared
    const defaultKnown = [
      { name: 'priority', desc: 'Execution priority [Critical | High | Medium | Low]' },
      { name: 'severity', desc: 'Defect impact [Blocker | Critical | Major | Minor | Trivial]' },
      { name: 'component', desc: 'System component or domain' },
      { name: 'assignee', desc: 'Responsible tester or owner' }
    ];

    for (const f of defaultKnown) {
      if (!scanner.customFields.has(f.name.toLowerCase())) {
        items.push({
          label: f.name,
          kind: CompletionItemKind.Property,
          detail: f.desc,
          insertText: `${f.name} = `
        });
      }
    }
    return items;
  }

  // 5.3 Suggest values after "field <name> = "
  const fieldValueMatch = lineText.match(/(?:^|\s+)field\s+([a-zA-Z0-9_.-]+)\s*=\s*([a-zA-Z0-9_.-]*)$/i);
  if (fieldValueMatch) {
    const fieldName = fieldValueMatch[1].toLowerCase();
    const custom = scanner.customFields.get(fieldName);

    if (custom && custom.enum && custom.enum.length > 0) {
      return custom.enum.map(e => ({
        label: e,
        kind: CompletionItemKind.Value,
        detail: `Allowed Value for '${custom.name}': ${e}`,
        insertText: e
      }));
    }

    if (fieldName === 'priority') {
      return ['Critical', 'High', 'Medium', 'Low'].map(v => ({
        label: v,
        kind: CompletionItemKind.Value,
        detail: `Priority: ${v}`,
        insertText: v
      }));
    }
    if (fieldName === 'severity') {
      return ['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'].map(v => ({
        label: v,
        kind: CompletionItemKind.Value,
        detail: `Severity: ${v}`,
        insertText: v
      }));
    }
  }

  // 6. Scenario Outline Table Parameters Completion: <param
  const outlineParamMatch = lineText.match(/<([a-zA-Z0-9_.-]*)$/);
  if (outlineParamMatch) {
    const docText = document.getText();
    const lines = docText.split(/\r?\n/);
    let examplesHeaders: string[] = [];

    // Search forwards for Examples: table in this scenario
    for (let i = position.line; i < lines.length; i++) {
      const line = lines[i].trim();
      if ((line.startsWith('Scenario:') || line.startsWith('Scenario Outline:') || line.startsWith('Escenario:') || line.startsWith('Esquema del escenario:')) && i !== position.line) {
        break;
      }
      if (line.startsWith('Examples:') || line.startsWith('Ejemplos:')) {
        if (i + 1 < lines.length) {
          const headerRow = lines[i + 1].trim();
          if (headerRow.startsWith('|')) {
            examplesHeaders = headerRow.split('|').map(s => s.trim()).filter(Boolean);
            break;
          }
        }
      }
    }

    // Search backwards if not found
    if (examplesHeaders.length === 0) {
      for (let i = position.line; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('Examples:') || line.startsWith('Ejemplos:')) {
          if (i + 1 < lines.length) {
            const headerRow = lines[i + 1].trim();
            if (headerRow.startsWith('|')) {
              examplesHeaders = headerRow.split('|').map(s => s.trim()).filter(Boolean);
              break;
            }
          }
        }
        if (line.startsWith('Scenario Outline:') || line.startsWith('Esquema del escenario:')) break;
      }
    }

    for (const header of examplesHeaders) {
      items.push({
        label: `<${header}>`,
        kind: CompletionItemKind.Variable,
        detail: `Columna de Examples: ${header}`,
        documentation: {
          kind: MarkupKind.Markdown,
          value: `**Parámetro de tabla:** \`<${header}>\`\n\nDefinido en la tabla \`Examples:\` de este Scenario Outline.`
        },
        insertText: `${header}>`
      });
    }

    if (items.length > 0) return items;
  }

  // 7. Depends on addresses completion inside @depends_on("...")
  if (/@depends_on\([^)]*["'][^"']*$/.test(lineText)) {
    // 7.1 Internal tags in the current document
    const docText = document.getText();
    const internalTags = [...docText.matchAll(/@(tc|tr|tp)-[0-9]+/gi)].map(m => m[0].toLowerCase());
    const uniqueInternal = [...new Set(internalTags)];
    for (const tag of uniqueInternal) {
      items.push({
        label: tag,
        kind: CompletionItemKind.Reference,
        detail: `Referencia interna en este feature (${tag})`,
        insertText: tag
      });
    }

    // 7.2 External scenario addresses
    for (const [address, info] of scanner.config.scenarioAddresses.entries()) {
      if (address.includes('/')) {
        items.push({
          label: address,
          kind: CompletionItemKind.Reference,
          detail: `${info.tag}: ${info.title}`,
          documentation: {
            kind: MarkupKind.Markdown,
            value: `### Dependency Target\n\n**Tag:** \`${info.tag}\`\n\n**Title:** ${info.title}\n\n*File:* \`${info.sourceFile}\``
          },
          insertText: address
        });
      }
    }
    return items;
  }

  // 8. Identity Tag next-ID completion (@tc-, @tr-, @tp-)
  const tcPrefixMatch = lineText.match(/@(tc|tr|tp)-?([0-9]*)$/i);
  if (tcPrefixMatch) {
    const prefix = tcPrefixMatch[1].toLowerCase() as 'tc' | 'tr' | 'tp';
    const nextTag = getNextIdForDocument(document.getText(), prefix, scanner.config.maxIdentityIds[prefix]);

    items.push({
      label: nextTag,
      kind: CompletionItemKind.Value,
      detail: `Siguiente ID sugerido para este archivo (@${nextTag})`,
      insertText: nextTag
    });

    // Also list existing scenario tags
    for (const [tag, info] of scanner.config.scenarios.entries()) {
      if (tag.toLowerCase().startsWith(`@${prefix}-`)) {
        items.push({
          label: tag.replace(/^@/, ''),
          kind: CompletionItemKind.Reference,
          detail: info.title,
          insertText: tag.replace(/^@/, '')
        });
      }
    }
    return items;
  }

  // 8. General Tags completion: @
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
        detail: 'Dependency constraint: @depends_on("path/to.case.feature.@tc-1")',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'depends_on("${1:target}")'
      },
      {
        label: 'retry',
        kind: CompletionItemKind.Snippet,
        detail: 'Directive: Retry count on failure (@retry(3))',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'retry(${1:3})'
      },
      {
        label: 'timeout',
        kind: CompletionItemKind.Snippet,
        detail: 'Directive: Timeout threshold (@timeout("30s"))',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'timeout("${1:30s}")'
      }
    );

    // Dynamic tags declared in workspace configuration (fields with source: "tag")
    for (const [fieldName, fieldInfo] of scanner.customFields.entries()) {
      if (fieldInfo.source === 'tag') {
        if (fieldInfo.enum && fieldInfo.enum.length > 0) {
          for (const enumVal of fieldInfo.enum) {
            const cleanTag = enumVal.replace(/^@/, '');
            items.push({
              label: cleanTag,
              kind: CompletionItemKind.Constant,
              detail: `Tag (${fieldInfo.name}): @${cleanTag}`,
              insertText: cleanTag
            });
          }
        } else {
          items.push({
            label: fieldName,
            kind: CompletionItemKind.Constant,
            detail: `Tag: @${fieldName}`,
            insertText: fieldName
          });
        }
      }
    }

    // Next ID computed for THIS document
    const docText = document.getText();
    const docUri = document.uri.toLowerCase();
    let activePrefix: 'tc' | 'tr' | 'tp' = 'tc';
    if (docUri.includes('.run.') || docText.includes('@testrun')) {
      activePrefix = 'tr';
    } else if (docUri.includes('.plan.') || docText.includes('@testplan')) {
      activePrefix = 'tp';
    }

    const nextIdTag = getNextIdForDocument(docText, activePrefix, scanner.config.maxIdentityIds[activePrefix]);
    items.push({
      label: nextIdTag,
      kind: CompletionItemKind.Value,
      detail: `Siguiente ID sugerido para este archivo (@${nextIdTag})`,
      insertText: nextIdTag
    });

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
