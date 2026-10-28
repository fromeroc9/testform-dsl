import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';
import { runTestformCommand } from './terminal';
import { StateTreeProvider } from './views/state-view';
import { ModulesTreeProvider } from './views/modules-view';
import { ReportsTreeProvider } from './views/reports-view';
import { TestformTestController } from './testing/test-controller';
import { TestformFileDecorationProvider } from './views/decorations';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
  // 1. Language Server Setup
  const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] }
    }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'testform-yaml' },
      { scheme: 'file', language: 'yaml' },
      { scheme: 'file', language: 'testform-gherkin' },
      { scheme: 'file', pattern: '**/*.feature' }
    ],
    synchronize: {
      fileEvents: [
        vscode.workspace.createFileSystemWatcher('**/*.feature'),
        vscode.workspace.createFileSystemWatcher('**/*.yml'),
        vscode.workspace.createFileSystemWatcher('**/*.yaml'),
        vscode.workspace.createFileSystemWatcher('**/.testform/**')
      ]
    }
  };

  client = new LanguageClient(
    'testformLanguageServer',
    'Testform Language Server',
    serverOptions,
    clientOptions
  );

  client.start();

  // 2. Status Bar Item & Project Detection
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(beaker) Testform';
  statusBarItem.tooltip = 'Testform Test-as-Code Engine';
  statusBarItem.command = 'testform.menu';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const updateProjectDetection = async () => {
    const files = await vscode.workspace.findFiles('{main.yml,main.yaml,testform.yml,testform.yaml,**/main.yml,**/testform.yml}', '**/node_modules/**', 1);
    const isTestform = files.length > 0;
    vscode.commands.executeCommand('setContext', 'testform:isTestformProject', isTestform);
    vscode.commands.executeCommand('setContext', 'testform.isTestformWorkspace', isTestform);

    if (isTestform) {
      statusBarItem.text = '$(beaker) Testform: Ready';
      statusBarItem.tooltip = 'Testform Project Active (Click to open Control Center)';
      statusBarItem.command = 'testform.menu';
    } else {
      statusBarItem.text = '$(beaker) Testform';
      statusBarItem.tooltip = 'Testform: No main.yml found. Click to Initialize (testform init)';
      statusBarItem.command = 'testform.init';
    }
  };

  updateProjectDetection();

  const manifestWatcher = vscode.workspace.createFileSystemWatcher('{**/main.yml,**/main.yaml,**/testform.yml,**/testform.yaml}');
  manifestWatcher.onDidCreate(() => updateProjectDetection());
  manifestWatcher.onDidDelete(() => updateProjectDetection());
  context.subscriptions.push(manifestWatcher);

  // 3. Tree Views
  const stateProvider = new StateTreeProvider();
  vscode.window.registerTreeDataProvider('testform.views.state', stateProvider);

  const modulesProvider = new ModulesTreeProvider();
  vscode.window.registerTreeDataProvider('testform.views.modules', modulesProvider);

  const reportsProvider = new ReportsTreeProvider();
  vscode.window.registerTreeDataProvider('testform.views.reports', reportsProvider);

  // 4. Test Controller & File Decorations
  const testController = new TestformTestController();
  context.subscriptions.push(testController);

  const decorationProvider = new TestformFileDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider));

  // 5. Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('testform.menu', async () => {
      interface MenuOption extends vscode.QuickPickItem {
        cmd: string;
      }

      const options: MenuOption[] = [
        {
          label: '$(check) Validate',
          description: 'testform validate',
          detail: 'Verifica la sintaxis de los manifiestos YAML, definiciones de scopes y variables sin ejecutar pruebas.',
          cmd: 'testform.validate'
        },
        {
          label: '$(git-compare) Plan',
          description: 'testform plan',
          detail: 'Genera una vista previa especulativa mostrando el diff de cambios contra el ledger sin modificar testform.state.',
          cmd: 'testform.plan'
        },
        {
          label: '$(play) Apply',
          description: 'testform apply',
          detail: 'Ejecuta las pruebas o reconcilia el estado actualizando testform.state.',
          cmd: 'testform.apply'
        },
        {
          label: '$(diff) Diff',
          description: 'testform diff',
          detail: 'Compara y detecta diferencias (drift) entre los archivos feature en disco y el estado registrado.',
          cmd: 'testform.diff'
        },
        {
          label: '$(eye) Show',
          description: 'testform show',
          detail: 'Inspecciona en formato legible los recursos y atributos guardados en el archivo de estado o plan.',
          cmd: 'testform.show'
        },
        {
          label: '$(file-text) Report',
          description: 'testform report',
          detail: 'Genera reportes interactivos de calidad (Markdown, Word .docx, Excel .xlsx, HTML, etc.).',
          cmd: 'testform.report'
        },
        {
          label: '$(list-tree) Providers',
          description: 'testform providers',
          detail: 'Muestra el árbol jerárquico de providers configurados y sus requerimientos.',
          cmd: 'testform.providers'
        },
        {
          label: '$(package) Modules',
          description: 'testform modules',
          detail: 'Lista los módulos de features declarados en el workspace y sus orígenes.',
          cmd: 'testform.modules.list'
        },
        {
          label: '$(refresh) Refresh State',
          description: 'testform.state',
          detail: 'Recarga el ledger de estado en el explorador de la barra lateral.',
          cmd: 'testform.state.refresh'
        }
      ];

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Testform Control Center - Selecciona un comando'
      });

      if (selected) {
        vscode.commands.executeCommand(selected.cmd);
      }
    }),
    vscode.commands.registerCommand('testform.init', () => {
      runTestformCommand('init');
    }),
    vscode.commands.registerCommand('testform.validate', () => {
      runTestformCommand('validate');
    }),
    vscode.commands.registerCommand('testform.plan', () => {
      runTestformCommand('plan');
    }),
    vscode.commands.registerCommand('testform.apply', () => {
      runTestformCommand('apply');
    }),
    vscode.commands.registerCommand('testform.diff', () => {
      runTestformCommand('diff');
    }),
    vscode.commands.registerCommand('testform.show', () => {
      runTestformCommand('show');
    }),
    vscode.commands.registerCommand('testform.providers', () => {
      runTestformCommand('providers');
    }),
    vscode.commands.registerCommand('testform.modules.list', () => {
      runTestformCommand('modules');
    }),
    vscode.commands.registerCommand('testform.state.refresh', () => {
      stateProvider.refresh();
      vscode.window.showInformationMessage('Testform state refreshed.');
    }),
    vscode.commands.registerCommand('testform.state.showResource', (address: string) => {
      runTestformCommand(`state show ${address}`);
    }),
    vscode.commands.registerCommand('testform.modules.update', () => {
      runTestformCommand('init');
      modulesProvider.refresh();
    }),
    vscode.commands.registerCommand('testform.format', () => {
      vscode.commands.executeCommand('editor.action.formatDocument');
    }),
    vscode.commands.registerCommand('testform.report.trigger', async (reportSlug: string) => {
      const format = await vscode.window.showQuickPick(
        [
          { label: 'markdown', description: 'Markdown format (.md)' },
          { label: 'docx', description: 'Microsoft Word report (.docx)' },
          { label: 'xlsx', description: 'Microsoft Excel spreadsheet (.xlsx)' },
          { label: 'json', description: 'JSON raw report data (.json)' },
          { label: 'csv', description: 'CSV data export (.csv)' }
        ],
        { placeHolder: `Select export format for report "${reportSlug}"` }
      );

      if (format) {
        runTestformCommand(`report ${reportSlug} -format=${format.label}`);
      }
    }),
    vscode.commands.registerCommand('testform.report', async () => {
      const reportTypes = [
        { label: 'Resumen de Casos de Prueba', description: 'testcase-summary' },
        { label: 'Resumen de Test Runs', description: 'testrun-summary' },
        { label: 'Detalle de Ejecución de Corridas', description: 'testrun-detailed' },
        { label: 'Resumen de Planes de Prueba', description: 'testplan-summary' },
        { label: 'Matriz de Cobertura', description: 'coverage' },
        { label: 'Matriz de Trazabilidad', description: 'matrix' },
        { label: 'Auditoría y Calidad', description: 'audit' }
      ];

      const selected = await vscode.window.showQuickPick(reportTypes, {
        placeHolder: 'Selecciona el tipo de informe a generar'
      });

      if (selected) {
        vscode.commands.executeCommand('testform.report.trigger', selected.description);
      }
    })
  );

  // 6. Content-based Testform YAML language auto-detection
  const detectTestformYaml = (doc: vscode.TextDocument) => {
    if (doc.languageId === 'testform-yaml') return;
    const lower = doc.fileName.toLowerCase();
    if (!lower.endsWith('.yml') && !lower.endsWith('.yaml')) return;
    if (lower.endsWith('.vars.yml') || lower.endsWith('.vars.yaml')) return;

    try {
      const text = doc.getText();
      const hasTestformBlock = /^\s*(version|provider|backend|variable|locals|resource|data|module|output|policy)\s*:/m.test(text);
      if (hasTestformBlock) {
        vscode.languages.setTextDocumentLanguage(doc, 'testform-yaml');
      }
    } catch {}
  };

  vscode.workspace.textDocuments.forEach(detectTestformYaml);
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(detectTestformYaml));
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
