import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runTestformCommand } from '../terminal';

export class ReportTreeItem extends vscode.TreeItem {
  constructor(
    public readonly reportName: string,
    public readonly isCustom: boolean = false
  ) {
    super(reportName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'testformReport';
    this.description = isCustom ? '(Custom: .testform/reports)' : '(Core)';
    this.iconPath = isCustom ? new vscode.ThemeIcon('extensions') : new vscode.ThemeIcon('graph');
    this.command = {
      command: 'testform.report.trigger',
      title: 'Generate Report',
      arguments: [reportName]
    };
  }
}

export class ReportsTreeProvider implements vscode.TreeDataProvider<ReportTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ReportTreeItem | undefined | null | void> =
    new vscode.EventEmitter<ReportTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ReportTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ReportTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ReportTreeItem): Thenable<ReportTreeItem[]> {
    if (element) return Promise.resolve([]);

    const coreReports = [
      'testcase-summary',
      'testrun-summary',
      'testplan-summary',
      'coverage',
      'matrix',
      'audit'
    ];

    const items: ReportTreeItem[] = coreReports.map(r => new ReportTreeItem(r, false));

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const rootPath = workspaceFolders[0].uri.fsPath;
      const reportsDir = path.join(rootPath, '.testform', 'reports');
      if (fs.existsSync(reportsDir)) {
        try {
          const entries = fs.readdirSync(reportsDir, { withFileTypes: true });
          for (const e of entries) {
            if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.js'))) {
              const baseName = e.name.replace(/\.(format\.)?(ts|js)$/, '');
              if (!coreReports.includes(baseName)) {
                items.push(new ReportTreeItem(baseName, true));
              }
            }
          }
        } catch {}
      }
    }

    return Promise.resolve(items);
  }
}
