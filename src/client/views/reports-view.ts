import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface ReportMeta {
  slug: string;
  label: string;
  description: string;
  icon: string;
}

const CORE_REPORTS: ReportMeta[] = [
  {
    slug: 'testcase-summary',
    label: 'Test Case Summary',
    description: 'Execution statuses, metrics, and pass rate',
    icon: 'checklist'
  },
  {
    slug: 'testrun-summary',
    label: 'Test Run Summary',
    description: 'Overview of execution cycles and active runs',
    icon: 'play-circle'
  },
  {
    slug: 'testrun-detailed',
    label: 'Detailed Test Runs',
    description: 'Case-by-case breakdown with priorities',
    icon: 'list-ordered'
  },
  {
    slug: 'testplan-summary',
    label: 'Test Plan Summary',
    description: 'Progress and linked test runs across test plans',
    icon: 'notebook'
  },
  {
    slug: 'coverage',
    label: 'Coverage Matrix',
    description: 'Traceability across tags, components, and scopes',
    icon: 'pie-chart'
  },
  {
    slug: 'matrix',
    label: 'Traceability Matrix',
    description: 'Cross-matrix mapping requirements to test cases',
    icon: 'table'
  },
  {
    slug: 'audit',
    label: 'Quality & Governance Audit',
    description: 'Policy compliance and QA gate validation',
    icon: 'shield'
  }
];

export class ReportTreeItem extends vscode.TreeItem {
  constructor(
    public readonly slug: string,
    public readonly reportTitle: string,
    public readonly reportDescription: string,
    public readonly iconName: string,
    public readonly isCustom: boolean = false
  ) {
    super(reportTitle, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'testformReport';
    // Do not show the slug like "testcase-summary" in the description
    this.description = isCustom ? '[Custom]' : undefined;
    this.tooltip = `${reportTitle}\n${reportDescription}\n\nCommand: testform report ${slug}`;
    this.iconPath = new vscode.ThemeIcon(iconName);
    this.command = {
      command: 'testform.report.trigger',
      title: 'Generate Report',
      arguments: [slug]
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

    const items: ReportTreeItem[] = CORE_REPORTS.map(
      r => new ReportTreeItem(r.slug, r.label, r.description, r.icon, false)
    );

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const rootPath = workspaceFolders[0].uri.fsPath;
      const reportsDir = path.join(rootPath, '.testform', 'reports');
      if (fs.existsSync(reportsDir)) {
        try {
          const entries = fs.readdirSync(reportsDir, { withFileTypes: true });
          for (const e of entries) {
            if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.js'))) {
              const slug = e.name.replace(/\.(format\.)?(ts|js)$/, '');
              if (!CORE_REPORTS.some(c => c.slug === slug)) {
                items.push(
                  new ReportTreeItem(
                    slug,
                    `Custom Report (${slug})`,
                    `Loaded from .testform/reports/${e.name}`,
                    'extensions',
                    true
                  )
                );
              }
            }
          }
        } catch {}
      }
    }

    return Promise.resolve(items);
  }
}
