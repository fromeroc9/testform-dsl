import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runTestformCommand } from '../terminal';

export class StateTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly resourceAddress?: string,
    public readonly details?: string
  ) {
    super(label, collapsibleState);
    if (resourceAddress) {
      this.tooltip = `Resource: ${resourceAddress}\n${details || ''}`;
      this.description = details;
      this.contextValue = 'testformResource';
      this.iconPath = new vscode.ThemeIcon('symbol-property');
    } else {
      this.iconPath = new vscode.ThemeIcon('database');
    }
  }
}

export class StateTreeProvider implements vscode.TreeDataProvider<StateTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<StateTreeItem | undefined | null | void> =
    new vscode.EventEmitter<StateTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<StateTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: StateTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: StateTreeItem): Thenable<StateTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return Promise.resolve([new StateTreeItem('No workspace open', vscode.TreeItemCollapsibleState.None)]);
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const statePath = path.join(rootPath, 'testform.state');

    if (!fs.existsSync(statePath)) {
      const item = new StateTreeItem('No state file (run testform apply)', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      return Promise.resolve([item]);
    }

    try {
      const content = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(content);
      const resources = parsed.resources || [];

      if (resources.length === 0) {
        return Promise.resolve([
          new StateTreeItem('Empty state (0 resources)', vscode.TreeItemCollapsibleState.None)
        ]);
      }

      const items = resources.map((r: any) => {
        const address = `${r.type}.${r.name}`;
        const status = r.attributes?.status || (r.tainted ? 'tainted' : 'active');
        const item = new StateTreeItem(
          r.name || r.type,
          vscode.TreeItemCollapsibleState.None,
          address,
          `[${status}]`
        );
        if (r.tainted) {
          item.iconPath = new vscode.ThemeIcon('warning');
        } else if (status === 'passed') {
          item.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
        } else if (status === 'failed') {
          item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        }
        item.command = {
          command: 'testform.state.showResource',
          title: 'Show Resource',
          arguments: [address]
        };
        return item;
      });

      return Promise.resolve(items);
    } catch (err: any) {
      const item = new StateTreeItem(`Error reading state: ${err.message}`, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('error');
      return Promise.resolve([item]);
    }
  }
}
