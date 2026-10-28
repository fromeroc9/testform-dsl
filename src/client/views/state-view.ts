import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type StateNodeKind = 'category' | 'resource' | 'attribute' | 'output' | 'info';

export class StateTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: StateNodeKind,
    public readonly address?: string,
    public readonly details?: string,
    public readonly childrenNodes?: StateTreeItem[]
  ) {
    super(label, collapsibleState);

    if (details) {
      this.description = details;
    }

    if (kind === 'category') {
      this.contextValue = 'testformCategory';
    } else if (kind === 'resource') {
      this.contextValue = 'testformResource';
      this.tooltip = `Address: ${address}\n${details || ''}`;
      if (address) {
        this.command = {
          command: 'testform.state.showResource',
          title: 'Show Resource in CLI',
          arguments: [address]
        };
      }
    } else if (kind === 'output') {
      this.contextValue = 'testformOutput';
      this.iconPath = new vscode.ThemeIcon('symbol-variable');
    } else if (kind === 'attribute') {
      this.contextValue = 'testformAttribute';
      this.iconPath = new vscode.ThemeIcon('tag');
    } else {
      this.iconPath = new vscode.ThemeIcon('info');
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
      return Promise.resolve(element.childrenNodes || []);
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return Promise.resolve([new StateTreeItem('No workspace open', vscode.TreeItemCollapsibleState.None, 'info')]);
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const statePath = path.join(rootPath, 'testform.state');

    if (!fs.existsSync(statePath)) {
      const item = new StateTreeItem('No state file (run testform apply)', vscode.TreeItemCollapsibleState.None, 'info');
      item.iconPath = new vscode.ThemeIcon('info');
      return Promise.resolve([item]);
    }

    try {
      const content = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(content);
      const resources: any[] = parsed.resources || [];
      const outputs: Record<string, any> = parsed.outputs || {};

      if (resources.length === 0 && Object.keys(outputs).length === 0) {
        return Promise.resolve([
          new StateTreeItem('Empty state (0 managed resources)', vscode.TreeItemCollapsibleState.None, 'info')
        ]);
      }

      const testruns: StateTreeItem[] = [];
      const testcases: StateTreeItem[] = [];
      const testplans: StateTreeItem[] = [];
      const outputItems: StateTreeItem[] = [];

      // 1. Process resources
      for (const r of resources) {
        const type: string = r.type || '';
        const identity: string = (r.identity || '').replace(/\\/g, '/');
        const attrs = r.attributes || {};
        const title: string = attrs.title || identity || type;
        const remoteRef = attrs.remoteId || (attrs.issueNumber ? `#${attrs.issueNumber}` : '');
        const isTainted = !!r.tainted;

        // Build detail child attributes
        const childNodes: StateTreeItem[] = [];
        childNodes.push(new StateTreeItem(`Identity: ${identity}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
        if (remoteRef) {
          childNodes.push(new StateTreeItem(`Remote: ${remoteRef}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
        }
        if (attrs.labels && Array.isArray(attrs.labels)) {
          childNodes.push(new StateTreeItem(`Labels: ${attrs.labels.join(', ')}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
        }
        if (r.lastApplied) {
          childNodes.push(new StateTreeItem(`Last Applied: ${r.lastApplied}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
        }
        if (attrs.testcaseStatuses && typeof attrs.testcaseStatuses === 'object') {
          for (const [tcAddr, st] of Object.entries(attrs.testcaseStatuses)) {
            const shortAddr = tcAddr.replace(/\\/g, '/');
            childNodes.push(new StateTreeItem(`Case: ${shortAddr} → ${st}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
          }
        }

        const resItem = new StateTreeItem(
          title,
          vscode.TreeItemCollapsibleState.Collapsed,
          'resource',
          identity,
          remoteRef ? `${identity} (${remoteRef})` : identity,
          childNodes
        );

        if (isTainted) {
          resItem.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
        } else if (type.includes('testrun')) {
          resItem.iconPath = new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green'));
          testruns.push(resItem);
        } else if (type.includes('testplan')) {
          resItem.iconPath = new vscode.ThemeIcon('notebook', new vscode.ThemeColor('charts.blue'));
          testplans.push(resItem);
        } else {
          resItem.iconPath = new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.purple'));
          testcases.push(resItem);
        }
      }

      // 2. Process outputs
      for (const [key, out] of Object.entries(outputs)) {
        const valStr = typeof out.value === 'object' ? JSON.stringify(out.value) : String(out.value);
        const desc = out.description ? ` - ${out.description}` : '';
        const outItem = new StateTreeItem(
          `${key}: ${valStr}`,
          vscode.TreeItemCollapsibleState.None,
          'output',
          undefined,
          `(${out.type || 'string'})${desc}`
        );
        outputItems.push(outItem);
      }

      // Build category roots
      const categories: StateTreeItem[] = [];

      if (testruns.length > 0) {
        const cat = new StateTreeItem(`Test Runs (${testruns.length})`, vscode.TreeItemCollapsibleState.Expanded, 'category', undefined, undefined, testruns);
        cat.iconPath = new vscode.ThemeIcon('play-circle');
        categories.push(cat);
      }

      if (testcases.length > 0) {
        const cat = new StateTreeItem(`Test Cases (${testcases.length})`, vscode.TreeItemCollapsibleState.Expanded, 'category', undefined, undefined, testcases);
        cat.iconPath = new vscode.ThemeIcon('beaker');
        categories.push(cat);
      }

      if (testplans.length > 0) {
        const cat = new StateTreeItem(`Test Plans (${testplans.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category', undefined, undefined, testplans);
        cat.iconPath = new vscode.ThemeIcon('notebook');
        categories.push(cat);
      }

      if (outputItems.length > 0) {
        const cat = new StateTreeItem(`Outputs (${outputItems.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category', undefined, undefined, outputItems);
        cat.iconPath = new vscode.ThemeIcon('symbol-variable');
        categories.push(cat);
      }

      return Promise.resolve(categories);
    } catch (err: any) {
      const item = new StateTreeItem(`Error reading state: ${err.message}`, vscode.TreeItemCollapsibleState.None, 'info');
      item.iconPath = new vscode.ThemeIcon('error');
      return Promise.resolve([item]);
    }
  }
}
