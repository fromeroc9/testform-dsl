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

/**
 * Scans the YAML text to discover providers declared under testform.required_providers or required_providers
 */
function getDeclaredRequiredProviders(documentText: string): string[] {
  const providers: string[] = [];
  const lines = documentText.split(/\r?\n/);
  let inTestform = false;
  let inRequiredProviders = false;
  let requiredProvidersIndent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.match(/^\s*/)?.[0].length || 0;

    if (indent === 0) {
      inTestform = /^testform\s*:/i.test(trimmed);
      if (/^required_providers\s*:/i.test(trimmed)) {
        inRequiredProviders = true;
        requiredProvidersIndent = indent;
      } else {
        inRequiredProviders = false;
      }
      continue;
    }

    if (inTestform) {
      if (/^required_providers\s*:/i.test(trimmed)) {
        inRequiredProviders = true;
        requiredProvidersIndent = indent;
        continue;
      }
    }

    if (inRequiredProviders) {
      if (indent <= requiredProvidersIndent) {
        inRequiredProviders = false;
      } else {
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:/);
        if (match) {
          const pName = match[1];
          const lower = pName.toLowerCase();
          if (!['source', 'version', 'constraints', 'backend', 'required_version', 'local', 'github', 'gitlab', 'custom'].includes(lower)) {
            if (!providers.includes(pName)) {
              providers.push(pName);
            }
          }
        }
      }
    }
  }

  return providers;
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
  const inlineColonMatch = lineText.match(/^(\s*)([a-zA-Z0-9_-]+)\s*:\s*([a-zA-Z0-9_.-]*)$/);
  if (inlineColonMatch) {
    const lineIndent = inlineColonMatch[1] || '';
    const key = inlineColonMatch[2].toLowerCase();

    // Scalar or dictionary provider completions
    if (key === 'provider') {
      const fullDocText = document.getText();
      const declared = getDeclaredRequiredProviders(fullDocText);
      const providerItems: CompletionItem[] = [
        {
          label: 'local',
          kind: CompletionItemKind.Value,
          detail: 'Offline Local Provider (linear scalar)',
          insertText: 'local'
        },
        {
          label: 'github',
          kind: CompletionItemKind.Snippet,
          detail: 'GitHub Projects Provider (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `\n${lineIndent}  github:\n${lineIndent}    owner: "\${1:owner}"\n${lineIndent}    repository: "\${2:repository}"\n${lineIndent}    project_id: "\${3:PVT_...}"\n${lineIndent}    token_env: "\${4:GITHUB_TOKEN}"`
        },
        {
          label: 'gitlab',
          kind: CompletionItemKind.Snippet,
          detail: 'GitLab Issues Provider (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `\n${lineIndent}  gitlab:\n${lineIndent}    host: "\${1:https://gitlab.com}"\n${lineIndent}    project_id: "\${2:12345678}"\n${lineIndent}    token_env: "\${3:GITLAB_TOKEN}"`
        }
      ];

      for (const p of declared) {
        if (!['github', 'gitlab', 'local', 'custom'].includes(p.toLowerCase())) {
          providerItems.push({
            label: p,
            kind: CompletionItemKind.Snippet,
            detail: `Declared Provider (${p})`,
            insertTextFormat: InsertTextFormat.Snippet,
            insertText: `\n${lineIndent}  ${p}:\n${lineIndent}    \${1:param}: "\${2:value}"`
          });
        }
      }

      return providerItems;
    }

    if (key === 'backend') {
      return [
        {
          label: 'local',
          kind: CompletionItemKind.Value,
          detail: 'Local State Ledger (linear scalar)',
          insertText: 'local'
        },
        {
          label: 's3',
          kind: CompletionItemKind.Snippet,
          detail: 'Amazon S3 Bucket (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `\n${lineIndent}  s3:\n${lineIndent}    bucket: "\${1:bucket-name}"\n${lineIndent}    key: "\${2:testform.state}"\n${lineIndent}    region: "\${3:us-east-1}"\n${lineIndent}    dynamodb_table: "\${4:table-name}"`
        },
        {
          label: 'azurerm',
          kind: CompletionItemKind.Snippet,
          detail: 'Azure Blob Storage (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `\n${lineIndent}  azurerm:\n${lineIndent}    storage_account_name: "\${1:storage_account}"\n${lineIndent}    container_name: "\${2:container}"\n${lineIndent}    key: "\${3:testform.state}"\n${lineIndent}    resource_group_name: "\${4:rg-name}"`
        },
        {
          label: 'gcs',
          kind: CompletionItemKind.Snippet,
          detail: 'Google Cloud Storage (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `\n${lineIndent}  gcs:\n${lineIndent}    bucket: "\${1:bucket-name}"\n${lineIndent}    prefix: "\${2:state}"`
        },
        {
          label: 'oci',
          kind: CompletionItemKind.Snippet,
          detail: 'Oracle Cloud Storage (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `\n${lineIndent}  oci:\n${lineIndent}    bucket: "\${1:bucket-name}"\n${lineIndent}    namespace: "\${2:namespace}"\n${lineIndent}    key: "\${3:testform.state}"`
        },
        {
          label: 'github',
          kind: CompletionItemKind.Snippet,
          detail: 'GitHub Repository State Ledger (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `\n${lineIndent}  github:\n${lineIndent}    branch: "\${1:testform-state}"\n${lineIndent}    path: "\${2:state/testform.state}"\n${lineIndent}    token_env: "\${3:GITHUB_TOKEN}"`
        },
        {
          label: 'http',
          kind: CompletionItemKind.Snippet,
          detail: 'HTTP REST Ledger (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: `\n${lineIndent}  http:\n${lineIndent}    address: "\${1:https://my-backend.example.com/state}"\n${lineIndent}    lock_address: "\${2:https://my-backend.example.com/lock}"\n${lineIndent}    unlock_address: "\${3:https://my-backend.example.com/lock}"`
        }
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

    // CRITICAL FIX: If key is a dictionary parent (variable, locals, resource, data, module, output, testform, provider)
    // DO NOT emit properties inline on the same line! They require a line break + indent.
    const DICTIONARY_PARENTS = new Set([
      'testform',
      'provider',
      'required_providers',
      'backend',
      'variable', 'variables', 'vars',
      'locals', 'local',
      'resource', 'scopes',
      'data',
      'module', 'modules',
      'output', 'outputs',
      'policy', 'fields', 'set'
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
        label: 'testform:',
        kind: CompletionItemKind.Property,
        detail: 'Testform root engine configuration (required_version, backend, required_providers)',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'testform:\n  required_version: ">= 1.0.0"\n  backend: ${1|local,s3,azurerm,gcs,oci,github,http|}\n  required_providers:\n    ${2}'
      },
      {
        label: 'version: "1.0"',
        kind: CompletionItemKind.Property,
        detail: 'Testform manifest version',
        insertText: 'version: "1.0"'
      },
      {
        label: 'provider:',
        kind: CompletionItemKind.Property,
        detail: 'Provider configuration (local, github, gitlab)',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'provider:\n  ${1|local,github,gitlab|}:'
      },
      {
        label: 'backend:',
        kind: CompletionItemKind.Property,
        detail: 'State backend ledger configuration (local, s3, azurerm, gcs, oci, github, http)',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'backend: ${1|local,s3,azurerm,gcs,oci,github,http|}'
      },
      {
        label: 'required_providers:',
        kind: CompletionItemKind.Property,
        detail: 'Declare required providers and versions (Terraform parity)',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'required_providers:\n  '
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
        detail: 'Resource scopes and execution settings configuration',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: 'resource:\n  testcase:\n    directory: "${1:testcase}"\n    filename: "${2:{slug}_{YYYYMMDD}.case.feature}"\n    match: "${3:*.case.feature}"\n    identity: "${4:tc-*}"\n    fields: {}\n  testrun:\n    directory: "${5:testruns}"\n    filename: "${6:{slug}_{YYYYMMDD}.run.feature}"\n    match: "${7:*.run.feature}"\n    identity: "${8:tr-*}"\n    set:\n      status:\n        success: ["passed", "exitoso"]\n        failure: ["failed", "fallido"]\n      attach: "attachments/runs"\n    fields: {}\n  testplan:\n    directory: "${9:testplans}"\n    filename: "${10:{slug}_{YYYYMMDD}.plan.feature}"\n    match: "${11:*.plan.feature}"\n    identity: "${12:tp-*}"\n    set:\n      attach: "attachments/plans"\n    fields: {}'
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

  // Case Backend: Inside "backend" block (root backend: or testform.backend:)
  if (ancestry.includes('backend') || rootSection === 'backend') {
    const lastKey = ancestry[ancestry.length - 1].toLowerCase();
    if (lastKey === 'backend') {
      return [
        {
          label: 'local',
          kind: CompletionItemKind.Snippet,
          detail: 'Offline Local State Ledger (zero configuration)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'local: {}'
        },
        {
          label: 's3',
          kind: CompletionItemKind.Snippet,
          detail: 'Amazon S3 Bucket (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 's3:\n  bucket: "${1:bucket-name}"\n  key: "${2:testform.state}"\n  region: "${3:us-east-1}"\n  dynamodb_table: "${4:table-name}"'
        },
        {
          label: 'azurerm',
          kind: CompletionItemKind.Snippet,
          detail: 'Azure Blob Storage (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'azurerm:\n  storage_account_name: "${1:storage_account}"\n  container_name: "${2:container}"\n  key: "${3:testform.state}"\n  resource_group_name: "${4:rg-name}"'
        },
        {
          label: 'gcs',
          kind: CompletionItemKind.Snippet,
          detail: 'Google Cloud Storage (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'gcs:\n  bucket: "${1:bucket-name}"\n  prefix: "${2:state}"'
        },
        {
          label: 'oci',
          kind: CompletionItemKind.Snippet,
          detail: 'Oracle Cloud Infrastructure (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'oci:\n  bucket: "${1:bucket-name}"\n  namespace: "${2:namespace}"\n  key: "${3:testform.state}"'
        },
        {
          label: 'github',
          kind: CompletionItemKind.Snippet,
          detail: 'GitHub Repository State Ledger (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'github:\n  branch: "${1:testform-state}"\n  path: "${2:state/testform.state}"\n  token_env: "${3:GITHUB_TOKEN}"'
        },
        {
          label: 'http',
          kind: CompletionItemKind.Snippet,
          detail: 'HTTP REST Ledger (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'http:\n  address: "${1:https://my-backend.example.com/state}"\n  lock_address: "${2:https://my-backend.example.com/lock}"\n  unlock_address: "${3:https://my-backend.example.com/lock}"'
        }
      ];
    } else {
      // Indented inside a specific backend type (e.g. backend.s3, backend.azurerm)
      const backendType = lastKey;
      if (backendType === 's3') {
        return [
          { label: 'bucket:', kind: CompletionItemKind.Property, detail: 'S3 bucket name', insertTextFormat: InsertTextFormat.Snippet, insertText: 'bucket: "${1:bucket-name}"' },
          { label: 'key:', kind: CompletionItemKind.Property, detail: 'Path to state file in bucket', insertTextFormat: InsertTextFormat.Snippet, insertText: 'key: "${1:testform.state}"' },
          { label: 'region:', kind: CompletionItemKind.Property, detail: 'AWS region (e.g. us-east-1)', insertTextFormat: InsertTextFormat.Snippet, insertText: 'region: "${1:us-east-1}"' },
          { label: 'dynamodb_table:', kind: CompletionItemKind.Property, detail: 'DynamoDB table for state locking', insertTextFormat: InsertTextFormat.Snippet, insertText: 'dynamodb_table: "${1:table-name}"' },
          { label: 'endpoint:', kind: CompletionItemKind.Property, detail: 'Custom S3 endpoint URL (MinIO, LocalStack)', insertTextFormat: InsertTextFormat.Snippet, insertText: 'endpoint: "${1:https://localhost:9000}"' },
          { label: 'profile:', kind: CompletionItemKind.Property, detail: 'AWS credentials profile name', insertTextFormat: InsertTextFormat.Snippet, insertText: 'profile: "${1:default}"' },
          { label: 'encrypt:', kind: CompletionItemKind.Property, detail: 'Enable server-side encryption', insertText: 'encrypt: true' },
          { label: 'forcePathStyle:', kind: CompletionItemKind.Property, detail: 'Enable path-style S3 URLs', insertText: 'forcePathStyle: true' }
        ];
      }
      if (backendType === 'azurerm') {
        return [
          { label: 'storage_account_name:', kind: CompletionItemKind.Property, detail: 'Azure Storage account name', insertTextFormat: InsertTextFormat.Snippet, insertText: 'storage_account_name: "${1:storage_account}"' },
          { label: 'container_name:', kind: CompletionItemKind.Property, detail: 'Blob container name', insertTextFormat: InsertTextFormat.Snippet, insertText: 'container_name: "${1:container}"' },
          { label: 'key:', kind: CompletionItemKind.Property, detail: 'State blob key name', insertTextFormat: InsertTextFormat.Snippet, insertText: 'key: "${1:testform.state}"' },
          { label: 'resource_group_name:', kind: CompletionItemKind.Property, detail: 'Azure resource group name', insertTextFormat: InsertTextFormat.Snippet, insertText: 'resource_group_name: "${1:rg-name}"' },
          { label: 'connection_string:', kind: CompletionItemKind.Property, detail: 'Storage account connection string', insertTextFormat: InsertTextFormat.Snippet, insertText: 'connection_string: "${1:DefaultEndpointsProtocol=https;...}"' }
        ];
      }
      if (backendType === 'gcs') {
        return [
          { label: 'bucket:', kind: CompletionItemKind.Property, detail: 'GCS bucket name', insertTextFormat: InsertTextFormat.Snippet, insertText: 'bucket: "${1:bucket-name}"' },
          { label: 'prefix:', kind: CompletionItemKind.Property, detail: 'GCS path prefix', insertTextFormat: InsertTextFormat.Snippet, insertText: 'prefix: "${1:state}"' },
          { label: 'credentials:', kind: CompletionItemKind.Property, detail: 'Path to service account JSON key', insertTextFormat: InsertTextFormat.Snippet, insertText: 'credentials: "${1:credentials.json}"' }
        ];
      }
      if (backendType === 'oci') {
        return [
          { label: 'bucket:', kind: CompletionItemKind.Property, detail: 'OCI Object Storage bucket name', insertTextFormat: InsertTextFormat.Snippet, insertText: 'bucket: "${1:bucket-name}"' },
          { label: 'namespace:', kind: CompletionItemKind.Property, detail: 'OCI Object Storage tenancy namespace', insertTextFormat: InsertTextFormat.Snippet, insertText: 'namespace: "${1:namespace}"' },
          { label: 'key:', kind: CompletionItemKind.Property, detail: 'Object key name in bucket', insertTextFormat: InsertTextFormat.Snippet, insertText: 'key: "${1:testform.state}"' },
          { label: 'compartment_id:', kind: CompletionItemKind.Property, detail: 'OCI compartment OCID', insertTextFormat: InsertTextFormat.Snippet, insertText: 'compartment_id: "${1:ocid1.compartment.oc1...}"' },
          { label: 'region:', kind: CompletionItemKind.Property, detail: 'OCI region identifier', insertTextFormat: InsertTextFormat.Snippet, insertText: 'region: "${1:us-ashburn-1}"' }
        ];
      }
      if (backendType === 'github') {
        return [
          { label: 'branch:', kind: CompletionItemKind.Property, detail: 'Git branch for state storage', insertTextFormat: InsertTextFormat.Snippet, insertText: 'branch: "${1:testform-state}"' },
          { label: 'path:', kind: CompletionItemKind.Property, detail: 'State file path in repository', insertTextFormat: InsertTextFormat.Snippet, insertText: 'path: "${1:state/testform.state}"' },
          { label: 'token_env:', kind: CompletionItemKind.Property, detail: 'Environment variable holding GitHub token', insertTextFormat: InsertTextFormat.Snippet, insertText: 'token_env: "${1:GITHUB_TOKEN}"' },
          { label: 'owner:', kind: CompletionItemKind.Property, detail: 'GitHub user or organization name', insertTextFormat: InsertTextFormat.Snippet, insertText: 'owner: "${1:owner}"' },
          { label: 'repository:', kind: CompletionItemKind.Property, detail: 'GitHub repository name', insertTextFormat: InsertTextFormat.Snippet, insertText: 'repository: "${1:repository}"' }
        ];
      }
      if (backendType === 'http') {
        return [
          { label: 'address:', kind: CompletionItemKind.Property, detail: 'HTTP REST endpoint URL for state', insertTextFormat: InsertTextFormat.Snippet, insertText: 'address: "${1:https://my-backend.example.com/state}"' },
          { label: 'lock_address:', kind: CompletionItemKind.Property, detail: 'HTTP endpoint URL for lock', insertTextFormat: InsertTextFormat.Snippet, insertText: 'lock_address: "${1:https://my-backend.example.com/lock}"' },
          { label: 'unlock_address:', kind: CompletionItemKind.Property, detail: 'HTTP endpoint URL for unlock', insertTextFormat: InsertTextFormat.Snippet, insertText: 'unlock_address: "${1:https://my-backend.example.com/lock}"' },
          { label: 'username:', kind: CompletionItemKind.Property, detail: 'HTTP Basic Auth username', insertTextFormat: InsertTextFormat.Snippet, insertText: 'username: "${1:username}"' },
          { label: 'password:', kind: CompletionItemKind.Property, detail: 'HTTP Basic Auth password', insertTextFormat: InsertTextFormat.Snippet, insertText: 'password: "${1:password}"' }
        ];
      }
      if (backendType === 'local') {
        return [
          { label: 'path:', kind: CompletionItemKind.Property, detail: 'Local state ledger file path', insertTextFormat: InsertTextFormat.Snippet, insertText: 'path: "${1:testform.state}"' }
        ];
      }
    }
  }

  // Case Required Providers (both under testform or root)
  if (ancestry.includes('required_providers') || rootSection === 'required_providers') {
    const lastKey = ancestry[ancestry.length - 1].toLowerCase();
    if (lastKey === 'required_providers') {
      return [
        {
          label: 'custom_provider (Git Repository)',
          kind: CompletionItemKind.Snippet,
          detail: 'Declare provider from Git repository (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:jira}:\n  source: "git::https://${2:github.com/my-org/testform-provider-${1}.git}"\n  version: "${3:>= 1.0.0}"'
        },
        {
          label: 'custom_provider (NPM Package)',
          kind: CompletionItemKind.Snippet,
          detail: 'Declare provider from NPM package or private registry',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:jira}:\n  source: "@${2:my-org}/testform-provider-${1}"\n  version: "${3:^1.0.0}"'
        },
        {
          label: 'custom_provider (Local File)',
          kind: CompletionItemKind.Snippet,
          detail: 'Declare provider from local TypeScript/JS file',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:my_provider}:\n  source: "${2:./custom-providers/my-provider.ts}"'
        },
        {
          label: 'github',
          kind: CompletionItemKind.Snippet,
          detail: 'Official GitHub Provider requirement',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'github:\n  source: "github"\n  version: ">= 1.0.0"'
        },
        {
          label: 'gitlab',
          kind: CompletionItemKind.Snippet,
          detail: 'Official GitLab Provider requirement',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'gitlab:\n  source: "gitlab"\n  version: ">= 1.0.0"'
        },
        {
          label: 'local',
          kind: CompletionItemKind.Snippet,
          detail: 'Official Local Provider requirement',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'local:\n  source: "local"\n  version: ">= 1.0.0"'
        }
      ];
    } else {
      // Indent 6+: Inside a declared provider definition under required_providers
      return [
        { label: 'source:', kind: CompletionItemKind.Property, detail: 'Git URL, NPM package, or local path', insertTextFormat: InsertTextFormat.Snippet, insertText: 'source: "${1:source}"' },
        { label: 'version:', kind: CompletionItemKind.Property, detail: 'Version constraint (e.g. ">= 1.0.0", "~> 1.2.0")', insertTextFormat: InsertTextFormat.Snippet, insertText: 'version: "${1:>= 1.0.0}"' },
        { label: 'constraints:', kind: CompletionItemKind.Property, detail: 'Optional additional version constraint', insertTextFormat: InsertTextFormat.Snippet, insertText: 'constraints: "${1:>= 1.0.0}"' }
      ];
    }
  }

  // Case T: Inside "testform" root block
  if (rootSection === 'testform') {
    // Indent 2: Properties of testform block
    if (ancestry.length === 1) {
      return [
        {
          label: 'required_version:',
          kind: CompletionItemKind.Property,
          detail: 'Minimum required Testform CLI version',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'required_version: "${1:>= 1.0.0}"'
        },
        {
          label: 'backend:',
          kind: CompletionItemKind.Property,
          detail: 'State backend ledger configuration (local, s3, azurerm, gcs, oci, github, http)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'backend: ${1|local,s3,azurerm,gcs,oci,github,http|}'
        },
        {
          label: 'required_providers:',
          kind: CompletionItemKind.Property,
          detail: 'Declare required providers and versions (Terraform parity)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'required_providers:\n  '
        }
      ];
    }
  }

  // Case P: Inside "provider" block
  if (rootSection === 'provider') {
    const fullDocText = document.getText();
    const declared = getDeclaredRequiredProviders(fullDocText);

    // Indent 2: Declaring provider name under provider:
    if (ancestry.length === 1) {
      const items: CompletionItem[] = [
        {
          label: 'local',
          kind: CompletionItemKind.Snippet,
          detail: 'Offline Local Provider (zero configuration)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'local: {}'
        },
        {
          label: 'github',
          kind: CompletionItemKind.Snippet,
          detail: 'GitHub Projects Provider (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'github:\n  owner: "${1:owner}"\n  repository: "${2:repository}"\n  project_id: "${3:PVT_...}"\n  token_env: "${4:GITHUB_TOKEN}"'
        },
        {
          label: 'gitlab',
          kind: CompletionItemKind.Snippet,
          detail: 'GitLab Issues Provider (with parameters)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'gitlab:\n  host: "${1:https://gitlab.com}"\n  project_id: "${2:12345678}"\n  token_env: "${3:GITLAB_TOKEN}"'
        }
      ];

      for (const p of declared) {
        if (!['github', 'gitlab', 'local', 'custom'].includes(p.toLowerCase())) {
          items.push({
            label: p,
            kind: CompletionItemKind.Snippet,
            detail: `Declared Provider (${p})`,
            insertTextFormat: InsertTextFormat.Snippet,
            insertText: `${p}:\n  \${1:param}: "\${2:value}"`
          });
        }
      }

      return items;
    }

    // Indent 4+: Inside a specific provider definition, e.g. provider.github
    if (ancestry.length >= 2) {
      const targetProvider = ancestry[1]?.toLowerCase();
      if (targetProvider === 'github') {
        return [
          { label: 'owner:', kind: CompletionItemKind.Property, detail: 'GitHub user or organization name', insertTextFormat: InsertTextFormat.Snippet, insertText: 'owner: "${1:owner}"' },
          { label: 'repository:', kind: CompletionItemKind.Property, detail: 'Target repository name', insertTextFormat: InsertTextFormat.Snippet, insertText: 'repository: "${1:repository}"' },
          { label: 'project_id:', kind: CompletionItemKind.Property, detail: 'GitHub Projects V2 node ID (PVT_...)', insertTextFormat: InsertTextFormat.Snippet, insertText: 'project_id: "${1:PVT_...}"' },
          { label: 'token_env:', kind: CompletionItemKind.Property, detail: 'Environment variable name holding token (default: GITHUB_TOKEN)', insertTextFormat: InsertTextFormat.Snippet, insertText: 'token_env: "${1:GITHUB_TOKEN}"' }
        ];
      }
      if (targetProvider === 'gitlab') {
        return [
          { label: 'host:', kind: CompletionItemKind.Property, detail: 'GitLab instance URL (default: https://gitlab.com)', insertTextFormat: InsertTextFormat.Snippet, insertText: 'host: "${1:https://gitlab.com}"' },
          { label: 'project_id:', kind: CompletionItemKind.Property, detail: 'GitLab project numeric ID or URL-encoded path', insertTextFormat: InsertTextFormat.Snippet, insertText: 'project_id: "${1:12345678}"' },
          { label: 'token_env:', kind: CompletionItemKind.Property, detail: 'Environment variable name holding token (default: GITLAB_TOKEN)', insertTextFormat: InsertTextFormat.Snippet, insertText: 'token_env: "${1:GITLAB_TOKEN}"' }
        ];
      }
      // If it's a declared provider from required_providers
      return [
        { label: 'token_env:', kind: CompletionItemKind.Property, detail: 'Environment variable holding API token', insertTextFormat: InsertTextFormat.Snippet, insertText: 'token_env: "${1:TOKEN}"' },
        { label: 'url:', kind: CompletionItemKind.Property, detail: 'Service or endpoint URL', insertTextFormat: InsertTextFormat.Snippet, insertText: 'url: "${1:https://api.example.com}"' },
        { label: 'source:', kind: CompletionItemKind.Property, detail: 'Provider source package or script path', insertTextFormat: InsertTextFormat.Snippet, insertText: 'source: "${1:./provider.ts}"' }
      ];
    }
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
          detail: 'TestCase pure BDD specification settings',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'testcase:\n  directory: "${1:testcase}"\n  filename: "${2:{slug}_{YYYYMMDD}.case.feature}"\n  fields: {}'
        },
        {
          label: 'testrun:',
          kind: CompletionItemKind.Property,
          detail: 'TestRun execution suite settings and runtime marks',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'testrun:\n  directory: "${1:testruns}"\n  filename: "${2:{slug}_{YYYYMMDD}.run.feature}"\n  set:\n    status:\n      success: ["passed", "exitoso"]\n      failure: ["failed", "fallido"]\n    attach: "attachments/runs"\n  fields: {}'
        },
        {
          label: 'testplan:',
          kind: CompletionItemKind.Property,
          detail: 'TestPlan master plan settings and execution coordination',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'testplan:\n  directory: "${1:testplans}"\n  filename: "${2:{slug}_{YYYYMMDD}.plan.feature}"\n  set:\n    attach: "attachments/plans"\n  fields: {}'
        },
        {
          label: 'bug:',
          kind: CompletionItemKind.Property,
          detail: 'Bug defect specification settings and lifecycle marks',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'bug:\n  directory: "${1:bugs}"\n  filename: "${2:{slug}_{YYYYMMDD}.bug.feature}"\n  set:\n    status:\n      open: ["open", "nuevo"]\n      closed: ["resolved", "closed", "resuelto"]\n    attach: "attachments/bugs"\n  fields: {}'
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

      const items: CompletionItem[] = [
        { label: 'directory:', kind: CompletionItemKind.Property, detail: 'Target directory on disk for this resource', insertTextFormat: InsertTextFormat.Snippet, insertText: `directory: "\${1:${defaultDir}}"` },
        { label: 'filename:', kind: CompletionItemKind.Property, detail: 'Filename template for new specifications (testform spec new)', insertTextFormat: InsertTextFormat.Snippet, insertText: `filename: "\${1:${defaultFile}}"` },
        { label: 'identity:', kind: CompletionItemKind.Property, detail: 'Custom scenario identity tag pattern (e.g. "tc-*", "tr-*", "bg-*")', insertTextFormat: InsertTextFormat.Snippet, insertText: `identity: "\${1:${defaultIdentity}}"` },
        { label: 'match:', kind: CompletionItemKind.Property, detail: 'Glob pattern for feature files', insertTextFormat: InsertTextFormat.Snippet, insertText: `match: "\${1:${defaultMatch}}"` },
        { label: 'fields:', kind: CompletionItemKind.Property, detail: 'Custom metadata fields definition', insertText: 'fields:\n  ' }
      ];

      // attach and set DO NOT exist for testcases (testcases are pure BDD specifications)
      if (scopeName === 'testrun') {
        items.push({
          label: 'set:',
          kind: CompletionItemKind.Property,
          detail: 'Execution runtime marks configuration (* set status, attach, trace)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'set:\n  status:\n    success: ["passed", "exitoso"]\n    failure: ["failed", "fallido"]\n  attach: "attachments/runs"'
        });
      } else if (scopeName === 'bug') {
        items.push({
          label: 'set:',
          kind: CompletionItemKind.Property,
          detail: 'Defect lifecycle marks configuration (* set status, attach, trace)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'set:\n  status:\n    open: ["open", "nuevo"]\n    closed: ["resolved", "closed", "resuelto"]\n  attach: "attachments/bugs"'
        });
      } else if (scopeName === 'testplan') {
        items.push({
          label: 'set:',
          kind: CompletionItemKind.Property,
          detail: 'Testplan execution marks configuration (* set attach)',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'set:\n  attach: "attachments/plans"'
        });
      }

      return items;
    }

    // Inside set: (ancestry: ['resource', 'testrun', 'set'] or ['resource', 'bug', 'set'])
    if (ancestry.includes('set')) {
      const scopeName = ancestry[1]?.toLowerCase();
      const lastKey = ancestry[ancestry.length - 1].toLowerCase();

      if (lastKey === 'set') {
        const setProps: CompletionItem[] = [];
        if (scopeName === 'testrun') {
          setProps.push(
            {
              label: 'status:',
              kind: CompletionItemKind.Property,
              detail: 'Semantic status categorization (success, failure, pending, skipped)',
              insertTextFormat: InsertTextFormat.Snippet,
              insertText: 'status:\n  success:\n    - "${1:passed}"\n    - "${2:exitoso}"\n  failure:\n    - "${3:failed}"\n    - "${4:fallido}"'
            },
            {
              label: 'attach:',
              kind: CompletionItemKind.Property,
              detail: 'Directory for testrun execution logs & attachments (* set attach = ...)',
              insertTextFormat: InsertTextFormat.Snippet,
              insertText: 'attach: "${1:attachments/runs}"'
            },
            {
              label: 'trace:',
              kind: CompletionItemKind.Property,
              detail: 'Error trace settings',
              insertTextFormat: InsertTextFormat.Snippet,
              insertText: 'trace:\n  required: ${1|false,true|}'
            },
            {
              label: 'duration:',
              kind: CompletionItemKind.Property,
              detail: 'Duration settings',
              insertTextFormat: InsertTextFormat.Snippet,
              insertText: 'duration:\n  format: "${1:human}"'
            }
          );
        } else if (scopeName === 'bug') {
          setProps.push(
            {
              label: 'status:',
              kind: CompletionItemKind.Property,
              detail: 'Defect lifecycle categorization (open, in_progress, resolved, closed)',
              insertTextFormat: InsertTextFormat.Snippet,
              insertText: 'status:\n  open:\n    - "${1:open}"\n    - "${2:nuevo}"\n  closed:\n    - "${3:resolved}"\n    - "${4:closed}"'
            },
            {
              label: 'attach:',
              kind: CompletionItemKind.Property,
              detail: 'Directory for defect screenshots & attachments (* set attach = ...)',
              insertTextFormat: InsertTextFormat.Snippet,
              insertText: 'attach: "${1:attachments/bugs}"'
            },
            {
              label: 'trace:',
              kind: CompletionItemKind.Property,
              detail: 'Stack trace settings',
              insertTextFormat: InsertTextFormat.Snippet,
              insertText: 'trace:\n  required: ${1|false,true|}'
            }
          );
        } else if (scopeName === 'testplan' || scopeName === 'global') {
          setProps.push({
            label: 'attach:',
            kind: CompletionItemKind.Property,
            detail: 'Directory for attachments (* set attach = ...)',
            insertTextFormat: InsertTextFormat.Snippet,
            insertText: 'attach: "${1:attachments}"'
          });
        }
        return setProps;
      }

      if (lastKey === 'status') {
        if (scopeName === 'testrun') {
          return [
            { label: 'success:', kind: CompletionItemKind.Property, detail: 'Statuses that count as passed (approving the suite)', insertTextFormat: InsertTextFormat.Snippet, insertText: 'success:\n  - "${1:passed}"\n  - "${2:exitoso}"' },
            { label: 'failure:', kind: CompletionItemKind.Property, detail: 'Statuses that count as failed', insertTextFormat: InsertTextFormat.Snippet, insertText: 'failure:\n  - "${1:failed}"\n  - "${2:fallido}"' },
            { label: 'pending:', kind: CompletionItemKind.Property, detail: 'Statuses that keep suite in progress', insertTextFormat: InsertTextFormat.Snippet, insertText: 'pending:\n  - "${1:pending}"\n  - "${2:en_espera}"' },
            { label: 'skipped:', kind: CompletionItemKind.Property, detail: 'Statuses for skipped or omitted cases', insertTextFormat: InsertTextFormat.Snippet, insertText: 'skipped:\n  - "${1:skipped}"\n  - "${2:omitido}"' }
          ];
        } else if (scopeName === 'bug') {
          return [
            { label: 'open:', kind: CompletionItemKind.Property, detail: 'Statuses mapped to open issue state (e.g. open, nuevo)', insertTextFormat: InsertTextFormat.Snippet, insertText: 'open:\n  - "${1:open}"\n  - "${2:nuevo}"' },
            { label: 'in_progress:', kind: CompletionItemKind.Property, detail: 'Statuses mapped to in-progress open issue state', insertTextFormat: InsertTextFormat.Snippet, insertText: 'in_progress:\n  - "${1:in_progress}"\n  - "${2:en_atencion}"' },
            { label: 'resolved:', kind: CompletionItemKind.Property, detail: 'Statuses mapped to closed issue state (ready for QA)', insertTextFormat: InsertTextFormat.Snippet, insertText: 'resolved:\n  - "${1:resolved}"\n  - "${2:resuelto}"' },
            { label: 'closed:', kind: CompletionItemKind.Property, detail: 'Statuses mapped to closed issue state (permanently closed)', insertTextFormat: InsertTextFormat.Snippet, insertText: 'closed:\n  - "${1:closed}"\n  - "${2:cerrado}"' }
          ];
        }
      }
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
