import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
  MarkupKind
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceScanner } from './workspace-scanner';

interface YamlLineInfo {
  indent: number;
  key: string;
  hasColon: boolean;
  rawText: string;
}

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

    // CRITICAL FIX: If key is a dictionary parent (variable, resource, local, data, modules, outputs)
    // DO NOT emit properties inline on the same line! They require a line break + indent.
    const DICTIONARY_PARENTS = new Set(['variable', 'variables', 'vars', 'local', 'locals', 'resource', 'scopes', 'data', 'modules', 'outputs', 'policy', 'fields', 'scaffold']);
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
        detail: 'Manifest Version',
        insertText: 'version: "1.0"'
      },
      {
        label: 'provider: local',
        kind: CompletionItemKind.Property,
        detail: 'Local Offline Provider',
        insertText: 'provider: local'
      },
      {
        label: 'provider: (GitHub)',
        kind: CompletionItemKind.Property,
        detail: 'GitHub Projects Provider block',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'provider:\n  github:\n    owner: "${1:owner}"\n    repo: "${2:repo}"\n    project_number: ${3:1}'
      },
      {
        label: 'backend: local',
        kind: CompletionItemKind.Property,
        detail: 'Local State Ledger Backend',
        insertText: 'backend: local'
      },
      {
        label: 'backend: (S3)',
        kind: CompletionItemKind.Property,
        detail: 'Amazon S3 Remote State Backend',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'backend:\n  s3:\n    bucket: "${1:my-bucket}"\n    key: "${2:testform.state}"\n    region: "${3:us-east-1}"'
      },
      {
        label: 'variable:',
        kind: CompletionItemKind.Struct,
        detail: 'Input Variable Declaration Block',
        insertText: 'variable:\n  '
      },
      {
        label: 'local:',
        kind: CompletionItemKind.Struct,
        detail: 'Local Computed Expressions Block',
        insertText: 'local:\n  '
      },
      {
        label: 'resource:',
        kind: CompletionItemKind.Struct,
        detail: 'Resource Scope & Scaffolding Configuration',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'resource:\n  testcase:\n    match: "${1:*.case.feature}"\n    scaffold:\n      directory: "testcase"\n      filename: "{slug}.case.feature"\n    fields: {}\n  testrun:\n    match: "${2:*.run.feature}"\n    scaffold:\n      directory: "testrun"\n      filename: "{slug}.run.feature"\n    fields: {}\n  testplan:\n    match: "${3:*.plan.feature}"\n    scaffold:\n      directory: "testplan"\n      filename: "{slug}.plan.feature"\n    fields: {}'
      },
      {
        label: 'data:',
        kind: CompletionItemKind.Struct,
        detail: 'Data Sources Block',
        insertText: 'data:\n  '
      },
      {
        label: 'modules:',
        kind: CompletionItemKind.Struct,
        detail: 'Feature Modules Block',
        insertText: 'modules:\n  '
      },
      {
        label: 'outputs:',
        kind: CompletionItemKind.Struct,
        detail: 'Global Root Outputs Block',
        insertText: 'outputs:\n  '
      },
      {
        label: 'policy:',
        kind: CompletionItemKind.Struct,
        detail: 'Governance & Quality Gate Policies Block',
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
          label: '<var_name>:',
          kind: CompletionItemKind.Field,
          detail: 'Declare new variable with schema',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:var_name}:\n  type: ${2|string,number,boolean,list,map|}\n  description: "${3:Description}"\n  default: "${4:value}"'
        },
        {
          label: '<var_name>: "value"',
          kind: CompletionItemKind.Field,
          detail: 'Declare simple scalar variable',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:var_name}: "${2:value}"'
        }
      ];
    }
    // Indent 4: Inside a specific variable definition
    if (ancestry.length >= 2) {
      return [
        { label: 'type:', kind: CompletionItemKind.Property, detail: 'Data type', insertText: 'type: ' },
        { label: 'description:', kind: CompletionItemKind.Property, detail: 'Documentation text', insertTextFormat: InsertTextFormat.Snippet, insertText: 'description: "${1:Variable description}"' },
        { label: 'default:', kind: CompletionItemKind.Property, detail: 'Default fallback value', insertTextFormat: InsertTextFormat.Snippet, insertText: 'default: "${1:value}"' },
        { label: 'enum:', kind: CompletionItemKind.Property, detail: 'Allowed values list', insertTextFormat: InsertTextFormat.Snippet, insertText: 'enum:\n  - "${1:option1}"\n  - "${2:option2}"' },
        { label: 'validation:', kind: CompletionItemKind.Property, detail: 'Validation rule', insertTextFormat: InsertTextFormat.Snippet, insertText: 'validation:\n  condition: "${1:condition}"\n  error_message: "${2:Error message}"' }
      ];
    }
  }

  // Case C: Inside "local" / "locals"
  if (rootSection === 'local' || rootSection === 'locals') {
    return [
      {
        label: '<local_name>: "${var.app_url}"',
        kind: CompletionItemKind.Field,
        detail: 'Define computed local expression',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: '${1:local_name}: "\${${2:var.app_url}}"'
      },
      {
        label: '<local_name>: "value"',
        kind: CompletionItemKind.Field,
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
          kind: CompletionItemKind.Field,
          detail: 'Testcase Scope Mapping & Scaffolding',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'testcase:\n  match: "${1:*.case.feature}"\n  scaffold:\n    directory: "testcase"\n    filename: "{slug}.case.feature"\n  fields: {}'
        },
        {
          label: 'testrun:',
          kind: CompletionItemKind.Field,
          detail: 'Testrun Scope Mapping & Scaffolding',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'testrun:\n  match: "${1:*.run.feature}"\n  scaffold:\n    directory: "testrun"\n    filename: "{slug}.run.feature"\n  fields: {}'
        },
        {
          label: 'testplan:',
          kind: CompletionItemKind.Field,
          detail: 'Testplan Scope Mapping & Scaffolding',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'testplan:\n  match: "${1:*.plan.feature}"\n  scaffold:\n    directory: "testplan"\n    filename: "{slug}.plan.feature"\n  fields: {}'
        },
        {
          label: 'global:',
          kind: CompletionItemKind.Field,
          detail: 'Global fields definition across all scopes',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'global:\n  fields: {}'
        }
      ];
    }

    // Indent 4: Inside resource.testcase, testrun, etc.
    const parentScope = ancestry[1]?.toLowerCase();
    if (ancestry.length === 2) {
      return [
        { label: 'match:', kind: CompletionItemKind.Property, detail: 'Glob pattern for feature files', insertTextFormat: InsertTextFormat.Snippet, insertText: 'match: "${1:*.case.feature}"' },
        { label: 'scaffold:', kind: CompletionItemKind.Property, detail: 'Scaffolding directory and filename format', insertTextFormat: InsertTextFormat.Snippet, insertText: 'scaffold:\n  directory: "${1:testcase}"\n  filename: "${2:{slug}.case.feature}"' },
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
            label: '<field_name>:',
            kind: CompletionItemKind.Field,
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
          { label: 'default:', kind: CompletionItemKind.Property, detail: 'Default fallback value', insertTextFormat: InsertTextFormat.Snippet, insertText: 'default: "${1:default_value}"' },
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
          label: '<fixture_data>: "fixtures/users.json"',
          kind: CompletionItemKind.Field,
          detail: 'Compact JSON/YAML local fixture source',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:usuarios}: "fixtures/${2:users.json}"'
        },
        {
          label: '<http_api>: "https://api..."',
          kind: CompletionItemKind.Field,
          detail: 'Compact HTTP REST data source',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:api_data}: "https://${2:api.example.com/users}"'
        },
        {
          label: '<state_alias>: "auth/login.case.feature.@tc-1"',
          kind: CompletionItemKind.Field,
          detail: 'Compact State address alias reference',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:login_core}: "${2:auth/login.case.feature.@tc-1}"'
        },
        {
          label: '<http_api>: (REST Object with headers/body)',
          kind: CompletionItemKind.Field,
          detail: 'Configured HTTP REST Data Source',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:my_api}:\n  url: "https://${2:api.example.com}"\n  method: "${3|GET,POST|}"\n  headers:\n    Authorization: "Bearer \${var.token}"\n  timeout: 5000'
        }
      ];
    }
  }

  // Case F: Inside "modules"
  if (rootSection === 'modules') {
    if (ancestry.length === 1) {
      return [
        {
          label: '<module_name>:',
          kind: CompletionItemKind.Field,
          detail: 'Reusable Testform Feature Module',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:auth_module}:\n  source: "${2:auth/login.case.feature}"\n  vars:\n    ${3:role}: "${4:standard_user}"\n  outputs:\n    ${5:login_title}:\n      value: "${6:\\${testcase.auth/login.case.feature.@tc-1.title}}"'
        }
      ];
    }
    if (ancestry.length === 2) {
      return [
        { label: 'source:', kind: CompletionItemKind.Property, detail: 'Path to feature file or directory', insertTextFormat: InsertTextFormat.Snippet, insertText: 'source: "${1:auth/login.case.feature}"' },
        { label: 'scenario:', kind: CompletionItemKind.Property, detail: 'Scenario identity tag filter', insertTextFormat: InsertTextFormat.Snippet, insertText: 'scenario: "${1:@tc-1}"' },
        { label: 'vars:', kind: CompletionItemKind.Property, detail: 'Input parameters passed to module', insertText: 'vars:\n  ' },
        { label: 'outputs:', kind: CompletionItemKind.Property, detail: 'Exported outputs from module', insertText: 'outputs:\n  ' }
      ];
    }
    if (ancestry[ancestry.length - 1] === 'outputs') {
      return [
        {
          label: '<output_name>:',
          kind: CompletionItemKind.Field,
          detail: 'Exported output from module',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:output_name}:\n  value: "${2:\\${testcase.auth/login.case.feature.@tc-1.title}}"'
        }
      ];
    }
  }

  // Case G: Inside "outputs"
  if (rootSection === 'outputs') {
    if (ancestry.length === 1) {
      return [
        {
          label: '<output_name>:',
          kind: CompletionItemKind.Field,
          detail: 'Exported global root output',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:output_name}:\n  description: "${2:Description}"\n  value: "${3:\\${local.base_url}}"'
        }
      ];
    }
    if (ancestry.length >= 2) {
      return [
        { label: 'value:', kind: CompletionItemKind.Property, detail: 'Output expression or value', insertTextFormat: InsertTextFormat.Snippet, insertText: 'value: "${1:\\${var.environment}}"' },
        { label: 'description:', kind: CompletionItemKind.Property, detail: 'Output description text', insertTextFormat: InsertTextFormat.Snippet, insertText: 'description: "${1:Description}"' },
        { label: 'sensitive:', kind: CompletionItemKind.Property, detail: 'Mask output from logs/console', insertText: 'sensitive: true' }
      ];
    }
  }

  return items;
}
