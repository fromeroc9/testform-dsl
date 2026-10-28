import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';
import { runTestformCommand } from './terminal';
import { SpecsTreeProvider } from './views/specs-view';
import { StateTreeProvider } from './views/state-view';
import { ModulesTreeProvider } from './views/modules-view';
import { ReportsTreeProvider } from './views/reports-view';
import { TestformTestController } from './testing/test-controller';
import { TestformWorkspaceManager } from './workspace-manager';

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
      { scheme: 'file', language: 'yaml' },
      { scheme: 'file', language: 'gherkin' },
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
  const specsProvider = new SpecsTreeProvider();
  vscode.window.registerTreeDataProvider('testform.views.specs', specsProvider);
  context.subscriptions.push(specsProvider);

  const stateProvider = new StateTreeProvider();
  vscode.window.registerTreeDataProvider('testform.views.state', stateProvider);

  const modulesProvider = new ModulesTreeProvider();
  vscode.window.registerTreeDataProvider('testform.views.modules', modulesProvider);
  context.subscriptions.push(modulesProvider);

  const reportsProvider = new ReportsTreeProvider();
  vscode.window.registerTreeDataProvider('testform.views.reports', reportsProvider);

  // 4. Test Controller & Workspace Manager
  const testController = new TestformTestController();
  context.subscriptions.push(testController);

  const workspaceManager = new TestformWorkspaceManager((_ws) => {
    stateProvider.refresh();
  });
  context.subscriptions.push(workspaceManager);

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
          label: '$(diff) Diff / Test Drift',
          description: 'testform diff',
          detail: 'Compara y detecta diferencias (drift) entre los archivos feature en disco y el estado registrado.',
          cmd: 'testform.diff'
        },
        {
          label: '$(layers) Workspaces',
          description: 'testform workspace',
          detail: 'Alternar entre ambientes y workspaces aislados (default, staging, prod).',
          cmd: 'testform.workspace.select'
        },
        {
          label: '$(unlock) Force Unlock',
          description: 'testform force-unlock',
          detail: 'Libera un bloqueo atascado en el archivo de estado de Testform.',
          cmd: 'testform.state.forceUnlock'
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
          detail: 'Genera reportes interactivos de calidad (Markdown, Word .docx, Excel .xlsx, etc.).',
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
    vscode.commands.registerCommand('testform.validate', (uri?: vscode.Uri) => {
      const activeEditor = vscode.window.activeTextEditor;
      const targetUri = uri || activeEditor?.document.uri;
      if (targetUri && targetUri.fsPath.endsWith('.feature')) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
        const rootPath = workspaceFolder ? workspaceFolder.uri.fsPath : '';
        const relPath = rootPath ? path.relative(rootPath, targetUri.fsPath).replace(/\\/g, '/') : path.basename(targetUri.fsPath);
        runTestformCommand(`validate "${relPath}"`);
      } else {
        runTestformCommand('validate');
      }
    }),
    vscode.commands.registerCommand('testform.plan', () => {
      runTestformCommand('plan');
    }),
    vscode.commands.registerCommand('testform.apply', () => {
      runTestformCommand('apply');
    }),
    vscode.commands.registerCommand('testform.diff', (uri?: vscode.Uri) => {
      const activeEditor = vscode.window.activeTextEditor;
      const targetUri = uri || activeEditor?.document.uri;
      if (targetUri && targetUri.fsPath.endsWith('.feature')) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
        const rootPath = workspaceFolder ? workspaceFolder.uri.fsPath : '';
        const relPath = rootPath ? path.relative(rootPath, targetUri.fsPath).replace(/\\/g, '/') : path.basename(targetUri.fsPath);
        runTestformCommand(`diff -target="${relPath}"`);
      } else {
        runTestformCommand('diff');
      }
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
    vscode.commands.registerCommand('testform.state.showResource', (item?: any) => {
      const address = typeof item === 'string'
        ? item
        : (item?.address || (typeof item?.label === 'string' ? item.label : item?.label?.label));
      if (address) {
        runTestformCommand(`state show "${address}"`);
      }
    }),
    vscode.commands.registerCommand('testform.state.inspectResource', async (itemOrAddress: any, rawResource?: any) => {
      let address: string | undefined;
      let resource = rawResource;

      if (itemOrAddress && typeof itemOrAddress === 'object') {
        const item = itemOrAddress as any;
        address = item.address || (typeof item.label === 'string' ? item.label : item.label?.label);
        resource = item.rawResource || rawResource;
      } else if (typeof itemOrAddress === 'string') {
        address = itemOrAddress;
      }

      // If rawResource is not directly attached to tree item, lookup in testform.state
      if (!resource && address) {
        try {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (workspaceFolders && workspaceFolders.length > 0) {
            const stateFile = path.join(workspaceFolders[0].uri.fsPath, 'testform.state');
            if (fs.existsSync(stateFile)) {
              const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
              const normAddr = address.replace(/\\/g, '/').toLowerCase();
              const found = stateData.resources?.find((r: any) => {
                const rIdent = (r.identity || '').replace(/\\/g, '/').toLowerCase();
                return rIdent === normAddr || rIdent.endsWith(normAddr) || normAddr.endsWith(rIdent);
              });
              if (found) {
                resource = found;
              }
            }
          }
        } catch {}
      }

      if (resource) {
        const content = JSON.stringify(resource, null, 2);
        const doc = await vscode.workspace.openTextDocument({
          content,
          language: 'json'
        });
        await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
        return;
      }

      if (address) {
        runTestformCommand(`state show "${address}"`);
      }
    }),
    vscode.commands.registerCommand('testform.state.taint', async (item?: any) => {
      const address = typeof item === 'string'
        ? item
        : (item?.address || (typeof item?.label === 'string' ? item.label : item?.label?.label));
      if (!address) {
        vscode.window.showErrorMessage('No resource selected to taint.');
        return;
      }
      runTestformCommand(`taint "${address}"`);
      setTimeout(() => stateProvider.refresh(), 1000);
      vscode.window.showInformationMessage(`Resource '${address}' marked as tainted.`);
    }),
    vscode.commands.registerCommand('testform.state.untaint', async (item?: any) => {
      const address = typeof item === 'string'
        ? item
        : (item?.address || (typeof item?.label === 'string' ? item.label : item?.label?.label));
      if (!address) {
        vscode.window.showErrorMessage('No resource selected to untaint.');
        return;
      }
      runTestformCommand(`untaint "${address}"`);
      setTimeout(() => stateProvider.refresh(), 1000);
      vscode.window.showInformationMessage(`Taint mark removed from '${address}'.`);
    }),
    vscode.commands.registerCommand('testform.state.rm', async (item?: any) => {
      const address = typeof item === 'string'
        ? item
        : (item?.address || (typeof item?.label === 'string' ? item.label : item?.label?.label));
      if (!address) {
        vscode.window.showErrorMessage('No resource selected to remove from state.');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to remove '${address}' from the state ledger? (This will NOT delete the feature file)`,
        { modal: true },
        'Remove from State'
      );
      if (confirm === 'Remove from State') {
        runTestformCommand(`state rm "${address}"`);
        setTimeout(() => stateProvider.refresh(), 1000);
      }
    }),
    vscode.commands.registerCommand('testform.state.forceUnlock', async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      let defaultLockId = '';
      if (workspaceFolder) {
        const lockFiles = [
          path.join(workspaceFolder.uri.fsPath, '.testform', 'testform.state.lock'),
          path.join(workspaceFolder.uri.fsPath, 'testform.state.lock'),
          path.join(workspaceFolder.uri.fsPath, '.testform', 'lock.json')
        ];
        for (const lf of lockFiles) {
          if (fs.existsSync(lf)) {
            try {
              const content = fs.readFileSync(lf, 'utf8');
              const parsed = JSON.parse(content);
              defaultLockId = parsed.ID || parsed.lockId || parsed.id || '';
              if (defaultLockId) break;
            } catch {}
          }
        }
      }

      const lockId = await vscode.window.showInputBox({
        prompt: 'Enter the lock ID to force release',
        value: defaultLockId,
        placeHolder: 'e.g. 550e8400-e29b-41d4-a716-446655440000'
      });

      if (lockId) {
        runTestformCommand(`force-unlock ${lockId} -force`);
        setTimeout(() => stateProvider.refresh(), 1000);
      }
    }),
    vscode.commands.registerCommand('testform.workspace.select', async () => {
      await workspaceManager.selectWorkspacePrompt();
    }),
    vscode.commands.registerCommand('testform.modules.update', () => {
      runTestformCommand('init');
      modulesProvider.refresh();
    }),
    vscode.commands.registerCommand('testform.specs.refresh', () => {
      specsProvider.refresh();
      vscode.window.showInformationMessage('Test Specs view refreshed.');
    }),
    vscode.commands.registerCommand('testform.modules.refresh', () => {
      modulesProvider.refresh();
      vscode.window.showInformationMessage('Modules & .testform view refreshed.');
    }),
    vscode.commands.registerCommand('testform.applyCurrent', (uri?: vscode.Uri) => {
      const activeEditor = vscode.window.activeTextEditor;
      const targetUri = uri || activeEditor?.document.uri;
      if (targetUri && targetUri.fsPath.endsWith('.feature')) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
        const rootPath = workspaceFolder ? workspaceFolder.uri.fsPath : '';
        const relPath = rootPath ? path.relative(rootPath, targetUri.fsPath).replace(/\\/g, '/') : path.basename(targetUri.fsPath);
        runTestformCommand(`apply -auto-approve -target="${relPath}"`);
      } else {
        runTestformCommand('apply -auto-approve');
      }
    }),
    vscode.commands.registerCommand('testform.planCurrent', (uri?: vscode.Uri) => {
      const activeEditor = vscode.window.activeTextEditor;
      const targetUri = uri || activeEditor?.document.uri;
      if (targetUri && targetUri.fsPath.endsWith('.feature')) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
        const rootPath = workspaceFolder ? workspaceFolder.uri.fsPath : '';
        const relPath = rootPath ? path.relative(rootPath, targetUri.fsPath).replace(/\\/g, '/') : path.basename(targetUri.fsPath);
        runTestformCommand(`plan -target="${relPath}"`);
      } else {
        runTestformCommand('plan');
      }
    }),
    vscode.commands.registerCommand('testform.applyTarget', (target: string) => {
      if (target) {
        runTestformCommand(`apply -auto-approve -target="${target}"`);
      }
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
        { label: 'Test Case Summary', description: 'testcase-summary' },
        { label: 'Test Run Summary', description: 'testrun-summary' },
        { label: 'Detailed Test Runs', description: 'testrun-detailed' },
        { label: 'Test Plan Summary', description: 'testplan-summary' },
        { label: 'Coverage Matrix', description: 'coverage' },
        { label: 'Traceability Matrix', description: 'matrix' },
        { label: 'Quality & Governance Audit', description: 'audit' }
      ];

      const selected = await vscode.window.showQuickPick(reportTypes, {
        placeHolder: 'Select report type to generate'
      });

      if (selected) {
        vscode.commands.executeCommand('testform.report.trigger', selected.description);
      }
    })
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
