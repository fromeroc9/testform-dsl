import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
  DocumentFormattingParams,
  TextEdit,
  Hover,
  Definition,
  Location,
  ReferenceParams,
  CodeActionParams,
  CodeLensParams
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fileURLToPath } from 'url';
import { WorkspaceScanner } from './workspace-scanner';
import { provideCompletions } from './completions';
import { provideYamlCompletions } from './yaml-completions';
import { provideHover } from './hover';
import { provideDefinition } from './definition';
import { provideReferences } from './references';
import { validateTextDocument } from './diagnostics';
import { formatGherkinDocument } from './formatter';
import { provideCodeActions } from './codeactions';
import { provideCodeLenses, CodeLensSettings } from './codelens';

// Create a connection for the server, using Node's IPC as a transport.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let workspaceScanner: WorkspaceScanner | null = null;
let codeLensSettings: CodeLensSettings = {
  enable: true,
  testcase: true,
  testrun: true,
  testplan: true,
  bug: true
};

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );

  let rootPath = process.cwd();
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    try {
      rootPath = fileURLToPath(params.workspaceFolders[0].uri);
    } catch {
      rootPath = params.workspaceFolders[0].name;
    }
  } else if (params.rootUri) {
    try {
      rootPath = fileURLToPath(params.rootUri);
    } catch {}
  }

  workspaceScanner = new WorkspaceScanner(rootPath);
  workspaceScanner.scanAll();

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['.', '{', '@', '=', '$', '<', ' ']
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentFormattingProvider: true
    }
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true
      }
    };
  }

  return result;
});

async function updateConfiguration(): Promise<void> {
  if (hasConfigurationCapability) {
    try {
      const config = await connection.workspace.getConfiguration({ section: 'testform' });
      if (config && workspaceScanner) {
        if (config.testrun && config.testrun.targetFormat) {
          workspaceScanner.config.targetFormat = config.testrun.targetFormat;
        }
      }
    } catch {
      // ignore
    }
  }
}

connection.onInitialized(async () => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
    await updateConfiguration();
  }

  // Initial scan
  if (workspaceScanner) {
    workspaceScanner.scanAll();
  }
});

connection.onDidChangeConfiguration(async () => {
  await updateConfiguration();
});

connection.onNotification('testform/updateConfig', (params: { targetFormat?: any }) => {
  if (workspaceScanner && params?.targetFormat) {
    workspaceScanner.config.targetFormat = params.targetFormat;
  }
});

// Watch for file changes in YAML and feature files
connection.onDidChangeWatchedFiles(_change => {
  if (workspaceScanner) {
    workspaceScanner.scanAll();
    // Re-validate all open documents
    documents.all().forEach(validateDoc);
  }
});

documents.onDidChangeContent(change => {
  if (workspaceScanner) {
    const uri = change.document.uri.toLowerCase();
    if (uri.endsWith('.feature') || change.document.languageId === 'gherkin') {
      workspaceScanner.scanSingleDocument(change.document.uri, change.document.getText());
    }
  }
  validateDoc(change.document);
});

function validateDoc(document: TextDocument): void {
  if (!workspaceScanner) return;
  const uri = document.uri.toLowerCase();
  if (uri.endsWith('.feature')) {
    const diagnostics = validateTextDocument(document, workspaceScanner);
    connection.sendDiagnostics({ uri: document.uri, diagnostics });
  } else {
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  }
}

// Completions
connection.onCompletion(
  (textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    const document = documents.get(textDocumentPosition.textDocument.uri);
    if (!document || !workspaceScanner) return [];

    const uri = document.uri.toLowerCase();
    if (uri.endsWith('.yml') || uri.endsWith('.yaml')) {
      return provideYamlCompletions(document, textDocumentPosition.position, workspaceScanner);
    }

    return provideCompletions(document, textDocumentPosition.position, workspaceScanner);
  }
);

// Hover
connection.onHover(
  (textDocumentPosition: TextDocumentPositionParams): Hover | null => {
    const document = documents.get(textDocumentPosition.textDocument.uri);
    if (!document || !workspaceScanner) return null;
    return provideHover(document, textDocumentPosition.position, workspaceScanner);
  }
);

// Go to Definition
connection.onDefinition(
  (textDocumentPosition: TextDocumentPositionParams): Definition | null => {
    const document = documents.get(textDocumentPosition.textDocument.uri);
    if (!document || !workspaceScanner) return null;
    return provideDefinition(document, textDocumentPosition.position, workspaceScanner);
  }
);

// Find All References (Shift + F12)
connection.onReferences(
  (params: ReferenceParams): Location[] | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document || !workspaceScanner) return null;
    return provideReferences(params, document, workspaceScanner);
  }
);

// Formatting
connection.onDocumentFormatting(
  (params: DocumentFormattingParams): TextEdit[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const uri = document.uri.toLowerCase();
    // Only format .feature / Gherkin documents. Never format YAML files with Gherkin rules.
    if (!uri.endsWith('.feature') && document.languageId !== 'gherkin') {
      return [];
    }

    return formatGherkinDocument(document);
  }
);


// Code Actions (Quick Fixes)
connection.onCodeAction((params: CodeActionParams) => {
  const document = documents.get(params.textDocument.uri);
  if (!document || !workspaceScanner) return [];
  const uri = document.uri.toLowerCase();
  if (!uri.endsWith('.feature') && document.languageId !== 'gherkin') return [];
  return provideCodeActions(params, document, workspaceScanner);
});

// CodeLens
connection.onCodeLens((params: CodeLensParams) => {
  const document = documents.get(params.textDocument.uri);
  if (!document || !workspaceScanner) return [];
  const uri = document.uri.toLowerCase();
  if (!uri.endsWith('.feature') && document.languageId !== 'gherkin') return [];
  return provideCodeLenses(document, workspaceScanner, codeLensSettings);
});

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();
