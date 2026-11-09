import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as YAML from 'yaml';

export class TestformFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined> =
    new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> =
    this._onDidChangeFileDecorations.event;

  private isTestformProject: boolean = false;
  private testcaseScaffoldDir: string = 'testcase';
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

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('testform')) {
        this.refresh();
      }
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
    this.testcaseScaffoldDir = 'testcase';

    for (const f of candidates) {
      const fullPath = path.join(root, f);
      if (fs.existsSync(fullPath)) {
        this.isTestformProject = true;
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const parsed = YAML.parse(content);
          const res = parsed?.resource || parsed?.scopes;
          if (res?.testcase?.scaffold?.directory) {
            this.testcaseScaffoldDir = String(res.testcase.scaffold.directory).trim();
          }
        } catch {}
        break;
      }
    }
  }

  public refresh(): void {
    this.checkWorkspace();
    this.knownTestformFiles.clear();
    this._onDidChangeFileDecorations.fire(undefined);
  }

  private containsFeatureFiles(dir: string): boolean {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.toLowerCase().endsWith('.feature')) return true;
        if (e.isDirectory() && !e.name.startsWith('.')) {
          if (this.containsFeatureFiles(path.join(dir, e.name))) return true;
        }
      }
    } catch {}
    return false;
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (!this.isTestformProject) return undefined;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    const root = folders[0].uri.fsPath;

    let isDirectory = false;
    try {
      const stat = fs.statSync(uri.fsPath);
      isDirectory = stat.isDirectory();
    } catch {
      return undefined;
    }

    // 1. Directory Decoration: Subfolders containing .feature inside testcase scaffold dir get the blue cube 📦
    if (isDirectory) {
      const enabled = vscode.workspace.getConfiguration('testform').get('decorations.moduleFolders', true);
      if (!enabled) return undefined;

      const relPath = path.relative(root, uri.fsPath).replace(/\\/g, '/');
      const tcScaffold = (this.testcaseScaffoldDir || 'testcase').replace(/^[/\\]+|[/\\]+$/g, '');

      // The root scaffold directory itself (e.g. 'testcase') does not get the cube badge
      if (relPath.toLowerCase() === tcScaffold.toLowerCase()) {
        return undefined;
      }

      // Check if it is a subfolder of the testcase scaffold folder
      const prefix = tcScaffold.toLowerCase() + '/';
      if (relPath.toLowerCase().startsWith(prefix)) {
        if (this.containsFeatureFiles(uri.fsPath)) {
          return {
            badge: '📦',
            color: new vscode.ThemeColor('charts.blue'),
            tooltip: `Testform Module: ${path.basename(uri.fsPath)}`
          };
        }
      }
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
