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
      { scheme: 'file', language: 'gherkin' }
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
  statusBarItem.command = 'testform.plan';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const updateProjectDetection = async () => {
    const files = await vscode.workspace.findFiles('{main.yml,main.yaml,testform.yml,testform.yaml,**/main.yml,**/testform.yml}', '**/node_modules/**', 1);
    const isTestform = files.length > 0;
    vscode.commands.executeCommand('setContext', 'testform:isTestformProject', isTestform);
    vscode.commands.executeCommand('setContext', 'testform.isTestformWorkspace', isTestform);

    if (isTestform) {
      statusBarItem.text = '$(beaker) Testform: Ready';
      statusBarItem.tooltip = 'Testform Project Detected (Click to run Plan)';
      statusBarItem.command = 'testform.plan';
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

  // 4. Test Controller
  const testController = new TestformTestController();
  context.subscriptions.push(testController);

  // 5. Register Commands
  context.subscriptions.push(
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
      runTestformCommand('init -upgrade');
      modulesProvider.refresh();
    }),
    vscode.commands.registerCommand('testform.format', () => {
      vscode.commands.executeCommand('editor.action.formatDocument');
    }),
    vscode.commands.registerCommand('testform.report.trigger', async (reportName: string) => {
      const format = await vscode.window.showQuickPick(
        [
          { label: 'markdown', description: 'Markdown format (.md)' },
          { label: 'docx', description: 'Microsoft Word report (.docx)' },
          { label: 'xlsx', description: 'Microsoft Excel spreadsheet (.xlsx)' },
          { label: 'json', description: 'JSON raw report data (.json)' },
          { label: 'csv', description: 'CSV data export (.csv)' }
        ],
        { placeHolder: `Select export format for "${reportName}"` }
      );

      if (format) {
        runTestformCommand(`report ${reportName} -format=${format.label}`);
      }
    }),
    vscode.commands.registerCommand('testform.report', async () => {
      const reportTypes = [
        'testcase-summary',
        'testrun-summary',
        'testplan-summary',
        'coverage',
        'matrix',
        'audit'
      ];

      const selected = await vscode.window.showQuickPick(reportTypes, {
        placeHolder: 'Select report type to generate'
      });

      if (selected) {
        vscode.commands.executeCommand('testform.report.trigger', selected);
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
