import * as path from 'path';
import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
  MarkupKind,
  TextEdit
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

function getNextIdForDocument(docText: string, prefix: 'tc' | 'tr' | 'tp' | 'bg', fallbackMax: number): string {
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
    if (prefix === 'bg') {
      return 'bg-01';
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
  // 0. Starter scaffolding snippets ONLY when the document is empty ("en la nada")
  const docFullText = document.getText().trim();
  if (docFullText === '') {
    return [
      {
        label: 'tf-testcase',
        kind: CompletionItemKind.Snippet,
        documentation: {
          kind: MarkupKind.Markdown,
          value: '### 🧪 Starter Test Case Feature\n\nCreate a new declarative test case manifest with standard tags and scenarios.'
        },
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: '@testcase\nFeature: ${1:Feature Name}\n\n  @${2:tc-01}\n  Scenario: ${3:Scenario Title}\n    Given ${4:precondition}\n    When ${5:action}\n    Then ${6:expected outcome}\n'
      },
      {
        label: 'tf-testrun',
        kind: CompletionItemKind.Snippet,
        documentation: {
          kind: MarkupKind.Markdown,
          value: '### 🚀 Starter Test Run Suite\n\nCreate a new TestRun suite linking testcase feature rules.'
        },
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: '@testrun @${1:tr-1}\nFeature: ${2:Execution Suite}\n\n  Rule: ${3:path/to.case.feature}\n\n    Scenario: ${4:@tc-01}\n      * mark status = ${5|passed,failed,pending,skipped,blocked|}\n'
      },
      {
        label: 'tf-testplan',
        kind: CompletionItemKind.Snippet,
        documentation: {
          kind: MarkupKind.Markdown,
          value: '### 📋 Starter Test Plan\n\nCreate a new Master TestPlan linking testrun rules.'
        },
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: '@testplan @${1:tp-1}\nFeature: ${2:Master Test Plan}\n\n  Rule: ${3:path/to.run.feature}\n'
      },
      {
        label: 'tf-bug',
        kind: CompletionItemKind.Snippet,
        documentation: {
          kind: MarkupKind.Markdown,
          value: '### 🐛 Starter Defect / Bug Feature\n\nCreate a new declarative bug report targeting an existing testcase scenario.'
        },
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: '@bug @${1:bg-01}\nFeature: ${2:Bug Title}\n\n  Scenario: ${3:Defect Description}\n    * set target = ${4:path/to.case.feature.@tc-01}\n    * set status = ${5|failed,passed,pending|}\n    * field severity = ${6|critical,high,medium,low|}\n    * field priority = ${7|urgent,high,normal,low|}\n'
      }
    ];
  }

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

function detectDocumentScope(document: TextDocument, scanner: WorkspaceScanner): 'testcase' | 'testrun' | 'testplan' | 'bug' | null {
  const docText = document.getText();
  // 1. Explicit tags in document (@testrun, @testplan, etc.)
  if (/@testrun\b/i.test(docText)) return 'testrun';
  if (/@testplan\b/i.test(docText)) return 'testplan';
  if (/@testcase\b/i.test(docText)) return 'testcase';
  if (/@bug\b/i.test(docText)) return 'bug';

  // 2. Feature identity tags (@tr-, @tp-, @tc-, @bg-)
  if (/@tr-\d+\b/i.test(docText)) return 'testrun';
  if (/@tp-\d+\b/i.test(docText)) return 'testplan';
  if (/@tc-\d+\b/i.test(docText)) return 'testcase';
  if (/@bg-\d+\b/i.test(docText)) return 'bug';

  // 3. Registered featureFiles in workspace scanner
  const uriPath = document.uri.replace(/\\/g, '/').toLowerCase();
  for (const [_, feat] of scanner.featureFiles.entries()) {
    const featPath = feat.fullPath.replace(/\\/g, '/').toLowerCase();
    if (uriPath === featPath || uriPath.endsWith(feat.relPath.toLowerCase())) {
      return feat.scope;
    }
  }

  // 4. Configured scope patterns in scanner.config.scopes
  const scopes = scanner.config.scopes;
  if (scopes) {
    if (scopes.testrun && uriPath.endsWith(scopes.testrun.replace(/^\*/, '').toLowerCase())) return 'testrun';
    if (scopes.testplan && uriPath.endsWith(scopes.testplan.replace(/^\*/, '').toLowerCase())) return 'testplan';
    if (scopes.bug && uriPath.endsWith(scopes.bug.replace(/^\*/, '').toLowerCase())) return 'bug';
    if (scopes.testcase && uriPath.endsWith(scopes.testcase.replace(/^\*/, '').toLowerCase())) return 'testcase';
  }

  // 5. Default filename extensions
  if (uriPath.endsWith('.run.feature')) return 'testrun';
  if (uriPath.endsWith('.plan.feature')) return 'testplan';
  if (uriPath.endsWith('.bug.feature')) return 'bug';
  if (uriPath.endsWith('.case.feature')) return 'testcase';

  return null;
}
function getGherkinContext(document: TextDocument, position: Position): {
  section: 'header' | 'background' | 'rule' | 'scenario';
  enclosingRule: string | null;
  enclosingScenario: string | null;
} {
  const linesBefore = document.getText({ start: { line: 0, character: 0 }, end: position }).split(/\r?\n/);
  let section: 'header' | 'background' | 'rule' | 'scenario' = 'header';
  let enclosingRule: string | null = null;
  let enclosingScenario: string | null = null;

  for (let i = 0; i < linesBefore.length; i++) {
    const line = linesBefore[i].trim();
    if (line.startsWith('#')) continue;

    const rm = line.match(/^(?:Rule|Regla):\s*(.*)$/i);
    if (rm) {
      section = 'rule';
      enclosingRule = rm[1].trim();
      enclosingScenario = null;
      continue;
    }

    const bg = line.match(/^(?:Background|Antecedentes):/i);
    if (bg) {
      section = 'background';
      enclosingScenario = null;
      continue;
    }

    const sc = line.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.*)$/i);
    if (sc) {
      section = 'scenario';
      enclosingScenario = sc[1].trim();
      continue;
    }
  }

  return { section, enclosingRule, enclosingScenario };
}
function inferContextValues(docUri: string): { project: string; module: string } {
  const normUri = docUri.replace(/\\/g, '/');
  const parts = normUri.split('/');
  const fileName = parts.pop() || '';
  const folderName = parts.pop() || '';

  let project = 'ProjectName';
  let module = 'ModuleName';

  if (folderName && !['testcase', 'testruns', 'testplans', 'testcycle', 'tests', 'features'].includes(folderName.toLowerCase())) {
    project = folderName;
  }
  const cleanBase = fileName.replace(/(\.(case|run|plan|bug))?\.feature$/i, '');
  if (cleanBase && cleanBase !== 'test') {
    module = cleanBase.charAt(0).toUpperCase() + cleanBase.slice(1).replace(/_/g, ' ');
  }

  return { project, module };
}



  // 4.5 Rule path completion in testrun and testplan
  const ruleMatch = lineText.match(/^\s*(?:Rule|Regla):\s*([a-zA-Z0-9_./-]*)$/i);
  if (ruleMatch) {
    const docScope = detectDocumentScope(document, scanner);
    const isTestplan = docScope === 'testplan';
    const isTestrun = docScope === 'testrun';

    if (isTestplan) {
      // In a testplan, Rule: must suggest testrun suite files (*.run.feature)
      // Stripping scaffold directory (e.g. 'testruns/' or 'testcycle/') so paths are short
      const trScaffold = (scanner.config.scaffoldDirectories?.testrun || 'testruns').replace(/^[/\\]+|[/\\]+$/g, '');
      for (const [relPath, feat] of scanner.featureFiles.entries()) {
        if (feat.scope === 'testrun') {
          let shortPath = relPath;
          const lowerRel = relPath.toLowerCase().replace(/\\/g, '/');
          const lowerPrefix = trScaffold.toLowerCase() + '/';
          if (lowerRel.startsWith(lowerPrefix)) {
            shortPath = relPath.substring(trScaffold.length + 1);
          } else if (lowerRel.startsWith('testcycle/')) {
            shortPath = relPath.substring('testcycle/'.length);
          }

          const runsInFile = Array.from(scanner.config.scenarios.values()).filter(
            s => path.resolve(s.sourceFile) === path.resolve(feat.fullPath)
          );
          const countStr = `${runsInFile.length} ${runsInFile.length === 1 ? 'run' : 'runs'}`;
          const previewList = runsInFile.length > 0
            ? '\n\n**Runs:**\n' + runsInFile.slice(0, 8).map(s => `- \`${s.tag}\` ${s.title}`).join('\n') + (runsInFile.length > 8 ? `\n- ... and ${runsInFile.length - 8} more` : '')
            : '';

          items.push({
            label: shortPath,
            kind: CompletionItemKind.File,
            detail: `Test Run Target (${feat.title}) • ${countStr}`,
            filterText: `${shortPath} ${relPath} ${feat.title}`,
            documentation: {
              kind: MarkupKind.Markdown,
              value: `### 🚀 Test Run Target\n\n**Title:** ${feat.title}\n\n- **Target:** \`${shortPath}\`\n- **Full Path:** \`${relPath}\`\n- **Runs:** ${countStr}${previewList}`
            },
            insertText: shortPath
          });

          if (feat.namespace) {
            const logicalAddress = `${feat.namespace}.${path.basename(relPath)}`;
            items.push({
              label: logicalAddress,
              kind: CompletionItemKind.Module,
              detail: `Logical Namespace Target (${feat.title}) • ${countStr}`,
              filterText: `${logicalAddress} ${feat.namespace} ${feat.title}`,
              documentation: {
                kind: MarkupKind.Markdown,
                value: `### 🌐 Logical Feature Target (@ns: ${feat.namespace})\n\n**Title:** ${feat.title}\n\n- **Logical Target:** \`${logicalAddress}\`\n- **Full Path:** \`${relPath}\`\n- **Runs:** ${countStr}${previewList}`
              },
              insertText: logicalAddress
            });
          }
        }
      }
      return items;
    } else if (isTestrun) {
      // In a testrun, Rule: must suggest testcase feature files (*.case.feature)
      // Stripping scaffold directory (e.g. 'testcase/') so paths are short (e.g. Magento/cart.case.feature)
      const tcScaffold = (scanner.config.scaffoldDirectories?.testcase || 'testcase').replace(/^[/\\]+|[/\\]+$/g, '');
      for (const [relPath, feat] of scanner.featureFiles.entries()) {
        if (feat.scope === 'testcase') {
          let shortPath = relPath;
          const lowerRel = relPath.toLowerCase().replace(/\\/g, '/');
          const lowerPrefix = tcScaffold.toLowerCase() + '/';
          if (lowerRel.startsWith(lowerPrefix)) {
            shortPath = relPath.substring(tcScaffold.length + 1);
          }

          const casesInFile = Array.from(scanner.config.scenarios.values()).filter(
            s => path.resolve(s.sourceFile) === path.resolve(feat.fullPath)
          );
          const countStr = `${casesInFile.length} ${casesInFile.length === 1 ? 'case' : 'cases'}`;
          const previewList = casesInFile.length > 0
            ? '\n\n**Scenarios:**\n' + casesInFile.slice(0, 8).map(s => `- \`${s.tag}\` ${s.title}`).join('\n') + (casesInFile.length > 8 ? `\n- ... and ${casesInFile.length - 8} more` : '')
            : '';

          items.push({
            label: shortPath,
            kind: CompletionItemKind.File,
            detail: `Test Case Target (${feat.title}) • ${countStr}`,
            filterText: `${shortPath} ${relPath} ${feat.title}`,
            documentation: {
              kind: MarkupKind.Markdown,
              value: `### 🧪 Test Case Feature Target\n\n**Title:** ${feat.title}\n\n- **Target:** \`${shortPath}\`\n- **Full Path:** \`${relPath}\`\n- **Scenarios:** ${countStr}${previewList}`
            },
            insertText: shortPath
          });

          if (feat.namespace) {
            const logicalAddress = `${feat.namespace}.${path.basename(relPath)}`;
            items.push({
              label: logicalAddress,
              kind: CompletionItemKind.Module,
              detail: `Logical Namespace Target (${feat.title}) • ${countStr}`,
              filterText: `${logicalAddress} ${feat.namespace} ${feat.title}`,
              documentation: {
                kind: MarkupKind.Markdown,
                value: `### 🌐 Logical Feature Target (@ns: ${feat.namespace})\n\n**Title:** ${feat.title}\n\n- **Logical Target:** \`${logicalAddress}\`\n- **Full Path:** \`${relPath}\`\n- **Scenarios:** ${countStr}${previewList}`
              },
              insertText: logicalAddress
            });
          }
        }
      }
      return items;
    }
  }

  // 4.6 Scenario target completion inside a testrun or testplan Rule (Unit test icon, single item per testcase/testrun)
  const scenarioKeywordMatch = lineText.match(/^(\s*(?:Scenario|Escenario|Scenario Outline|Esquema del escenario):\s*)(.*)$/i);
  if (scenarioKeywordMatch) {
    const docScope = detectDocumentScope(document, scanner);
    const isTestrun = docScope === 'testrun';
    const isTestplan = docScope === 'testplan';

    if (isTestrun || isTestplan) {
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
        const ruleSlug = normRuleBase.replace(/(\.(case|run|plan|bug))?\.feature$/i, '');
        const prefixCol = scenarioKeywordMatch[1].length;
        const format = (scanner.config.targetFormat || 'tag').toLowerCase();
        const targetScope = isTestrun ? 'testcase' : 'testrun';

        const seenTags = new Set<string>();

        for (const [addr, info] of scanner.config.scenarioAddresses.entries()) {
          if (info.scope !== targetScope) continue;
          const normSource = info.sourceFile.toLowerCase().replace(/\\/g, '/');
          const normAddr = addr.toLowerCase().replace(/\\/g, '/');

          if (
            normSource.endsWith(normRule) ||
            normSource.endsWith(normRuleBase) ||
            normAddr.includes(normRuleBase) ||
            normSource.includes(ruleSlug) ||
            normAddr.includes(ruleSlug)
          ) {
            const cleanTag = info.tag.replace(/^@/, '');
            const atTag = `@${cleanTag}`;
            const fileNameOnly = path.basename(info.sourceFile);
            const fileSlug = fileNameOnly.replace(/(\.(case|run|plan|bug))?\.feature$/i, '');
            const canonicalAddr = info.delimitedAddress || info.address;
            const namespaceAddr = info.namespaceAddress;
            const basenameAddr = `${fileNameOnly}.${atTag}`;
            const fileTag = `${fileNameOnly}.${atTag}`;
            const slugTag = `${fileSlug}.${atTag}`;
            const scenarioTitle = info.title;

            let targetVal: string;
            switch (format) {
              case 'tag-bare':
                targetVal = cleanTag;
                break;
              case 'canonical':
              case 'classic':
                targetVal = canonicalAddr;
                break;
              case 'basename':
              case 'file-tag':
                targetVal = basenameAddr;
                break;
              case 'namespace':
                targetVal = namespaceAddr || canonicalAddr;
                break;
              case 'slug-tag':
                targetVal = slugTag;
                break;
              case 'name':
                targetVal = scenarioTitle;
                break;
              case 'tag':
              case 'short':
              default:
                targetVal = atTag;
                break;
            }

            if (!seenTags.has(cleanTag)) {
              seenTags.add(cleanTag);

              items.push({
                label: `${cleanTag}: ${info.title}`,
                kind: CompletionItemKind.Unit,
                detail: `[${format}] ${targetVal}`,
                filterText: `${cleanTag} @${cleanTag} ${basenameAddr} ${namespaceAddr || ''} ${fileTag} ${slugTag} ${canonicalAddr} ${info.title} ${targetVal}`,
                documentation: {
                  kind: MarkupKind.Markdown,
                  value: `### 🧪 Test Target\n\n**Title:** ${info.title}\n\n- **Active format:** \`${format}\`\n- **Target:** \`${targetVal}\`\n- **Tag:** \`${info.tag}\`\n- **Rule:** \`${enclosingRulePath}\`\n- **Canonical Address:** \`${canonicalAddr}\`${namespaceAddr ? `\n- **Namespace Address:** \`${namespaceAddr}\`` : ''}\n- **File:** \`${fileNameOnly}\``
                },
                textEdit: TextEdit.replace(
                  {
                    start: { line: position.line, character: prefixCol },
                    end: position
                  },
                  targetVal
                ),
                insertText: targetVal
              });
            }
          }
        }
        if (items.length > 0) return items;
      } else {
        // FORMAT 2: Direct Scenario under Feature (no enclosing Rule)
        const prefixCol = scenarioKeywordMatch[1].length;
        const format = (scanner.config.targetFormat || 'tag').toLowerCase();
        const targetScope = isTestrun ? 'testcase' : 'testrun';
        const seenKeys = new Set<string>();

        for (const [, info] of scanner.config.scenarioAddresses.entries()) {
          if (info.scope !== targetScope) continue;
          const uniqueKey = `${info.sourceFile}::${info.tag}`;
          if (seenKeys.has(uniqueKey)) continue;
          seenKeys.add(uniqueKey);

          const cleanTag = info.tag.replace(/^@/, '');
          const atTag = `@${cleanTag}`;
          const fileNameOnly = path.basename(info.sourceFile);
          const fileSlug = fileNameOnly.replace(/(\.(case|run|plan|bug))?\.feature$/i, '');
          const canonicalAddr = info.delimitedAddress || info.address;
          const namespaceAddr = info.namespaceAddress;
          const basenameAddr = `${fileNameOnly}.${atTag}`;
          const fileTag = `${fileNameOnly}.${atTag}`;
          const slugTag = `${fileSlug}.${atTag}`;
          const scenarioTitle = info.title;

          let targetVal: string;
          switch (format) {
            case 'tag-bare':
              targetVal = cleanTag;
              break;
            case 'canonical':
            case 'classic':
              targetVal = canonicalAddr;
              break;
            case 'basename':
            case 'file-tag':
              targetVal = basenameAddr;
              break;
            case 'namespace':
              targetVal = namespaceAddr || canonicalAddr;
              break;
            case 'slug-tag':
              targetVal = slugTag;
              break;
            case 'name':
              targetVal = scenarioTitle;
              break;
            case 'tag':
            case 'short':
            default:
              targetVal = atTag;
              break;
          }

          items.push({
            label: `${cleanTag}: ${info.title}`,
            kind: CompletionItemKind.Unit,
            detail: `[${format}] ${targetVal} (${fileNameOnly})`,
            filterText: `${cleanTag} @${cleanTag} ${basenameAddr} ${namespaceAddr || ''} ${fileTag} ${slugTag} ${canonicalAddr} ${info.title} ${targetVal} ${fileNameOnly}`,
            documentation: {
              kind: MarkupKind.Markdown,
              value: `### 🧪 Test Target (Direct Scenario)\n\n**Title:** ${info.title}\n\n- **Active format:** \`${format}\`\n- **Target:** \`${targetVal}\`\n- **Tag:** \`${info.tag}\`\n- **File:** \`${fileNameOnly}\`\n- **Canonical Address:** \`${canonicalAddr}\`${namespaceAddr ? `\n- **Namespace Address:** \`${namespaceAddr}\`` : ''}`
            },
            textEdit: TextEdit.replace(
              {
                start: { line: position.line, character: prefixCol },
                end: position
              },
              targetVal
            ),
            insertText: targetVal
          });
        }
        if (items.length > 0) return items;
      }
    }
  }

  // 5. DSL Mark / Field Step completions (* ...)
  const stepPrefixMatch = lineText.match(/^(\s*(?:\*|Given|When|Then|And|But)\s*)(.*)$/i);
  if (stepPrefixMatch && !lineText.includes('=')) {
    const prefixCol = stepPrefixMatch[1].length;
    const rest = stepPrefixMatch[2].trim().toLowerCase();
    const docScope = detectDocumentScope(document, scanner);
    const gContext = getGherkinContext(document, position);

    // If cursor is in Background:
    // MARKS DO NOT BELONG IN BACKGROUND! Only metadata fields belong in Background:
    if (gContext.section === 'background') {
      const inferred = inferContextValues(document.uri);

      // Collect contract fields applicable for this scope
      const applicableFields = [...scanner.customFields.values()].filter(f => {
        if (!f.scopes || f.scopes.length === 0 || f.scopes.includes('global')) return true;
        if (docScope && f.scopes.includes(docScope)) return true;
        return false;
      });

      const requiredFields = applicableFields.filter(f => f.required);

      // 1. "⚡ Implement all required fields" (Contract validation like Java implements interface)
      if (requiredFields.length > 0) {
        let tabIdx = 1;
        const reqLines = requiredFields.map((f, idx) => {
          const pfx = idx === 0 ? '' : '    * ';
          let valStr = '';
          if (f.enum && f.enum.length > 0) {
            valStr = `\${indexVar|${f.enum.map(e => e.replace(/[,|\\/]/g, '')).join(',')}|}`.replace('indexVar', String(tabIdx++));
          } else if (f.default !== undefined) {
            valStr = `\${indexVar:${f.default}}`.replace('indexVar', String(tabIdx++));
          } else if (f.name.toLowerCase() === 'project') {
            valStr = `\${indexVar:${inferred.project}}`.replace('indexVar', String(tabIdx++));
          } else if (f.name.toLowerCase() === 'module') {
            valStr = `\${indexVar:${inferred.module}}`.replace('indexVar', String(tabIdx++));
          } else {
            valStr = `\${indexVar:value}`.replace('indexVar', String(tabIdx++));
          }
          return `${pfx}field ${f.name} = ${valStr}`;
        }).join('\n');

        items.push({
          label: '⚡ Implement all required fields',
          kind: CompletionItemKind.Snippet,
          detail: `Testform Contract: Implement required fields (${requiredFields.map(f => f.name).join(', ')})`,
          sortText: '00_implement_required',
          insertTextFormat: InsertTextFormat.Snippet,
          filterText: 'implement required fields contract * field',
          textEdit: TextEdit.replace(
            { start: { line: position.line, character: prefixCol }, end: position },
            reqLines
          ),
          insertText: reqLines
        });
      }

      // 2. "⚡ Implement all fields (with defaults)"
      if (applicableFields.length > 0) {
        let allTabIdx = 1;
        const allLines = applicableFields.map((f, idx) => {
          const pfx = idx === 0 ? '' : '    * ';
          let valStr = '';
          if (f.default !== undefined) {
            valStr = `\${indexVar:${f.default}}`.replace('indexVar', String(allTabIdx++));
          } else if (f.enum && f.enum.length > 0) {
            valStr = `\${indexVar|${f.enum.map(e => e.replace(/[,|\\/]/g, '')).join(',')}|}`.replace('indexVar', String(allTabIdx++));
          } else if (f.name.toLowerCase() === 'project') {
            valStr = `\${indexVar:${inferred.project}}`.replace('indexVar', String(allTabIdx++));
          } else if (f.name.toLowerCase() === 'module') {
            valStr = `\${indexVar:${inferred.module}}`.replace('indexVar', String(allTabIdx++));
          } else {
            valStr = `\${indexVar:value}`.replace('indexVar', String(allTabIdx++));
          }
          return `${pfx}field ${f.name} = ${valStr}`;
        }).join('\n');

        items.push({
          label: '⚡ Implement all fields (with defaults)',
          kind: CompletionItemKind.Snippet,
          detail: 'Testform Contract: Implement all contract fields with default values',
          sortText: '01_implement_all',
          insertTextFormat: InsertTextFormat.Snippet,
          filterText: 'implement all fields contract * field',
          textEdit: TextEdit.replace(
            { start: { line: position.line, character: prefixCol }, end: position },
            allLines
          ),
          insertText: allLines
        });
      }

      // 3. Generic field snippet
      items.push({
        label: 'field <name> = ...',
        kind: CompletionItemKind.Keyword,
        detail: 'Testform DSL: Define custom metadata field',
        sortText: '02_field_generic',
        insertTextFormat: InsertTextFormat.Snippet,
        filterText: 'field',
        textEdit: TextEdit.replace(
          { start: { line: position.line, character: prefixCol }, end: position },
          'field ${1:name} = ${2:value}'
        ),
        insertText: 'field ${1:name} = ${2:value}'
      });

      // 4. Individual fields with priority sorting and (Required) badge
      for (const info of applicableFields) {
        const requiredText = info.required ? ' (Required)' : '';
        const sortPrefix = info.required ? '10_' : '20_';

        if (info.enum && info.enum.length > 0) {
          const cleanChoices = info.enum.map(e => e.replace(/[,|\\/]/g, ''));
          items.push({
            label: `field ${info.name}`,
            kind: CompletionItemKind.Field,
            detail: `Field: ${info.name}${requiredText}`,
            sortText: `${sortPrefix}${info.name}`,
            filterText: `field ${info.name} ${info.name}`,
            insertTextFormat: InsertTextFormat.Snippet,
            textEdit: TextEdit.replace(
              { start: { line: position.line, character: prefixCol }, end: position },
              `field ${info.name} = \${1|${cleanChoices.join(',')}|}`
            ),
            insertText: `field ${info.name} = \${1|${cleanChoices.join(',')}|}`
          });
        } else if (info.default !== undefined) {
          items.push({
            label: `field ${info.name}`,
            kind: CompletionItemKind.Field,
            detail: `Field: ${info.name}${requiredText} (default: ${info.default})`,
            sortText: `${sortPrefix}${info.name}`,
            filterText: `field ${info.name} ${info.name}`,
            insertTextFormat: InsertTextFormat.Snippet,
            textEdit: TextEdit.replace(
              { start: { line: position.line, character: prefixCol }, end: position },
              `field ${info.name} = \${1:${info.default}}`
            ),
            insertText: `field ${info.name} = \${1:${info.default}}`
          });
        } else {
          const sampleVal = info.name.toLowerCase() === 'project' ? inferred.project : (info.name.toLowerCase() === 'module' ? inferred.module : 'value');
          items.push({
            label: `field ${info.name}`,
            kind: CompletionItemKind.Field,
            detail: `Field: ${info.name}${requiredText}`,
            sortText: `${sortPrefix}${info.name}`,
            filterText: `field ${info.name} ${info.name}`,
            insertTextFormat: InsertTextFormat.Snippet,
            textEdit: TextEdit.replace(
              { start: { line: position.line, character: prefixCol }, end: position },
              `field ${info.name} = \${1:${sampleVal}}`
            ),
            insertText: `field ${info.name} = \${1:${sampleVal}}`
          });
        }
      }
      return items;
    }

    // If cursor is in Scenario of @testcase:
    if (gContext.section === 'scenario' && docScope === 'testcase') {
      const inferred = inferContextValues(document.uri);
      const applicableFields = [...scanner.customFields.values()].filter(f => {
        if (!f.scopes || f.scopes.length === 0 || f.scopes.includes('global')) return true;
        if (f.scopes.includes('testcase')) return true;
        return false;
      });

      const requiredFields = applicableFields.filter(f => f.required);

      // Offer "⚡ Implement all required fields for this scenario"
      let tabIdx = 1;
      const reqLines = requiredFields.map((f, idx) => {
        const pfx = idx === 0 ? '' : '    * ';
        let valStr = '';
        if (f.enum && f.enum.length > 0) {
          valStr = `\${indexVar|${f.enum.map(e => e.replace(/[,|\\/]/g, '')).join(',')}|}`.replace('indexVar', String(tabIdx++));
        } else if (f.default !== undefined) {
          valStr = `\${indexVar:${f.default}}`.replace('indexVar', String(tabIdx++));
        } else if (f.name.toLowerCase() === 'project') {
          valStr = `\${indexVar:${inferred.project}}`.replace('indexVar', String(tabIdx++));
        } else if (f.name.toLowerCase() === 'module') {
          valStr = `\${indexVar:${inferred.module}}`.replace('indexVar', String(tabIdx++));
        } else {
          valStr = `\${indexVar:value}`.replace('indexVar', String(tabIdx++));
        }
        return `${pfx}field ${f.name} = ${valStr}`;
      }).join('\n');

      items.push({
        label: '⚡ Implement all required fields for this scenario',
        kind: CompletionItemKind.Snippet,
        detail: `Testform Contract: Implement scenario required fields (${requiredFields.map(f => f.name).join(', ')})`,
        sortText: '00_scenario_required',
        insertTextFormat: InsertTextFormat.Snippet,
        filterText: 'implement required fields scenario * field',
        textEdit: TextEdit.replace(
          { start: { line: position.line, character: prefixCol }, end: position },
          reqLines
        ),
        insertText: reqLines
      });

      // Individual fields with priority sorting
      for (const info of applicableFields) {
        const requiredText = info.required ? ' (Required)' : '';
        const sortPrefix = info.required ? '10_' : '20_';
        if (info.enum && info.enum.length > 0) {
          const cleanChoices = info.enum.map(e => e.replace(/[,|\\/]/g, ''));
          items.push({
            label: `field ${info.name}`,
            kind: CompletionItemKind.Field,
            detail: `Field: ${info.name}${requiredText}`,
            sortText: `${sortPrefix}${info.name}`,
            filterText: `field ${info.name} ${info.name}`,
            insertTextFormat: InsertTextFormat.Snippet,
            textEdit: TextEdit.replace(
              { start: { line: position.line, character: prefixCol }, end: position },
              `field ${info.name} = \${1|${cleanChoices.join(',')}|}`
            ),
            insertText: `field ${info.name} = \${1|${cleanChoices.join(',')}|}`
          });
        } else if (info.default !== undefined) {
          items.push({
            label: `field ${info.name}`,
            kind: CompletionItemKind.Field,
            detail: `Field: ${info.name}${requiredText} (default: ${info.default})`,
            sortText: `${sortPrefix}${info.name}`,
            filterText: `field ${info.name} ${info.name}`,
            insertTextFormat: InsertTextFormat.Snippet,
            textEdit: TextEdit.replace(
              { start: { line: position.line, character: prefixCol }, end: position },
              `field ${info.name} = \${1:${info.default}}`
            ),
            insertText: `field ${info.name} = \${1:${info.default}}`
          });
        } else {
          const sampleVal = info.name.toLowerCase() === 'project' ? inferred.project : (info.name.toLowerCase() === 'module' ? inferred.module : 'value');
          items.push({
            label: `field ${info.name}`,
            kind: CompletionItemKind.Field,
            detail: `Field: ${info.name}${requiredText}`,
            sortText: `${sortPrefix}${info.name}`,
            filterText: `field ${info.name} ${info.name}`,
            insertTextFormat: InsertTextFormat.Snippet,
            textEdit: TextEdit.replace(
              { start: { line: position.line, character: prefixCol }, end: position },
              `field ${info.name} = \${1:${sampleVal}}`
            ),
            insertText: `field ${info.name} = \${1:${sampleVal}}`
          });
        }
      }
    }

    // Inside Scenario:
    // Suggest marks according to resource scope:
    // - In testrun: mark status, mark trace, mark evidence (NO mark target, target is scenario)
    // - In bug: mark target, mark status, mark trace, mark evidence
    const isSetTrigger = rest.startsWith('s') || ['status', 'target', 'trace', 'evidence'].some(k => rest.startsWith(k));
    if (docScope === 'testrun' || (docScope === 'bug' && isSetTrigger) || isSetTrigger) {
      if (docScope === 'testrun') {
        items.push(
          {
            label: 'set status = ...',
            kind: CompletionItemKind.Snippet,
            detail: 'Testform DSL: Set execution status',
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: 'set status status',
            textEdit: TextEdit.replace(
              { start: { line: position.line, character: prefixCol }, end: position },
              'set status = ${1|passed,failed,pending,skipped,blocked,unexecuted|}'
            ),
            insertText: 'set status = ${1|passed,failed,pending,skipped,blocked,unexecuted|}'
          },
          {
            label: 'set trace = ...',
            kind: CompletionItemKind.Snippet,
            detail: 'Testform DSL: Record failure trace or error detail',
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: 'set trace trace',
            textEdit: TextEdit.replace(
              { start: { line: position.line, character: prefixCol }, end: position },
              'set trace = "${1:trace description or error stack}"'
            ),
            insertText: 'set trace = "${1:trace description or error stack}"'
          },
          {
            label: 'set evidence = ...',
            kind: CompletionItemKind.Snippet,
            detail: 'Testform DSL: Attach execution evidence (screenshot, file, URL)',
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: 'set evidence evidence',
            textEdit: TextEdit.replace(
              { start: { line: position.line, character: prefixCol }, end: position },
              'set evidence = "${1:evidence.png or url}"'
            ),
            insertText: 'set evidence = "${1:evidence.png or url}"'
          }
        );
        return items;
      } else if (docScope === 'bug') {
        items.push(
          {
            label: 'set target = ...',
            kind: CompletionItemKind.Snippet,
            detail: 'Testform DSL: Set failing test case canonical target',
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: 'set target target',
            textEdit: TextEdit.replace(
              { start: { line: position.line, character: prefixCol }, end: position },
              'set target = ${1:testcase/path.case.feature.@tc-01}'
            ),
            insertText: 'set target = ${1:testcase/path.case.feature.@tc-01}'
          },
          {
            label: 'set status = ...',
            kind: CompletionItemKind.Snippet,
            detail: 'Testform DSL: Set defect status',
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: 'set status status',
            textEdit: TextEdit.replace(
              { start: { line: position.line, character: prefixCol }, end: position },
              'set status = ${1|failed,passed,pending|}'
            ),
            insertText: 'set status = ${1|failed,passed,pending|}'
          },
          {
            label: 'set trace = ...',
            kind: CompletionItemKind.Snippet,
            detail: 'Testform DSL: Record failure trace or error detail',
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: 'set trace trace',
            textEdit: TextEdit.replace(
              { start: { line: position.line, character: prefixCol }, end: position },
              'set trace = "${1:trace description or error stack}"'
            ),
            insertText: 'set trace = "${1:trace description or error stack}"'
          },
          {
            label: 'set evidence = ...',
            kind: CompletionItemKind.Snippet,
            detail: 'Testform DSL: Attach execution evidence (screenshot, file, URL)',
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: 'set evidence evidence',
            textEdit: TextEdit.replace(
              { start: { line: position.line, character: prefixCol }, end: position },
              'set evidence = "${1:evidence.png or url}"'
            ),
            insertText: 'set evidence = "${1:evidence.png or url}"'
          }
        );
        return items;
      }
    }
  }

  if (/(?:set\s+)?status\s*=\s*[a-zA-Z]*$/i.test(lineText)) {
    const statuses = ['passed', 'failed', 'pending', 'skipped', 'blocked', 'unexecuted'];
    return statuses.map(s => ({
      label: s,
      kind: CompletionItemKind.EnumMember,
      detail: `Execution Status: ${s}`,
      insertText: s
    }));
  }

  if (/(?:set\s+)?target\s*=\s*.*$/i.test(lineText)) {
    for (const [address, info] of scanner.config.scenarioAddresses.entries()) {
      items.push({
        label: address,
        kind: CompletionItemKind.Reference,
        detail: `${info.tag}: ${info.title}`,
        documentation: {
          kind: MarkupKind.Markdown,
          value: `### 🎯 Canonical Target\n\n**Tag:** \`${info.tag}\`\n\n**Title:** ${info.title}\n\n*File:* \`${info.sourceFile}\``
        },
        insertText: address
      });
    }
    return items;
  }

  // 5.1 Suggest field names when typing "field" or "field <name>"
  const fieldNameMatch = lineText.match(/(?:^|\s+)field(?:\s+([a-zA-Z0-9_.-]*))?$/i);
  if (fieldNameMatch) {
    const docUri = document.uri.toLowerCase();
    const docContent = document.getText();
    let currentResourceType: 'testcase' | 'testrun' | 'testplan' | 'bug' | 'other' = 'other';
    const tcPat = scanner.config.scopes.testcase || '*.case.feature';
    const trPat = scanner.config.scopes.testrun || '*.run.feature';
    const tpPat = scanner.config.scopes.testplan || '*.plan.feature';
    const bgPat = scanner.config.scopes.bug || '*.bug.feature';

    const matchesPat = (p: string, pat: string) => new RegExp(pat.replace(/\*/g, '.*') + '$', 'i').test(p);
    if (matchesPat(docUri, tcPat) || docContent.includes('@testcase')) currentResourceType = 'testcase';
    else if (matchesPat(docUri, trPat) || docContent.includes('@testrun')) currentResourceType = 'testrun';
    else if (matchesPat(docUri, tpPat) || docContent.includes('@testplan')) currentResourceType = 'testplan';
    else if (matchesPat(docUri, bgPat) || docContent.includes('@bug')) currentResourceType = 'bug';

    // 1. Defined fields in main.yml / workspace filtered by resource scope
    for (const [, info] of scanner.customFields.entries()) {
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
          kind: CompletionItemKind.Field, // Icono de campo oficial
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
          kind: CompletionItemKind.Field,
          detail: `Field: ${info.name}${requiredText} (default: ${info.default})`,
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `${info.name} = \${1:${info.default}}`
        });
      } else {
        items.push({
          label: info.name,
          kind: CompletionItemKind.Field,
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
            kind: CompletionItemKind.Field,
            detail: f.desc,
            insertTextFormat: InsertTextFormat.Snippet,
            insertText: `${f.name} = \${1|${f.enum.join(',')}|}`
          });
        } else {
          items.push({
            label: f.name,
            kind: CompletionItemKind.Field,
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
      kind: CompletionItemKind.Keyword,
      detail: 'Testform DSL: Set custom metadata field',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'field ${1:name} = ${2:value}'
    });
    return items;
  }

  // 5.3 Suggest values after "field <name> = " (ensuring space after =)
  const fieldValueMatch = lineText.match(/(?:^|\s+)field\s+([a-zA-Z0-9_.-]+)\s*(=)(\s*)([a-zA-Z0-9_.-]*)$/i);
  if (fieldValueMatch) {
    const fieldName = fieldValueMatch[1].toLowerCase();
    const hasSpaceAfterEquals = fieldValueMatch[3].length > 0;
    const formatValueInsert = (v: string) => hasSpaceAfterEquals ? v : ` ${v}`;
    const custom = scanner.customFields.get(fieldName);

    if (custom && custom.enum && custom.enum.length > 0) {
      return custom.enum.map(e => ({
        label: e,
        kind: CompletionItemKind.Value,
        detail: `Allowed Value for '${custom.name}': ${e}`,
        insertText: formatValueInsert(e)
      }));
    }

    if (fieldName === 'priority') {
      return ['Critical', 'High', 'Medium', 'Low'].map(v => ({
        label: v,
        kind: CompletionItemKind.Value,
        detail: `Priority: ${v}`,
        insertText: formatValueInsert(v)
      }));
    }
    if (fieldName === 'severity') {
      return ['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'].map(v => ({
        label: v,
        kind: CompletionItemKind.Value,
        detail: `Severity: ${v}`,
        insertText: formatValueInsert(v)
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
        detail: `Examples column: ${header}`,
        documentation: {
          kind: MarkupKind.Markdown,
          value: `**Table parameter:** \`<${header}>\`\n\nDefined in the \`Examples:\` table of this Scenario Outline.`
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
    const internalTags = [...docText.matchAll(/@(tc|tr|tp|bg)-[0-9]+/gi)].map(m => m[0].toLowerCase());
    const uniqueInternal = [...new Set(internalTags)];
    for (const tag of uniqueInternal) {
      items.push({
        label: tag,
        kind: CompletionItemKind.Reference,
        detail: `Internal reference in this feature (${tag})`,
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

  // 8. Identity Tag next-ID completion (@tc-, @tr-, @tp-, @bg-)
  const tcPrefixMatch = lineText.match(/@(tc|tr|tp|bg)-?([0-9]*)$/i);
  if (tcPrefixMatch) {
    const prefix = tcPrefixMatch[1].toLowerCase() as 'tc' | 'tr' | 'tp' | 'bg';
    const nextTag = getNextIdForDocument(document.getText(), prefix, scanner.config.maxIdentityIds[prefix]);

    items.push({
      label: nextTag,
      kind: CompletionItemKind.Value,
      detail: `Suggested next ID for this file (@${nextTag})`,
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
              kind: CompletionItemKind.Unit,
              documentation: {
                kind: MarkupKind.Markdown,
                value: `### 🧪 Test Case Target\n\n**Title:** ${info.title}\n\n- **Tag:** \`${info.tag}\`\n- **Rule:** \`${enclosingRule}\``
              },
              insertText: cleanTag
            });
          }
        }
      }
    }

    // Resources: All use the exact same Class icon (standard Resource representation)
    items.push(
      {
        label: 'testcase',
        kind: CompletionItemKind.Class,
        detail: 'resource',
        insertText: 'testcase'
      },
      {
        label: 'testrun',
        kind: CompletionItemKind.Class,
        detail: 'resource',
        insertText: 'testrun'
      },
      {
        label: 'testplan',
        kind: CompletionItemKind.Class,
        detail: 'resource',
        insertText: 'testplan'
      },
      {
        label: 'bug',
        kind: CompletionItemKind.Class,
        detail: 'resource',
        insertText: 'bug'
      },
      {
        label: 'depends_on',
        kind: CompletionItemKind.Property,
        detail: 'directive',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'depends_on("${1:target}")'
      }
    );

    // Dynamic tags declared in workspace configuration (fields with source: "tag")
    // Clean "field" label on the right side for immediate identification
    for (const [, fieldInfo] of scanner.customFields.entries()) {
      if (fieldInfo.source === 'tag') {
        if (fieldInfo.enum && fieldInfo.enum.length > 0) {
          for (const enumVal of fieldInfo.enum) {
            const cleanTag = enumVal.replace(/^@/, '');
            items.push({
              label: `${fieldInfo.name}: @${cleanTag}`,
              filterText: `${fieldInfo.name} ${cleanTag} @${cleanTag}`,
              kind: CompletionItemKind.EnumMember,
              detail: 'field',
              documentation: `Allowed value for tag field '${fieldInfo.name}'.\nOptions: ${fieldInfo.enum.join(', ')}`,
              insertText: cleanTag
            });
          }
        } else {
          items.push({
            label: `${fieldInfo.name}`,
            filterText: `${fieldInfo.name} @${fieldInfo.name}`,
            kind: CompletionItemKind.EnumMember,
            detail: 'field',
            documentation: `Tag field configured in workspace: '${fieldInfo.name}'`,
            insertText: fieldInfo.name
          });
        }
      }
    }

    // Next ID computed for THIS document
    let activePrefix: 'tc' | 'tr' | 'tp' | 'bg' = 'tc';
    if (docUri.includes('.run.') || docText.includes('@testrun')) {
      activePrefix = 'tr';
    } else if (docUri.includes('.plan.') || docText.includes('@testplan')) {
      activePrefix = 'tp';
    } else if (docUri.includes('.bug.') || docText.includes('@bug')) {
      activePrefix = 'bg';
    }

    const nextIdTag = getNextIdForDocument(docText, activePrefix, scanner.config.maxIdentityIds[activePrefix]);
    items.push({
      label: nextIdTag,
      kind: CompletionItemKind.Value,
      detail: 'identity',
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
