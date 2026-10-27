import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class ModuleTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly modulePath?: string,
    public readonly kind: 'module' | 'policy' | 'info' = 'module'
  ) {
    super(label, collapsibleState);
    if (kind === 'module') {
      this.iconPath = new vscode.ThemeIcon('package');
      this.contextValue = 'testformModule';
      this.tooltip = `Installed module: ${label}\nPath: ${modulePath}`;
    } else if (kind === 'policy') {
      this.iconPath = new vscode.ThemeIcon('shield');
      this.contextValue = 'testformPolicy';
    } else {
      this.iconPath = new vscode.ThemeIcon('info');
    }
  }
}

export class ModulesTreeProvider implements vscode.TreeDataProvider<ModuleTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ModuleTreeItem | undefined | null | void> =
    new vscode.EventEmitter<ModuleTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ModuleTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ModuleTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ModuleTreeItem): Thenable<ModuleTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return Promise.resolve([new ModuleTreeItem('No workspace open', vscode.TreeItemCollapsibleState.None, undefined, 'info')]);
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const modulesDir = path.join(rootPath, '.testform', 'modules');
    const items: ModuleTreeItem[] = [];

    if (fs.existsSync(modulesDir)) {
      try {
        const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            const item = new ModuleTreeItem(e.name, vscode.TreeItemCollapsibleState.None, path.join(modulesDir, e.name), 'module');
            items.push(item);
          }
        }
      } catch {}
    }

    if (items.length === 0) {
      items.push(new ModuleTreeItem('No installed modules in .testform/modules/', vscode.TreeItemCollapsibleState.None, undefined, 'info'));
    }

    return Promise.resolve(items);
  }
}
