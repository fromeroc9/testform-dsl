import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class TestformFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined> =
    new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> =
    this._onDidChangeFileDecorations.event;

  private isTestformProject: boolean = false;
  private knownTestformFiles: Set<string> = new Set();

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
    this.knownTestformFiles.clear();
    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    const fileName = path.basename(uri.fsPath).toLowerCase();

    // Only inspect YAML files
    if (!fileName.endsWith('.yml') && !fileName.endsWith('.yaml')) {
      return undefined;
    }

    // Auto-loaded *.vars.yml files
    if (fileName.endsWith('.vars.yml') || fileName.endsWith('.vars.yaml')) {
      return {
        badge: 'TF',
        tooltip: 'Testform Variables Value File'
      };
    }

    // Always decorate root entrypoints
    if (fileName === 'main.yml' || fileName === 'main.yaml' || fileName === 'testform.yml' || fileName === 'testform.yaml') {
      return {
        badge: 'TF',
        tooltip: 'Testform Root Manifest'
      };
    }

    // Terraform-style Block Inspection: inspect content for Testform reserved blocks
    if (this.isTestformProject) {
      try {
        const content = fs.readFileSync(uri.fsPath, 'utf8');
        const hasTestformBlock = /^\s*(version|provider|backend|variable|locals|resource|data|module|output|policy)\s*:/m.test(content);
        if (hasTestformBlock) {
          this.knownTestformFiles.add(path.basename(uri.fsPath));
          return {
            badge: 'TF',
            tooltip: 'Testform Configuration Block (Resource/Module)'
          };
        }
      } catch {}
    }

    return undefined;
  }
}

