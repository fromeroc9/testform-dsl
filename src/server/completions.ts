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
        kind: CompletionItemKind.Event,
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

  // 4.55 Scenario declaration snippet under a testrun Rule
  const scenarioSnippetMatch = lineText.match(/^\s*(s|sc|sce|scen|scena|scenar|scenari|scenario|e|es|esc|esce|escen|escena|escenar|escenari|escenario)?\s*$/i);
  if (scenarioSnippetMatch) {
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
        items.push({
          label: 'Scenario: [Target]',
          kind: CompletionItemKind.Snippet,
          detail: `Declarar target de ejecución para Rule '${enclosingRulePath}'`,
          documentation: {
            kind: MarkupKind.Markdown,
            value: `Crea un bloque de escenario para la ejecución de un caso de prueba:\n\`\`\`gherkin\nScenario: \${1:target}\n  * mark status = \${2|passed,failed,pending,skipped,blocked,unexecuted|}\n\`\`\``
          },
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `Scenario: \${1:target}\n  * mark status = \${2|passed,failed,pending,skipped,blocked,unexecuted|}`
        });
      }
    }
  }

  // 4.6 Scenario target completion inside a testrun Rule
  const scenarioKeywordMatch = lineText.match(/^\s*(?:Scenario|Escenario|Scenario Outline|Esquema del escenario):\s*(.*)$/i);
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
        const normRule = enclosingRulePath.toLowerCase().replace(/\\/g, '/');
        const normRuleBase = normRule.split('/').pop() || normRule;
        const typedTarget = scenarioKeywordMatch[1].trim();
        const hasAt = typedTarget.startsWith('@');

        // Target: Wildcard (*) to run all scenarios of this Rule
        items.push({
          label: '*',
          kind: CompletionItemKind.Keyword,
          detail: `Wildcard: Ejecutar todos los casos de ${enclosingRulePath}`,
          documentation: {
            kind: MarkupKind.Markdown,
            value: `### 🌐 Target Wildcard (\`*\`)\n\nTestform evalúa \`*\` como un selector global que ejecuta y aplica el estado a **todos los casos de prueba** definidos en la Rule:\n\`${enclosingRulePath}\``
          },
          insertText: '*'
        });

        // Snippet Wildcard with mark status
        items.push({
          label: '* (con * mark status)',
          kind: CompletionItemKind.Snippet,
          detail: `Wildcard + paso de estado`,
          documentation: {
            kind: MarkupKind.Markdown,
            value: `Ejecuta todos los casos de la regla con un estado consolidado:\n\`\`\`gherkin\nScenario: *\n  * mark status = passed\n\`\`\``
          },
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `*\n      * mark status = \${1|passed,failed,pending,skipped,blocked,unexecuted|}`
        });

        const seenTags = new Set<string>();

        for (const [addr, info] of scanner.config.scenarioAddresses.entries()) {
          const normSource = info.sourceFile.toLowerCase().replace(/\\/g, '/');
          const normAddr = addr.toLowerCase().replace(/\\/g, '/');

          if (normSource.endsWith(normRule) || normSource.endsWith(normRuleBase) || normAddr.includes(normRuleBase)) {
            const cleanTag = info.tag.replace(/^@/, '');
            const insertTag = hasAt ? cleanTag : info.tag;

            if (!seenTags.has(cleanTag)) {
              seenTags.add(cleanTag);

              // 1. Target por Tag (@tc-01)
              items.push({
                label: info.tag,
                kind: CompletionItemKind.Reference,
                detail: `[Tag Target] ${info.tag}: ${info.title}`,
                filterText: `@${cleanTag} ${cleanTag} ${info.title}`,
                documentation: {
                  kind: MarkupKind.Markdown,
                  value: `### 🧪 Test Case Target (por Tag)\n\n**Tag:** \`${info.tag}\`\n\n**Título:** ${info.title}\n\n*Rule:* \`${enclosingRulePath}\``
                },
                insertText: insertTag
              });

              // 2. Target por Título descriptivo
              items.push({
                label: info.title,
                kind: CompletionItemKind.Value,
                detail: `[Title Target] ${info.tag}`,
                filterText: `${info.title} ${info.tag} ${cleanTag}`,
                documentation: {
                  kind: MarkupKind.Markdown,
                  value: `### 📝 Test Case Target (por Título)\n\nTestform resuelve escenarios por su título exacto declarado en el feature.\n\n**Título:** ${info.title}\n\n**Tag asociado:** \`${info.tag}\`\n\n*Rule:* \`${enclosingRulePath}\``
                },
                insertText: info.title
              });

              // 3. Snippet con mark status por Tag
              items.push({
                label: `${info.tag} (con * mark status)`,
                kind: CompletionItemKind.Snippet,
                detail: `Target ${info.tag} + * mark status`,
                filterText: `@${cleanTag} ${cleanTag} ${info.title} mark status`,
                documentation: {
                  kind: MarkupKind.Markdown,
                  value: `Inserta el target \`${info.tag}\` junto con el paso de ejecución:\n\`\`\`gherkin\nScenario: ${info.tag}\n      * mark status = passed\n\`\`\``
                },
                insertTextFormat: InsertTextFormat.Snippet,
                insertText: `${insertTag}\n      * mark status = \${1|passed,failed,pending,skipped,blocked,unexecuted|}`
              });

              // 4. Snippet con mark status por Título
              items.push({
                label: `${info.title} (con * mark status)`,
                kind: CompletionItemKind.Snippet,
                detail: `Target por título + * mark status`,
                filterText: `${info.title} ${cleanTag} mark status`,
                documentation: {
                  kind: MarkupKind.Markdown,
                  value: `Inserta el target por título junto con el paso de ejecución:\n\`\`\`gherkin\nScenario: ${info.title}\n      * mark status = passed\n\`\`\``
                },
                insertTextFormat: InsertTextFormat.Snippet,
                insertText: `${info.title}\n      * mark status = \${1|passed,failed,pending,skipped,blocked,unexecuted|}`
              });
            }

            // 5. Target por Dirección Canónica (Magento/cart.case.feature.@tc-01)
            items.push({
              label: addr,
              kind: CompletionItemKind.Reference,
              detail: `[Canonical Address] ${info.tag}`,
              filterText: `${addr} ${cleanTag} ${info.title}`,
              documentation: {
                kind: MarkupKind.Markdown,
                value: `### 📍 Target por Dirección Canónica\n\n\`${addr}\`\n\n**Título:** ${info.title}`
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

  // 5.1 Suggest field names after "field "
  const fieldNameMatch = lineText.match(/(?:^|\s+)field\s+([a-zA-Z0-9_.-]*)$/i);
  if (fieldNameMatch) {
    const docUri = document.uri.toLowerCase();
    const docContent = document.getText();
    let currentResourceType: 'testcase' | 'testrun' | 'testplan' | 'other' = 'other';
    const tcPat = scanner.config.scopes.testcase || '*.case.feature';
    const trPat = scanner.config.scopes.testrun || '*.run.feature';
    const tpPat = scanner.config.scopes.testplan || '*.plan.feature';

    const matchesPat = (p: string, pat: string) => new RegExp(pat.replace(/\*/g, '.*') + '$', 'i').test(p);
    if (matchesPat(docUri, tcPat) || docContent.includes('@testcase')) currentResourceType = 'testcase';
    else if (matchesPat(docUri, trPat) || docContent.includes('@testrun')) currentResourceType = 'testrun';
    else if (matchesPat(docUri, tpPat) || docContent.includes('@testplan')) currentResourceType = 'testplan';

    // 1. Defined fields in main.yml / workspace filtered by resource scope
    for (const [name, info] of scanner.customFields.entries()) {
      if (info.scopes && info.scopes.length > 0 && !info.scopes.includes('global')) {
        if (currentResourceType !== 'other' && !info.scopes.includes(currentResourceType)) {
          continue; // Skip fields belonging strictly to other resources!
        }
      }

      const enumDetail = info.enum && info.enum.length > 0 ? ` [${info.enum.join(' | ')}]` : '';
      const requiredText = info.required ? ' (required)' : '';

      if (info.enum && info.enum.length > 0) {
        const cleanChoices = info.enum.map(e => e.replace(/[,|\\]/g, ''));
        items.push({
          label: info.name,
          kind: CompletionItemKind.Property,
          detail: `Field: ${info.name}${requiredText}${enumDetail}`,
          documentation: {
            kind: MarkupKind.Markdown,
            value: `**Testform Field:** \`${info.name}\`${requiredText}\n\n**Scope:** \`${(info.scopes || ['global']).join(', ')}\`\n\n**Valores permitidos:**\n${info.enum.map(e => `- \`${e}\``).join('\n')}`
          },
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `${info.name} = \${1|${cleanChoices.join(',')}|}`
        });
      } else if (info.default !== undefined) {
        items.push({
          label: info.name,
          kind: CompletionItemKind.Property,
          detail: `Field: ${info.name}${requiredText} (default: ${info.default})`,
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `${info.name} = \${1:${info.default}}`
        });
      } else {
        items.push({
          label: info.name,
          kind: CompletionItemKind.Property,
          detail: `Field: ${info.name}${requiredText}`,
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `${info.name} = \${1:value}`
        });
      }
    }

    // 2. Default standard fields if not already declared
    const defaultKnown = [
      { name: 'priority', desc: 'Execution priority [Critical | High | Medium | Low]', enum: ['Critical', 'High', 'Medium', 'Low'] },
      { name: 'severity', desc: 'Defect impact [Blocker | Critical | Major | Minor | Trivial]', enum: ['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'] },
      { name: 'component', desc: 'System component or domain' },
      { name: 'assignee', desc: 'Responsible tester or owner' }
    ];

    for (const f of defaultKnown) {
      if (!scanner.customFields.has(f.name.toLowerCase())) {
        if (f.enum) {
          items.push({
            label: f.name,
            kind: CompletionItemKind.Property,
            detail: f.desc,
            insertTextFormat: InsertTextFormat.Snippet,
            insertText: `${f.name} = \${1|${f.enum.join(',')}|}`
          });
        } else {
          items.push({
            label: f.name,
            kind: CompletionItemKind.Property,
            detail: f.desc,
            insertTextFormat: InsertTextFormat.Snippet,
            insertText: `${f.name} = \${1:value}`
          });
        }
      }
    }
    return items;
  }

  // 5.2 Snippet when typing "field" before space
  if (/^\s*(?:\*|Given|When|Then|And|Dado|Cuando|Entonces|Y)?\s*(f|fi|fie|fiel)$/i.test(lineText)) {
    items.push({
      label: 'field <name> = ...',
      kind: CompletionItemKind.Snippet,
      detail: 'Testform DSL: Asignar metadato personalizado de campo',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'field ${1:name} = ${2:value}'
    });
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
    const docText = document.getText();
    const docUri = document.uri.toLowerCase();
    const isTestrun = docUri.endsWith('.run.feature') || /@testrun\b/i.test(docText);

    // If inside a testrun Rule, suggest testcases of that specific Rule
    if (isTestrun) {
      const linesBefore = document.getText({ start: { line: 0, character: 0 }, end: position }).split(/\r?\n/);
      let enclosingRule = '';
      for (let i = linesBefore.length - 1; i >= 0; i--) {
        const m = linesBefore[i].trim().match(/^(?:Rule|Regla):\s*(.+)$/i);
        if (m) {
          enclosingRule = m[1].trim();
          break;
        }
      }

      if (enclosingRule) {
        const normRule = enclosingRule.replace(/\\/g, '/').toLowerCase();
        const normBase = normRule.split('/').pop() || normRule;

        for (const [addr, info] of scanner.config.scenarioAddresses.entries()) {
          const normSource = info.sourceFile.replace(/\\/g, '/').toLowerCase();
          const normAddr = addr.replace(/\\/g, '/').toLowerCase();

          if (normSource.endsWith(normRule) || normSource.endsWith(normBase) || normAddr.includes(normBase)) {
            const cleanTag = info.tag.replace(/^@/, '');
            items.push({
              label: cleanTag,
              kind: CompletionItemKind.Reference,
              detail: `${info.tag}: ${info.title}`,
              documentation: `Testcase perteneciente a Rule '${enclosingRule}'`,
              insertText: cleanTag
            });
          }
        }
      }
    }

    // Resources: All three use the exact same Class icon (standard Resource representation)
    items.push(
      {
        label: 'testcase',
        kind: CompletionItemKind.Class,
        detail: 'Resource: Testcase feature (@testcase)',
        insertText: 'testcase'
      },
      {
        label: 'testrun',
        kind: CompletionItemKind.Class,
        detail: 'Resource: Execution run feature (@testrun)',
        insertText: 'testrun'
      },
      {
        label: 'testplan',
        kind: CompletionItemKind.Class,
        detail: 'Resource: Master quality gate plan (@testplan)',
        insertText: 'testplan'
      },
      {
        label: 'depends_on',
        kind: CompletionItemKind.Property, // 🔧 Llave francesa / inglesa
        detail: 'Dependency constraint: @depends_on("path/to.case.feature.@tc-1")',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'depends_on("${1:target}")'
      }
    );

    // Dynamic tags declared in workspace configuration (fields with source: "tag")
    // Formatted with field name and value so multiple fields with tags are easy to identify
    for (const [fieldName, fieldInfo] of scanner.customFields.entries()) {
      if (fieldInfo.source === 'tag') {
        if (fieldInfo.enum && fieldInfo.enum.length > 0) {
          for (const enumVal of fieldInfo.enum) {
            const cleanTag = enumVal.replace(/^@/, '');
            items.push({
              label: `${fieldInfo.name}: @${cleanTag}`,
              filterText: `${fieldInfo.name} ${cleanTag} @${cleanTag}`,
              kind: CompletionItemKind.EnumMember,
              detail: `field: ${fieldInfo.name} = @${cleanTag}`,
              documentation: `Valor permitido para el campo de tag '${fieldInfo.name}'.\nOpciones: ${fieldInfo.enum.join(', ')}`,
              insertText: cleanTag
            });
          }
        } else {
          items.push({
            label: `${fieldInfo.name}`,
            kind: CompletionItemKind.Property,
            detail: `field: ${fieldInfo.name} (tag)`,
            insertText: fieldInfo.name
          });
        }
      }
    }

    // Next ID computed for THIS document
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
