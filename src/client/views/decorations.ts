import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class TestformFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined> =
    new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> =
    this._onDidChangeFileDecorations.event;

  private isTestformProject: boolean = false;

  constructor() {
    this.checkWorkspace();
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{yml,yaml}');
    watcher.onDidCreate(() => this.refresh());
    watcher.onDidDelete(() => this.refresh());
    watcher.onDidChange(() => this.refresh());
  }

  private checkWorkspace(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.isTestformProject = false;
      return;
    }

    const root = folders[0].uri.fsPath;
    const candidates = ['main.yml', 'main.yaml', 'testform.yml', 'testform.yaml'];
    this.isTestformProject = candidates.some(f => fs.existsSync(path.join(root, f)));
  }

  public refresh(): void {
    this.checkWorkspace();
    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    const fileName = path.basename(uri.fsPath).toLowerCase();

    // Only decorate YAML configuration files (no intrusive decorations or colors on feature files)
    if (!fileName.endsWith('.yml') && !fileName.endsWith('.yaml')) {
      return undefined;
    }

    // Root manifests always get TF
    const ROOT_CONFIGS = new Set([
      'main.yml', 'main.yaml',
      'testform.yml', 'testform.yaml',
      'variable.yml', 'variable.yaml', 'variables.yml', 'variables.yaml',
      'locals.yml', 'locals.yaml', 'local.yml', 'local.yaml',
      'resource.yml', 'resource.yaml',
      'data.yml', 'data.yaml',
      'output.yml', 'output.yaml', 'outputs.yml', 'outputs.yaml'
    ]);

    if (ROOT_CONFIGS.has(fileName) || fileName.endsWith('.vars.yml') || fileName.endsWith('.vars.yaml')) {
      return {
        badge: 'TF',
        tooltip: 'Testform Configuration'
      };
    }

    // In a Testform workspace, check if any YAML file declares Testform blocks (Terraform-style)
    if (this.isTestformProject) {
      try {
        const content = fs.readFileSync(uri.fsPath, 'utf8');
        const hasTestformBlock = /^(version|provider|backend|variable|locals|local|resource|data|modules|module|output|outputs)\s*:/m.test(content);
        if (hasTestformBlock) {
          return {
            badge: 'TF',
            tooltip: 'Testform Configuration'
          };
        }
      } catch {}
    }

    return undefined;
  }
}

