import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
  MarkupKind
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceScanner } from './workspace-scanner';

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
      items.push({
        label: name,
        kind: CompletionItemKind.Value,
        detail: `Local: ${info.expression}`,
        insertText: name
      });
    }
    return items;
  }

  if (/\$\{[a-zA-Z0-9_]*$/.test(lineText)) {
    items.push(
      { label: 'var.', kind: CompletionItemKind.Module, detail: 'Input Variable', insertText: 'var.' },
      { label: 'local.', kind: CompletionItemKind.Module, detail: 'Local computed value', insertText: 'local.' },
      { label: 'data.', kind: CompletionItemKind.Module, detail: 'Data source reference', insertText: 'data.' },
      { label: 'module.', kind: CompletionItemKind.Module, detail: 'Module output reference', insertText: 'module.' },
      { label: 'testcase.', kind: CompletionItemKind.Module, detail: 'Testcase state attribute', insertText: 'testcase.' },
      { label: 'testrun.', kind: CompletionItemKind.Module, detail: 'Testrun state attribute', insertText: 'testrun.' }
    );
    return items;
  }

  // 2. Value completions after colons
  // "provider: "
  if (/^\s*provider\s*:\s*[a-zA-Z0-9_-]*$/i.test(lineText)) {
    items.push(
      {
        label: 'local',
        kind: CompletionItemKind.EnumMember,
        detail: 'Local offline provider (zero configuration)',
        documentation: 'Executes tests locally and records state in testform.state or testform.data without remote tokens.',
        insertText: 'local'
      },
      {
        label: 'github',
        kind: CompletionItemKind.EnumMember,
        detail: 'GitHub Projects & Issues provider',
        documentation: 'Syncs testcases, testruns, and testplans directly to GitHub Issues and Projects V2 boards.',
        insertText: 'github'
      },
      {
        label: 'gitlab',
        kind: CompletionItemKind.EnumMember,
        detail: 'GitLab Issues provider',
        documentation: 'Syncs tests and executions with GitLab Issues.',
        insertText: 'gitlab'
      },
      {
        label: 'custom',
        kind: CompletionItemKind.EnumMember,
        detail: 'Custom user-defined provider',
        documentation: 'Loads an external or local provider driver implementing IProvider.',
        insertText: 'custom'
      }
    );
    return items;
  }

  // "backend: "
  if (/^\s*backend\s*:\s*[a-zA-Z0-9_-]*$/i.test(lineText)) {
    items.push(
      {
        label: 'local',
        kind: CompletionItemKind.EnumMember,
        detail: 'Local state ledger file (testform.state)',
        documentation: 'Stores QA ledger state locally in testform.state within the workspace.',
        insertText: 'local'
      },
      {
        label: 's3',
        kind: CompletionItemKind.EnumMember,
        detail: 'AWS S3 state backend with DynamoDB locking',
        documentation: 'Stores remote state in an Amazon S3 bucket with atomic locking via DynamoDB.',
        insertText: 's3'
      },
      {
        label: 'gcs',
        kind: CompletionItemKind.EnumMember,
        detail: 'Google Cloud Storage state backend',
        documentation: 'Stores remote state ledger in Google Cloud Storage.',
        insertText: 'gcs'
      },
      {
        label: 'azurerm',
        kind: CompletionItemKind.EnumMember,
        detail: 'Azure Blob Storage state backend',
        documentation: 'Stores state ledger in Azure Blob Container.',
        insertText: 'azurerm'
      },
      {
        label: 'http',
        kind: CompletionItemKind.EnumMember,
        detail: 'HTTP / REST state backend',
        documentation: 'Stores state ledger over a secure HTTP/REST endpoint.',
        insertText: 'http'
      }
    );
    return items;
  }

  // "type: " (under variable definition)
  if (/^\s*type\s*:\s*[a-zA-Z]*$/i.test(lineText)) {
    ['string', 'number', 'boolean', 'list', 'map'].forEach(t => {
      items.push({
        label: t,
        kind: CompletionItemKind.TypeParameter,
        detail: `Variable type: ${t}`,
        insertText: t
      });
    });
    return items;
  }

  // Determine section context by analyzing previous lines indentation
  const lines = fullTextBefore.split('\n');
  const currentIndent = lineText.match(/^\s*/)?.[0].length || 0;

  let currentSection = '';
  for (let i = lines.length - 2; i >= 0; i--) {
    const l = lines[i];
    const match = l.match(/^([a-zA-Z0-9_]+)\s*:/);
    if (match) {
      currentSection = match[1];
      break;
    }
  }

  // 3. Sub-property completions
  if (currentIndent > 0) {
    if (currentSection === 'provider') {
      items.push(
        {
          label: 'github:',
          kind: CompletionItemKind.Property,
          detail: 'GitHub Provider Configuration',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'github:\n  owner: "${1:owner}"\n  repo: "${2:repo}"\n  project_number: ${3:1}'
        },
        {
          label: 'local: {}',
          kind: CompletionItemKind.Property,
          detail: 'Local Provider Configuration',
          insertText: 'local: {}'
        },
        {
          label: 'custom:',
          kind: CompletionItemKind.Property,
          detail: 'Custom Provider Configuration',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'custom:\n  source: "${1:./providers/jira.ts}"'
        }
      );
      return items;
    }

    if (currentSection === 'backend') {
      items.push(
        {
          label: 'local:',
          kind: CompletionItemKind.Property,
          detail: 'Local Backend Storage',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'local:\n  path: "${1:testform.state}"'
        },
        {
          label: 's3:',
          kind: CompletionItemKind.Property,
          detail: 'Amazon S3 Backend Storage',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 's3:\n  bucket: "${1:my-bucket}"\n  key: "${2:testform.state}"\n  region: "${3:us-east-1}"\n  dynamodb_table: "${4:testform-locks}"'
        },
        {
          label: 'gcs:',
          kind: CompletionItemKind.Property,
          detail: 'Google Cloud Storage Backend',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'gcs:\n  bucket: "${1:my-gcs-bucket}"\n  prefix: "${2:testform/state}"'
        },
        {
          label: 'azurerm:',
          kind: CompletionItemKind.Property,
          detail: 'Azure RM Blob Storage Backend',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'azurerm:\n  storage_account_name: "${1:mystorage}"\n  container_name: "${2:testform}"\n  key: "${3:testform.state}"'
        }
      );
      return items;
    }

    if (currentSection === 'resource' || currentSection === 'scopes') {
      items.push(
        {
          label: 'testcase:',
          kind: CompletionItemKind.Struct,
          detail: 'Testcase Scope Mapping & Scaffolding',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'testcase:\n  match: "${1:*.case.feature}"\n  scaffold:\n    directory: "${2:testcase}"\n    filename: "${3:{slug}.case.feature}"\n  fields: []'
        },
        {
          label: 'testrun:',
          kind: CompletionItemKind.Struct,
          detail: 'Testrun Scope Mapping & Scaffolding',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'testrun:\n  match: "${1:*.run.feature}"\n  scaffold:\n    directory: "${2:testrun}"\n    filename: "${3:{slug}.run.feature}"\n  fields: []'
        },
        {
          label: 'testplan:',
          kind: CompletionItemKind.Struct,
          detail: 'Testplan Scope Mapping & Scaffolding',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'testplan:\n  match: "${1:*.plan.feature}"\n  scaffold:\n    directory: "${2:testplan}"\n    filename: "${3:{slug}.plan.feature}"\n  fields: []'
        }
      );
      return items;
    }

    if (currentSection === 'data') {
      items.push(
        {
          label: 'fixture_data:',
          kind: CompletionItemKind.Class,
          detail: 'JSON / YAML Fixture Data Source',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:data_name}:\n  file: "${2:fixtures/users.json}"'
        },
        {
          label: 'state_alias:',
          kind: CompletionItemKind.Class,
          detail: 'State Resource Alias Reference',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:core_case}:\n  address: "${2:auth/login.case.feature.@tc-1}"'
        }
      );
      return items;
    }

    if (currentSection === 'modules') {
      items.push({
        label: 'module_block:',
        kind: CompletionItemKind.Module,
        detail: 'Reusable Testform Feature Module',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: '${1:auth_module}:\n  source: "${2:auth/login.case.feature}"\n  vars:\n    ${3:role}: "${4:standard_user}"\n  outputs:\n    ${5:login_title}:\n      value: "${6:\\${testcase.auth/login.case.feature.@tc-1.title}}"'
      });
      return items;
    }

    if (currentSection === 'outputs') {
      items.push({
        label: 'output_block:',
        kind: CompletionItemKind.Variable,
        detail: 'Exported Root Output',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: '${1:output_name}:\n  description: "${2:Description of output}"\n  value: "${3:\\${local.base_url}}"'
      });
      return items;
    }

    if (currentSection === 'variable' || currentSection === 'variables') {
      items.push(
        {
          label: 'type: string',
          kind: CompletionItemKind.Property,
          insertText: 'type: string'
        },
        {
          label: 'type: number',
          kind: CompletionItemKind.Property,
          insertText: 'type: number'
        },
        {
          label: 'type: boolean',
          kind: CompletionItemKind.Property,
          insertText: 'type: boolean'
        },
        {
          label: 'description: "..."',
          kind: CompletionItemKind.Property,
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'description: "${1:Variable description}"'
        },
        {
          label: 'default: "..."',
          kind: CompletionItemKind.Property,
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'default: "${1:value}"'
        }
      );
      return items;
    }
  }

  // 4. Root level keywords suggestions (when indent === 0)
  items.push(
    {
      label: 'version: "1.0"',
      kind: CompletionItemKind.Keyword,
      detail: 'Manifest Version',
      insertText: 'version: "1.0"'
    },
    {
      label: 'provider: local',
      kind: CompletionItemKind.Keyword,
      detail: 'Local Offline Provider',
      insertText: 'provider: local'
    },
    {
      label: 'provider: github',
      kind: CompletionItemKind.Keyword,
      detail: 'GitHub Projects Provider',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'provider:\n  github:\n    owner: "${1:owner}"\n    repo: "${2:repo}"\n    project_number: ${3:1}'
    },
    {
      label: 'backend: local',
      kind: CompletionItemKind.Keyword,
      detail: 'Local State Ledger Backend',
      insertText: 'backend: local'
    },
    {
      label: 'backend: s3',
      kind: CompletionItemKind.Keyword,
      detail: 'Amazon S3 Remote State Backend',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'backend:\n  s3:\n    bucket: "${1:my-bucket}"\n    key: "${2:testform.state}"\n    region: "${3:us-east-1}"'
    },
    {
      label: 'variable:',
      kind: CompletionItemKind.Keyword,
      detail: 'Input Variable Declaration Block',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'variable:\n  ${1:app_url}:\n    type: string\n    description: "${2:Base Application URL}"\n    default: "${3:https://example.com}"'
    },
    {
      label: 'local:',
      kind: CompletionItemKind.Keyword,
      detail: 'Local Computed Expressions Block',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'local:\n  ${1:base_url}: "${2:\\${var.app_url}}"'
    },
    {
      label: 'resource:',
      kind: CompletionItemKind.Keyword,
      detail: 'Resource Scopes & Scaffolding Configuration',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'resource:\n  testcase:\n    match: "*.case.feature"\n    scaffold:\n      directory: "testcase"\n      filename: "{slug}.case.feature"\n    fields: []\n  testrun:\n    match: "*.run.feature"\n    scaffold:\n      directory: "testrun"\n      filename: "{slug}.run.feature"\n    fields: []\n  testplan:\n    match: "*.plan.feature"\n    scaffold:\n      directory: "testplan"\n      filename: "{slug}.plan.feature"\n    fields: []'
    },
    {
      label: 'scopes:',
      kind: CompletionItemKind.Keyword,
      detail: 'Scope Matching Configuration (Alias of resource)',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'scopes:\n  testcase:\n    match: "*.case.feature"\n  testrun:\n    match: "*.run.feature"\n  testplan:\n    match: "*.plan.feature"'
    },
    {
      label: 'data:',
      kind: CompletionItemKind.Keyword,
      detail: 'Data Sources (Fixtures & State Aliases)',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'data:\n  ${1:usuarios}:\n    file: "${2:fixtures/users.json}"'
    },
    {
      label: 'modules:',
      kind: CompletionItemKind.Keyword,
      detail: 'Feature Modules Declaration',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'modules:\n  ${1:auth_module}:\n    source: "${2:auth/login.case.feature}"\n    vars:\n      ${3:role}: "${4:standard_user}"\n    outputs:\n      ${5:login_title}:\n        value: "${6:\\${testcase.auth/login.case.feature.@tc-1.title}}"'
    },
    {
      label: 'outputs:',
      kind: CompletionItemKind.Keyword,
      detail: 'Global Root Outputs',
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'outputs:\n  ${1:active_environment}:\n    description: "${2:Active environment}"\n    value: "${3:\\${var.environment}}"'
    }
  );

  return items;
}

