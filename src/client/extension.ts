
function findProjectRoot(filePath: string): string {
  let curr = path.dirname(filePath);
  while (curr && curr !== path.dirname(curr)) {
    if (fs.existsSync(path.join(curr, 'main.yml')) ||
        fs.existsSync(path.join(curr, 'main.yaml')) ||
        fs.existsSync(path.join(curr, 'testform.yml')) ||
        fs.existsSync(path.join(curr, 'testform.yaml'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  const ws = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
  return ws ? ws.uri.fsPath : path.dirname(filePath);
}

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
import { SpecsHubPanel } from './views/specs-hub-panel';
import { StateTreeProvider } from './views/state-view';
import { ModulesTreeProvider } from './views/modules-view';
import { ReportsTreeProvider } from './views/reports-view';
import { TestformTestController } from './testing/test-controller';
import { TestformFileDecorationProvider } from './views/decorations';
import { TestformWorkspaceManager } from './workspace-manager';
import { detectProjectCustomFields } from './field-detector';

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
      configurationSection: 'testform',
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

  client.start().then(() => {
    // Send initial configuration to server once started
    const config = vscode.workspace.getConfiguration('testform');
    const targetFormat = config.get<string>('testrun.targetFormat', 'tag');
    client.sendNotification('testform/updateConfig', { targetFormat });
  });

  // Watch for configuration changes and notify the language server
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('testform')) {
        const config = vscode.workspace.getConfiguration('testform');
        const targetFormat = config.get<string>('testrun.targetFormat', 'tag');
        client.sendNotification('testform/updateConfig', { targetFormat });
      }
    })
  );

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
  const explorerView = vscode.window.createTreeView('testform.views.state', {
    treeDataProvider: stateProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(explorerView);

  const updateExplorerContext = () => {
    const currentMode = stateProvider.getMode();
    vscode.commands.executeCommand('setContext', 'testform.explorerMode', currentMode);
    if (currentMode === 'state') {
      const meta = stateProvider.getStateMeta();
      explorerView.description = meta ? `State (serial ${meta.serial})` : 'State';
    } else {
      explorerView.description = 'Files';
    }
  };
  updateExplorerContext();
  stateProvider.onDidChangeTreeData(() => updateExplorerContext());

  // Auto-refresh state view on state file updates (native OS file system watcher)
  const stateWatcher = vscode.workspace.createFileSystemWatcher('**/testform.state');
  stateWatcher.onDidChange(() => {
    if (stateProvider.getMode() === 'state') stateProvider.refresh();
  });
  stateWatcher.onDidCreate(() => {
    if (stateProvider.getMode() === 'state') stateProvider.refresh();
  });
  stateWatcher.onDidDelete(() => {
    if (stateProvider.getMode() === 'state') stateProvider.refresh();
  });
  context.subscriptions.push(stateWatcher);

  // Auto-refresh when .feature files change (for files mode)
  const featureWatcher = vscode.workspace.createFileSystemWatcher('**/*.feature');
  featureWatcher.onDidChange(() => {
    if (stateProvider.getMode() === 'files') stateProvider.refresh();
  });
  featureWatcher.onDidCreate(() => {
    if (stateProvider.getMode() === 'files') stateProvider.refresh();
  });
  featureWatcher.onDidDelete(() => {
    if (stateProvider.getMode() === 'files') stateProvider.refresh();
  });
  context.subscriptions.push(featureWatcher);

  const modulesProvider = new ModulesTreeProvider();
  vscode.window.registerTreeDataProvider('testform.views.modules', modulesProvider);
  context.subscriptions.push(modulesProvider);

  const reportsProvider = new ReportsTreeProvider();
  const reportsTreeView = vscode.window.createTreeView('testform.views.reports', {
    treeDataProvider: reportsProvider,
    showCollapseAll: true
  });
  reportsTreeView.onDidChangeCheckboxState(e => {
    for (const [item, state] of e.items) {
      if (item.slug && item.fieldName) {
        reportsProvider.setFieldState(item.slug, item.fieldName, state === vscode.TreeItemCheckboxState.Checked);
      }
    }
  });
  context.subscriptions.push(reportsTreeView);
  stateWatcher.onDidChange(() => reportsProvider.refresh());
  stateWatcher.onDidCreate(() => reportsProvider.refresh());
  manifestWatcher.onDidChange(() => reportsProvider.refresh());
  manifestWatcher.onDidCreate(() => reportsProvider.refresh());

  // 4. Test Controller & File Decorations & Workspace Manager
  const testController = new TestformTestController();
  context.subscriptions.push(testController);

  const decorationProvider = new TestformFileDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider));

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
          label: '$(layout-sidebar-right-off) Specs Hub (Test Cases, Runs & Plans)',
          description: 'Open full-screen specification & execution hub in editor tab',
          detail: 'Open full-screen editor tab with Test Cases, Test Runs, and Test Plans view.',
          cmd: 'testform.specs.openHub'
        },
        {
          label: '$(check) Validate',
          description: 'testform validate',
          detail: 'Validate syntax of YAML manifests, scope definitions, and variables without executing tests.',
          cmd: 'testform.validate'
        },
        {
          label: '$(git-compare) Plan',
          description: 'testform plan',
          detail: 'Generate speculative preview showing diff against state ledger without modifying testform.state.',
          cmd: 'testform.plan'
        },
        {
          label: '$(play) Apply',
          description: 'testform apply',
          detail: 'Execute tests or reconcile state ledger by updating testform.state.',
          cmd: 'testform.apply'
        },
        {
          label: '$(diff) Diff / Test Drift',
          description: 'testform diff',
          detail: 'Compare and detect drift between local feature files and registered state.',
          cmd: 'testform.diff'
        },
        {
          label: '$(layers) Workspaces',
          description: 'testform workspace',
          detail: 'Switch between isolated environments and workspaces (default, staging, prod).',
          cmd: 'testform.workspace.select'
        },
        {
          label: '$(unlock) Force Unlock',
          description: 'testform force-unlock',
          detail: 'Release stuck lock on Testform state file.',
          cmd: 'testform.state.forceUnlock'
        },
        {
          label: '$(eye) Show',
          description: 'testform show',
          detail: 'Inspect managed resources and attributes stored in state file or plan.',
          cmd: 'testform.show'
        },
        {
          label: '$(file-text) Report',
          description: 'testform report',
          detail: 'Generate quality and traceability reports (Markdown, Word .docx, Excel .xlsx, etc.).',
          cmd: 'testform.report'
        },
        {
          label: '$(list-tree) Providers',
          description: 'testform providers',
          detail: 'Display provider tree, schemas, and resource definitions.',
          cmd: 'testform.providers'
        },
        {
          label: '$(package) Modules',
          description: 'testform modules',
          detail: 'List feature modules declared in workspace and their sources.',
          cmd: 'testform.modules.list'
        },
        {
          label: '$(refresh) Refresh State',
          description: 'testform.state',
          detail: 'Reload state ledger in sidebar explorer.',
          cmd: 'testform.state.refresh'
        }
      ];

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Testform Control Center - Select a command'
      });

      if (selected) {
        vscode.commands.executeCommand(selected.cmd);
      }
    }),
    vscode.commands.registerCommand('testform.implementRequiredFields', async (args?: { uri?: string; line?: number; target?: 'background' | 'scenario' }) => {
      const editor = vscode.window.activeTextEditor;
      const targetUri = args?.uri ? vscode.Uri.parse(args.uri) : editor?.document.uri;
      if (!targetUri) return;

      const targetLine = args?.line !== undefined ? args.line : (editor?.selection.active.line || 0);
      const range = new vscode.Range(targetLine, 0, targetLine, 10);

      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        targetUri,
        range
      );

      if (actions && actions.length > 0) {
        let selected = actions[0];
        if (args?.target === 'scenario') {
          const scAction = actions.find(a => a.title.includes('this scenario'));
          if (scAction) selected = scAction;
        } else if (args?.target === 'background') {
          const bgAction = actions.find(a => a.title.includes('Background:'));
          if (bgAction) selected = bgAction;
        }

        if (selected.edit) {
          await vscode.workspace.applyEdit(selected.edit);
          vscode.window.showInformationMessage('Testform: Required contract fields implemented.');
        }
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
    vscode.commands.registerCommand('testform.state.copyAddress', async (item?: any) => {
      let address = '';
      if (typeof item === 'string') {
        address = item;
      } else if (item?.address) {
        address = item.address;
      } else if (item?.rawResource?.identity) {
        address = item.rawResource.identity;
      } else if (typeof item?.label === 'string') {
        if (item.label.startsWith('Identity: ')) {
          address = item.label.replace('Identity: ', '').trim();
        } else if (item.label.startsWith('Target: ')) {
          address = item.label.replace('Target: ', '').trim();
        } else {
          address = item.label;
        }
      } else if (typeof item?.label?.label === 'string') {
        address = item.label.label;
      }

      if (!address) {
        vscode.window.showErrorMessage('No canonical address available to copy.');
        return;
      }

      await vscode.env.clipboard.writeText(address);
      vscode.window.showInformationMessage(`Copied canonical address: ${address}`);
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
    vscode.commands.registerCommand('testform.specs.openHub', (modeArg?: string) => {
      const activeMode = (typeof modeArg === 'string' && (modeArg === 'state' || modeArg === 'files'))
        ? modeArg
        : stateProvider.getMode();
      SpecsHubPanel.createOrShow(context.extensionUri, activeMode);
    }),
    vscode.commands.registerCommand('testform.explorer.switchToFiles', () => {
      stateProvider.setMode('files');
      updateExplorerContext();
    }),
    vscode.commands.registerCommand('testform.explorer.switchToState', () => {
      stateProvider.setMode('state');
      updateExplorerContext();
    }),
    vscode.commands.registerCommand('testform.explorer.toggleMode', () => {
      stateProvider.toggleMode();
      updateExplorerContext();
    }),
    vscode.commands.registerCommand('testform.modules.refresh', () => {
      modulesProvider.refresh();
      vscode.window.showInformationMessage('Modules & .testform view refreshed.');
    }),
    vscode.commands.registerCommand('testform.applyCurrent', (uri?: vscode.Uri) => {
      const activeEditor = vscode.window.activeTextEditor;
      const targetUri = uri || activeEditor?.document.uri;
      if (targetUri && targetUri.fsPath.endsWith('.feature')) {
        const rootPath = findProjectRoot(targetUri.fsPath);
        const relPath = path.relative(rootPath, targetUri.fsPath).replace(/\\/g, '/');
        runTestformCommand(`apply -auto-approve -target="${relPath}"`);
      } else {
        runTestformCommand('apply -auto-approve');
      }
    }),
    vscode.commands.registerCommand('testform.planCurrent', (uri?: vscode.Uri) => {
      const activeEditor = vscode.window.activeTextEditor;
      const targetUri = uri || activeEditor?.document.uri;
      if (targetUri && targetUri.fsPath.endsWith('.feature')) {
        const rootPath = findProjectRoot(targetUri.fsPath);
        const relPath = path.relative(rootPath, targetUri.fsPath).replace(/\\/g, '/');
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
    vscode.commands.registerCommand('testform.report.runWithSelection', (itemOrSlug?: any) => {
      const slug = typeof itemOrSlug === 'string'
        ? itemOrSlug
        : (itemOrSlug?.slug || 'testcase-summary');
      reportsProvider.runReportDirect(slug);
    }),
    vscode.commands.registerCommand('testform.report.toggleField', (slugOrItem?: any, fieldName?: string) => {
      let slug = 'testcase-summary';
      let fName = '';
      if (typeof slugOrItem === 'string' && typeof fieldName === 'string') {
        slug = slugOrItem;
        fName = fieldName;
      } else if (slugOrItem && typeof slugOrItem === 'object') {
        slug = slugOrItem.slug || 'testcase-summary';
        fName = slugOrItem.fieldName || slugOrItem.label;
      }
      if (fName) {
        reportsProvider.toggleField(slug, fName);
      }
    }),
    vscode.commands.registerCommand('testform.report.selectFormat', async (slugOrItem?: any) => {
      const slug = typeof slugOrItem === 'string' ? slugOrItem : slugOrItem?.slug;
      const current = reportsProvider.getFormat(slug);
      const selected = await vscode.window.showQuickPick(
        [
          { label: 'md', description: 'Markdown document (.md)', picked: current === 'md' },
          { label: 'xlsx', description: 'Microsoft Excel spreadsheet (.xlsx)', picked: current === 'xlsx' },
          { label: 'docx', description: 'Microsoft Word report (.docx)', picked: current === 'docx' },
          { label: 'csv', description: 'CSV data export (.csv)', picked: current === 'csv' },
          { label: 'json', description: 'JSON raw report data (.json)', picked: current === 'json' }
        ],
        { placeHolder: `Select output format for report (current: ${current})` }
      );
      if (selected) {
        if (slug) {
          reportsProvider.setFormat(slug, selected.label);
        } else {
          reportsProvider.setFormat(selected.label);
        }
      }
    }),
    vscode.commands.registerCommand('testform.report.selectAllFields', () => {
      reportsProvider.selectAllFields();
    }),
    vscode.commands.registerCommand('testform.report.deselectAllFields', () => {
      reportsProvider.deselectAllFields();
    }),
    vscode.commands.registerCommand('testform.report.refreshView', () => {
      reportsProvider.refresh();
      vscode.window.showInformationMessage('Reports and custom fields refreshed.');
    }),
    vscode.commands.registerCommand('testform.report.trigger', async (reportSlug: string) => {
      // If invoked directly, execute report with current field selections
      reportsProvider.runReportDirect(reportSlug);
    }),
    vscode.commands.registerCommand('testform.report', async () => {
      const reportTypes = [
        { label: 'Test Case Summary', description: 'testcase-summary' },
        { label: 'Test Run Summary', description: 'testrun-summary' },
        { label: 'Detailed Test Runs', description: 'testrun-detailed' },
        { label: 'Test Plan Summary', description: 'testplan-summary' },
        { label: 'Defect Backlog', description: 'defects' },
        { label: 'Traceability Matrix', description: 'traceability' },
        { label: 'Coverage Matrix', description: 'coverage' },
        { label: 'Two-Dimensional Matrix', description: 'two-dimensional' },
        { label: 'Automation & Activity', description: 'test-case-activity' }
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
