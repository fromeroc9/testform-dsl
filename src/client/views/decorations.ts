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
    const yamlWatcher = vscode.workspace.createFileSystemWatcher('**/*.{yml,yaml}');
    yamlWatcher.onDidCreate(() => this.refresh());
    yamlWatcher.onDidDelete(() => this.refresh());
    yamlWatcher.onDidChange(() => this.refresh());

    const featWatcher = vscode.workspace.createFileSystemWatcher('**/*.feature');
    featWatcher.onDidCreate(() => this.refresh());
    featWatcher.onDidDelete(() => this.refresh());
    featWatcher.onDidChange(() => this.refresh());

    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.checkWorkspace();
      this.refresh();
    });
  }

  private checkWorkspace(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.isTestformProject = false;
      return;
    }

    const root = folders[0].uri.fsPath;
    const candidates = ['main.yml', 'main.yaml', 'testform.yml', 'testform.yaml'];
    this.isTestformProject = false;

    for (const f of candidates) {
      const fullPath = path.join(root, f);
      if (fs.existsSync(fullPath)) {
        this.isTestformProject = true;
        break;
      }
    }
  }

  public refresh(): void {
    this.checkWorkspace();
    this.knownTestformFiles.clear();
    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (!this.isTestformProject) return undefined;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;

    let isDirectory = false;
    try {
      const stat = fs.statSync(uri.fsPath);
      isDirectory = stat.isDirectory();
    } catch {
      return undefined;
    }

    // Do not decorate directories (preserves native folder icons and colors)
    if (isDirectory) {
      return undefined;
    }

    const fileName = path.basename(uri.fsPath).toLowerCase();

    // 2. YAML File Decoration
    if (fileName.endsWith('.yml') || fileName.endsWith('.yaml')) {
      // Auto-loaded *.vars.yml files
      if (fileName.endsWith('.vars.yml') || fileName.endsWith('.vars.yaml')) {
        return {
          badge: 'TF',
          tooltip: 'Testform Variables Value File'
        };
      }

      // Root entrypoints
      if (fileName === 'main.yml' || fileName === 'main.yaml' || fileName === 'testform.yml' || fileName === 'testform.yaml') {
        return {
          badge: 'TF',
          tooltip: 'Testform Root Manifest'
        };
      }

      // Terraform-style Block Inspection: inspect content for Testform reserved blocks
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
