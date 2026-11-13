import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
  MarkupKind
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceScanner } from './workspace-scanner';
import { BUILTIN_FUNCTIONS } from './completions';



export function provideYamlCompletions(
  document: TextDocument,
  position: Position,
  scanner: WorkspaceScanner
): CompletionItem[] {
  const lineText = document.getText({
    start: { line: position.line, character: 0 },
    end: position
  });

  const fullTextBefore = document.getText({
    start: { line: 0, character: 0 },
    end: position
  });

  const items: CompletionItem[] = [];

  // 1. Inside expressions: "${...}" in YAML strings
  if (/\$\{var\.[a-zA-Z0-9_]*$/.test(lineText)) {
    for (const [name, info] of scanner.config.variables.entries()) {
      items.push({
        label: name,
        kind: CompletionItemKind.Variable,
        detail: `(${info.type || 'string'}) ${info.sourceFile.split(/[/\\]/).pop()}`,
        documentation: {
          kind: MarkupKind.Markdown,
          value: `**Testform Variable:** \`${name}\`\n\nDefault: \`${JSON.stringify(info.defaultValue)}\``
        },
        insertText: name
      });
    }
    return items;
  }

  if (/\$\{local\.[a-zA-Z0-9_]*$/.test(lineText)) {
    for (const [name, info] of scanner.config.locals.entries()) {
      const fileName = info.sourceFile.split(/[/\\]/).pop();
      items.push({
        label: name,
        kind: CompletionItemKind.Variable,
        detail: `Local expression: ${info.expression} (${fileName})`,
        documentation: {
          kind: MarkupKind.Markdown,
          value: `**Testform Local:** \`${name}\`\n\n**Expression:** \`${info.expression}\`\n\n*Source:* \`${info.sourceFile}\``
        },
        insertText: name
      });
    }
    return items;
  }

  if (/\$\{[a-zA-Z0-9_]*$/.test(lineText)) {
    items.push(
      { label: 'var.', kind: CompletionItemKind.Module, detail: 'Input Variable reference', insertText: 'var.' },
      { label: 'local.', kind: CompletionItemKind.Module, detail: 'Computed Local reference', insertText: 'local.' },
      { label: 'data.', kind: CompletionItemKind.Module, detail: 'Data source reference', insertText: 'data.' },
      { label: 'module.', kind: CompletionItemKind.Module, detail: 'Module output reference', insertText: 'module.' },
      { label: 'testcase.', kind: CompletionItemKind.Module, detail: 'Testcase state attribute', insertText: 'testcase.' },
      { label: 'testrun.', kind: CompletionItemKind.Module, detail: 'Testrun state attribute', insertText: 'testrun.' }
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

  // 2. Inline completions immediately after a colon on the SAME line
  const inlineColonMatch = lineText.match(/^\s*([a-zA-Z0-9_-]+)\s*:\s*([a-zA-Z0-9_.-]*)$/);
  if (inlineColonMatch) {
    const key = inlineColonMatch[1].toLowerCase();

    // Scalar fields that accept inline values
    if (key === 'provider') {
      return [
        { label: 'local', kind: CompletionItemKind.EnumMember, detail: 'Offline Local Provider', insertText: 'local' },
        { label: 'github', kind: CompletionItemKind.EnumMember, detail: 'GitHub Projects Provider', insertText: 'github' },
        { label: 'gitlab', kind: CompletionItemKind.EnumMember, detail: 'GitLab Issues Provider', insertText: 'gitlab' },
        { label: 'custom', kind: CompletionItemKind.EnumMember, detail: 'Custom Provider (source path)', insertText: 'custom' }
      ];
    }

    if (key === 'backend') {
      return [
        { label: 'local', kind: CompletionItemKind.EnumMember, detail: 'Local State Ledger (testform.state)', insertText: 'local' },
        { label: 's3', kind: CompletionItemKind.EnumMember, detail: 'Amazon S3 Bucket', insertText: 's3' },
        { label: 'gcs', kind: CompletionItemKind.EnumMember, detail: 'Google Cloud Storage', insertText: 'gcs' },
        { label: 'azurerm', kind: CompletionItemKind.EnumMember, detail: 'Azure Blob Storage', insertText: 'azurerm' },
        { label: 'http', kind: CompletionItemKind.EnumMember, detail: 'HTTP REST Ledger', insertText: 'http' }
      ];
    }

    if (key === 'type') {
      return ['string', 'number', 'boolean', 'list', 'map'].map(t => ({
        label: t,
        kind: CompletionItemKind.EnumMember,
        detail: `Type: ${t}`,
        insertText: t
      }));
    }

    if (key === 'source') {
      return [
        { label: 'step', kind: CompletionItemKind.EnumMember, detail: 'Extracted from Gherkin step text', insertText: 'step' },
        { label: 'tag', kind: CompletionItemKind.EnumMember, detail: 'Extracted from scenario tag', insertText: 'tag' }
      ];
    }

    if (key === 'required' || key === 'sensitive') {
      return [
        { label: 'true', kind: CompletionItemKind.EnumMember, insertText: 'true' },
        { label: 'false', kind: CompletionItemKind.EnumMember, insertText: 'false' }
      ];
    }

    if (key === 'version') {
      return [
        { label: '"1.0"', kind: CompletionItemKind.Value, insertText: '"1.0"' }
      ];
    }

    if (key === 'identity') {
      const beforeLines = fullTextBefore.split('\n');
      const curIndent = lineText.match(/^\s*/)?.[0].length || 0;
      let scopeHint: string | undefined;
      for (let i = beforeLines.length - 2; i >= 0; i--) {
        const trimmed = beforeLines[i].trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const ind = beforeLines[i].match(/^\s*/)?.[0].length || 0;
        if (ind < curIndent) {
          const m = trimmed.match(/^(testcase|testrun|testplan|bug)\s*:/i);
          if (m) scopeHint = m[1].toLowerCase();
          break;
        }
      }
      const defaults: Record<string, string> = {
        testcase: 'tc-*',
        testrun: 'tr-*',
        testplan: 'tp-*',
        bug: 'bg-*'
      };
      const preferred = (scopeHint && defaults[scopeHint]) || 'tc-*';
      const ordered = [preferred, ...Object.values(defaults).filter(d => d !== preferred)];
      return ordered.map((pat, idx) => ({
        label: `"${pat}"`,
        kind: CompletionItemKind.Value,
        detail: idx === 0 && scopeHint ? `Default ${scopeHint} identity tag pattern` : 'Identity tag pattern (e.g. "flaviotag-*")',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: `"${pat}"`,
        sortText: `0_${idx}`
      }));
    }

    // CRITICAL FIX: If key is a dictionary parent (variable, locals, resource, data, module, output)
    // DO NOT emit properties inline on the same line! They require a line break + indent.
    const DICTIONARY_PARENTS = new Set([
      'variable', 'variables', 'vars',
      'locals', 'local',
      'resource', 'scopes',
      'data',
      'module', 'modules',
      'output', 'outputs',
      'policy', 'fields', 'scaffold'
    ]);
    if (DICTIONARY_PARENTS.has(key)) {
      return [];
    }
  }

  // 3. New line completions: Parse YAML ancestry by looking up smaller indents
  const lines = fullTextBefore.split('\n');
  const currentIndent = lineText.match(/^\s*/)?.[0].length || 0;

  // Build breadcrumb hierarchy
  const ancestry: string[] = [];
  let targetIndent = currentIndent;

  for (let i = lines.length - 2; i >= 0; i--) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const lineIndent = rawLine.match(/^\s*/)?.[0].length || 0;
    if (lineIndent < targetIndent) {
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:/);
      if (match) {
        ancestry.unshift(match[1]);
        targetIndent = lineIndent;
        if (lineIndent === 0) break;
      }
    }
  }

  const rootSection = ancestry[0]?.toLowerCase() || '';

  // Case A: Root Level (indent === 0)
  if (currentIndent === 0) {
    return [
      {
        label: 'version: "1.0"',
        kind: CompletionItemKind.Property,
        detail: 'Testform manifest version',
        insertText: 'version: "1.0"'
      },
      {
        label: 'provider:',
        kind: CompletionItemKind.Property,
        detail: 'Provider configuration (local, github, gitlab, custom)',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'provider: ${1|local,github,gitlab,custom|}'
      },
      {
        label: 'backend:',
        kind: CompletionItemKind.Property,
        detail: 'State backend ledger configuration (local, s3, gcs, azurerm, http)',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'backend: ${1|local,s3,gcs,azurerm,http|}'
      },
      {
        label: 'variable:',
        kind: CompletionItemKind.Property,
        detail: 'Input variables declaration block',
        insertText: 'variable:\n  '
      },
      {
        label: 'locals:',
        kind: CompletionItemKind.Property,
        detail: 'Computed local expressions block (Terraform-style)',
        insertText: 'locals:\n  '
      },
      {
        label: 'resource:',
        kind: CompletionItemKind.Property,
        detail: 'Resource scopes and scaffolding configuration',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'resource:\n  testcase:\n    match: "${1:*.case.feature}"\n    identity: "${2:tc-*}"\n    scaffold:\n      directory: "testcase"\n      filename: "{slug}.case.feature"\n    fields: {}\n  testrun:\n    match: "${3:*.run.feature}"\n    identity: "${4:tr-*}"\n    scaffold:\n      directory: "testrun"\n      filename: "{slug}.run.feature"\n    fields: {}\n  testplan:\n    match: "${5:*.plan.feature}"\n    identity: "${6:tp-*}"\n    scaffold:\n      directory: "testplan"\n      filename: "{slug}.plan.feature"\n    fields: {}'
      },
      {
        label: 'data:',
        kind: CompletionItemKind.Property,
        detail: 'Data sources block (fixtures, http, state)',
        insertText: 'data:\n  '
      },
      {
        label: 'module:',
        kind: CompletionItemKind.Property,
        detail: 'Reusable feature modules block',
        insertText: 'module:\n  '
      },
      {
        label: 'output:',
        kind: CompletionItemKind.Property,
        detail: 'Exported output values block',
        insertText: 'output:\n  '
      },
      {
        label: 'policy:',
        kind: CompletionItemKind.Property,
        detail: 'Governance and quality control policies',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'policy:\n  disabled:\n    - "${1:policy-id}"'
      }
    ];
  }

  // Case B: Inside "variable"
  if (rootSection === 'variable' || rootSection === 'variables' || rootSection === 'vars') {
    // Indent 2: Declaring variable name
    if (ancestry.length === 1) {
      return [
        {
          label: 'var_name (Full)',
          kind: CompletionItemKind.Property,
          detail: 'Declare complete variable with type, default, description, sensitive, enum, and validation',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:var_name}:\n  type: ${2|string,number,boolean,list,map|}\n  description: "${3:Variable description}"\n  default: "${4:value}"\n  sensitive: ${5|false,true|}\n  enum:\n    - "${6:option1}"\n    - "${7:option2}"\n  validation:\n    condition: "${8:condition}"\n    error_message: "${9:Error message}"'
        },
        {
          label: 'var_name (Standard)',
          kind: CompletionItemKind.Property,
          detail: 'Declare variable with standard schema (type, description, default)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:var_name}:\n  type: ${2|string,number,boolean,list,map|}\n  description: "${3:Variable description}"\n  default: "${4:value}"'
        }
      ];
    }
    // Indent 4: Inside a specific variable definition
    if (ancestry.length >= 2) {
      return [
        { label: 'type:', kind: CompletionItemKind.Property, detail: 'Data type (string, number, boolean, list, map)', insertText: 'type: ' },
        { label: 'description:', kind: CompletionItemKind.Property, detail: 'Descriptive documentation string', insertTextFormat: InsertTextFormat.Snippet, insertText: 'description: "${1:Description}"' },
        { label: 'default:', kind: CompletionItemKind.Property, detail: 'Default value', insertTextFormat: InsertTextFormat.Snippet, insertText: 'default: "${1:value}"' },
        { label: 'sensitive:', kind: CompletionItemKind.Property, detail: 'Hide variable value from logs and console', insertText: 'sensitive: true' },
        { label: 'enum:', kind: CompletionItemKind.Property, detail: 'List of allowed values', insertTextFormat: InsertTextFormat.Snippet, insertText: 'enum:\n  - "${1:option1}"\n  - "${2:option2}"' },
        { label: 'validation:', kind: CompletionItemKind.Property, detail: 'Validation rule with condition and error message', insertTextFormat: InsertTextFormat.Snippet, insertText: 'validation:\n  condition: "${1:condition}"\n  error_message: "${2:Error message}"' }
      ];
    }
  }

  // Case C: Inside "local" / "locals"
  if (rootSection === 'local' || rootSection === 'locals') {
    return [
      {
        label: 'local_name: "${var.variable}"',
        kind: CompletionItemKind.Property,
        detail: 'Define computed local expression',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: '${1:local_name}: "\${${2:var.variable}}"'
      },
      {
        label: 'local_name: "value"',
        kind: CompletionItemKind.Property,
        detail: 'Define literal local value',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: '${1:local_name}: "${2:value}"'
      }
    ];
  }

  // Case D: Inside "resource" / "scopes"
  if (rootSection === 'resource' || rootSection === 'scopes') {
    // Indent 2: Scopes selection
    if (ancestry.length === 1) {
      return [
        {
          label: 'testcase:',
          kind: CompletionItemKind.Property,
          detail: 'TestCase scope mapping and scaffolding',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'testcase:\n  match: "${1:*.case.feature}"\n  identity: "${2:tc-*}"\n  scaffold:\n    directory: "testcase"\n    filename: "{slug}.case.feature"\n  fields: {}'
        },
        {
          label: 'testrun:',
          kind: CompletionItemKind.Property,
          detail: 'TestRun scope mapping and scaffolding',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'testrun:\n  match: "${1:*.run.feature}"\n  identity: "${2:tr-*}"\n  scaffold:\n    directory: "testrun"\n    filename: "{slug}.run.feature"\n  fields: {}'
        },
        {
          label: 'testplan:',
          kind: CompletionItemKind.Property,
          detail: 'TestPlan scope mapping and scaffolding',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'testplan:\n  match: "${1:*.plan.feature}"\n  identity: "${2:tp-*}"\n  scaffold:\n    directory: "testplan"\n    filename: "{slug}.plan.feature"\n  fields: {}'
        },
        {
          label: 'bug:',
          kind: CompletionItemKind.Property,
          detail: 'Bug scope mapping and scaffolding',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'bug:\n  match: "${1:*.bug.feature}"\n  identity: "${2:bg-*}"\n  scaffold:\n    directory: "bugs"\n    filename: "{slug}.bug.feature"\n  fields: {}'
        },
        {
          label: 'global:',
          kind: CompletionItemKind.Property,
          detail: 'Global fields definition across all scopes',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'global:\n  fields: {}'
        }
      ];
    }

    // Indent 4: Inside resource.testcase, testrun, etc.
    if (ancestry.length === 2) {
      const scopeName = ancestry[1]?.toLowerCase();
      const defaultIdentity =
        scopeName === 'testrun' ? 'tr-*' :
        scopeName === 'testplan' ? 'tp-*' :
        scopeName === 'bug' ? 'bg-*' :
        'tc-*';
      const defaultMatch =
        scopeName === 'testrun' ? '*.run.feature' :
        scopeName === 'testplan' ? '*.plan.feature' :
        scopeName === 'bug' ? '*.bug.feature' :
        '*.case.feature';
      const defaultDir = scopeName || 'testcase';
      const defaultFile = `{slug}${defaultMatch.replace(/^\*/, '')}`;

      return [
        { label: 'match:', kind: CompletionItemKind.Property, detail: 'Glob pattern for feature files', insertTextFormat: InsertTextFormat.Snippet, insertText: `match: "\${1:${defaultMatch}}"` },
        { label: 'identity:', kind: CompletionItemKind.Property, detail: 'Custom scenario identity tag pattern (e.g. "tc-*", "flaviotag-*")', insertTextFormat: InsertTextFormat.Snippet, insertText: `identity: "\${1:${defaultIdentity}}"` },
        { label: 'scaffold:', kind: CompletionItemKind.Property, detail: 'Scaffolding directory and filename pattern', insertTextFormat: InsertTextFormat.Snippet, insertText: `scaffold:\n  directory: "\${1:${defaultDir}}"\n  filename: "\${2:${defaultFile}}"` },
        { label: 'fields:', kind: CompletionItemKind.Property, detail: 'Custom metadata fields definition', insertText: 'fields:\n  ' }
      ];
    }

    // Inside fields: (ancestry: ['resource', 'testcase', 'fields'])
    if (ancestry.includes('fields')) {
      const lastKey = ancestry[ancestry.length - 1].toLowerCase();
      if (lastKey === 'fields') {
        // Suggest field name
        return [
          {
            label: 'field_name:',
            kind: CompletionItemKind.Property,
            detail: 'Define metadata field extracted from step or tag',
            insertTextFormat: InsertTextFormat.Snippet,
            insertText: '${1:field_name}:\n  source: ${2|step,tag|}\n  required: ${3|false,true|}'
          }
        ];
      } else {
        // Properties of the field: source, required, default, enum
        return [
          { label: 'source:', kind: CompletionItemKind.Property, detail: 'Source type: step or tag', insertTextFormat: InsertTextFormat.Snippet, insertText: 'source: ${1|step,tag|}' },
          { label: 'required:', kind: CompletionItemKind.Property, detail: 'Whether this field is mandatory', insertTextFormat: InsertTextFormat.Snippet, insertText: 'required: ${1|false,true|}' },
          { label: 'default:', kind: CompletionItemKind.Property, detail: 'Default value for the field', insertTextFormat: InsertTextFormat.Snippet, insertText: 'default: "${1:default_value}"' },
          { label: 'enum:', kind: CompletionItemKind.Property, detail: 'Allowed values list', insertTextFormat: InsertTextFormat.Snippet, insertText: 'enum:\n  - "${1:@low}"\n  - "${2:@high}"' }
        ];
      }
    }
  }

  // Case E: Inside "data"
  if (rootSection === 'data') {
    if (ancestry.length === 1) {
      return [
        {
          label: 'fixture_data: "fixtures/users.json"',
          kind: CompletionItemKind.Property,
          detail: 'Compact local JSON/YAML fixture source',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:users}: "fixtures/${2:users.json}"'
        },
        {
          label: 'api_data: "https://api..."',
          kind: CompletionItemKind.Property,
          detail: 'Compact HTTP REST data source',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:api_data}: "https://${2:api.example.com/users}"'
        },
        {
          label: 'state_alias: "auth/login.case.feature.@tc-1"',
          kind: CompletionItemKind.Property,
          detail: 'Testform state address reference alias',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:login_core}: "${2:auth/login.case.feature.@tc-1}"'
        },
        {
          label: 'http_api (Configured REST endpoint)',
          kind: CompletionItemKind.Property,
          detail: 'Configured HTTP REST data source with headers and body',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:my_api}:\n  url: "https://${2:api.example.com}"\n  method: "${3|GET,POST|}\n  headers:\n    Authorization: "Bearer \${var.token}"\n  timeout: 5000'
        }
      ];
    }
  }

  // Case F: Inside "module" / "modules"
  if (rootSection === 'module' || rootSection === 'modules') {
    if (ancestry.length === 1) {
      return [
        {
          label: 'module_name:',
          kind: CompletionItemKind.Property,
          detail: 'Reusable module (native Terraform parity: direct plain variables)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:auth_module}:\n  source: "${2:auth/login.case.feature}"\n  ${3:param}: "${4:value}"\n  output:\n    ${5:output_name}:\n      value: "${6:value}"'
        }
      ];
    }
    if (ancestry.length === 2) {
      return [
        { label: 'source:', kind: CompletionItemKind.Property, detail: 'Path to feature file, directory, or git repository', insertTextFormat: InsertTextFormat.Snippet, insertText: 'source: "${1:auth/login.case.feature}"' },
        { label: 'output:', kind: CompletionItemKind.Property, detail: 'Block of outputs exported by the module', insertText: 'output:\n  ' }
      ];
    }
    const lastKey = ancestry[ancestry.length - 1];
    if (lastKey === 'output' || lastKey === 'outputs') {
      return [
        {
          label: 'output_name:',
          kind: CompletionItemKind.Property,
          detail: 'Output exported by module',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:output_name}:\n  value: "${2:value}"'
        }
      ];
    }
  }

  // Case G: Inside "output" / "outputs"
  if (rootSection === 'output' || rootSection === 'outputs') {
    if (ancestry.length === 1) {
      return [
        {
          label: 'output_name:',
          kind: CompletionItemKind.Property,
          detail: 'Declare exported root output',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:output_name}:\n  description: "${2:Description}"\n  value: "${3:value}"'
        }
      ];
    }
    if (ancestry.length >= 2) {
      return [
        { label: 'value:', kind: CompletionItemKind.Property, detail: 'Exported expression or value', insertTextFormat: InsertTextFormat.Snippet, insertText: 'value: "${1:value}"' },
        { label: 'description:', kind: CompletionItemKind.Property, detail: 'Output description', insertTextFormat: InsertTextFormat.Snippet, insertText: 'description: "${1:Description}"' },
        { label: 'sensitive:', kind: CompletionItemKind.Property, detail: 'Hide output from console and logs', insertText: 'sensitive: true' }
      ];
    }
  }

  return items;
}
