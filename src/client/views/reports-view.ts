import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { detectProjectCustomFields, DetectedField } from '../field-detector';
import { runTestformCommand } from '../terminal';

export interface ReportMeta {
  slug: string;
  label: string;
  description: string;
  icon: string;
}

export const CORE_REPORTS: ReportMeta[] = [
  {
    slug: 'testcase-summary',
    label: 'Test Case Summary',
    description: 'Execution overview and pass/fail metrics of testcases',
    icon: 'checklist'
  },
  {
    slug: 'testrun-summary',
    label: 'Test Run Summary',
    description: 'Test runs and their pass/fail metrics',
    icon: 'play-circle'
  },
  {
    slug: 'testrun-detailed',
    label: 'Detailed Test Runs',
    description: 'In-depth view of testcases and priorities per testrun',
    icon: 'list-ordered'
  },
  {
    slug: 'testplan-summary',
    label: 'Test Plan Summary',
    description: 'Overall Test Plan progress and linked test runs',
    icon: 'notebook'
  },
  {
    slug: 'defects',
    label: 'Defect Backlog',
    description: 'List of failed/blocked tests with issue tracking links',
    icon: 'bug'
  },
  {
    slug: 'traceability',
    label: 'Traceability Matrix',
    description: 'Mapping between requirements/tags and test runs',
    icon: 'table'
  },
  {
    slug: 'coverage',
    label: 'Coverage Matrix',
    description: 'Percentage of passed tests grouped by tags',
    icon: 'pie-chart'
  },
  {
    slug: 'two-dimensional',
    label: 'Two-Dimensional Matrix',
    description: 'Tag distribution across execution statuses',
    icon: 'graph'
  },
  {
    slug: 'test-case-activity',
    label: 'Automation & Activity',
    description: 'Automation rate and recent testcase modifications',
    icon: 'history'
  }
];

export type ReportNodeKind =
  | 'report_item'
  | 'report_run_action'
  | 'format_selector'
  | 'field_item'
  | 'info';

export class ReportTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: ReportNodeKind,
    public readonly slug?: string,
    public readonly fieldName?: string,
    public readonly details?: string,
    public readonly iconName?: string
  ) {
    super(label, collapsibleState);

    if (details) {
      this.description = details;
    }

    if (iconName) {
      this.iconPath = new vscode.ThemeIcon(iconName);
    }

    switch (kind) {
      case 'report_item':
        this.contextValue = 'testformReport';
        break;
      case 'report_run_action':
        this.contextValue = 'testformReportRunAction';
        this.iconPath = new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.green'));
        break;
      case 'format_selector':
        this.contextValue = 'testformReportFormatSelector';
        this.iconPath = new vscode.ThemeIcon('file-code');
        break;
      case 'field_item':
        this.contextValue = 'testformReportFieldItem';
        // Clean: no duplicate icons on field items, the native checkbox is the indicator
        this.iconPath = undefined;
        break;
      default:
        this.contextValue = 'testformReportInfo';
        break;
    }
  }
}

export class ReportsTreeProvider implements vscode.TreeDataProvider<ReportTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ReportTreeItem | undefined | null | void> =
    new vscode.EventEmitter<ReportTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ReportTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private selectedFieldsByReport: Map<string, Set<string>> = new Map<string, Set<string>>();
  private reportFormats: Map<string, string> = new Map<string, string>();
  private defaultFormat: string = 'xlsx';
  private detectedFields: DetectedField[] = [];

  constructor() {
    this.refreshFields();
  }

  public refreshFields(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const rootPath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';
    if (rootPath) {
      this.detectedFields = detectProjectCustomFields(rootPath);
    } else {
      this.detectedFields = [];
    }
  }

  public refresh(): void {
    this.refreshFields();
    this._onDidChangeTreeData.fire();
  }

  public getFormat(slug?: string): string {
    if (slug && this.reportFormats.has(slug)) {
      return this.reportFormats.get(slug)!;
    }
    return this.defaultFormat;
  }

  public setFormat(slugOrFmt: string, fmt?: string): void {
    if (fmt) {
      this.reportFormats.set(slugOrFmt, fmt);
    } else {
      this.defaultFormat = slugOrFmt;
    }
    this._onDidChangeTreeData.fire();
  }

  public getReportFields(slug: string): Set<string> {
    if (!this.selectedFieldsByReport.has(slug)) {
      const allFields = new Set<string>();
      for (const f of this.detectedFields) {
        allFields.add(f.name.toLowerCase());
      }
      this.selectedFieldsByReport.set(slug, allFields);
    }
    return this.selectedFieldsByReport.get(slug)!;
  }

  public toggleField(slug: string, fieldName: string): void {
    const fields = this.getReportFields(slug);
    const lower = fieldName.toLowerCase().trim();
    if (fields.has(lower)) {
      fields.delete(lower);
    } else {
      fields.add(lower);
    }
    this._onDidChangeTreeData.fire();
  }

  public setFieldState(slug: string, fieldName: string, selected: boolean): void {
    const fields = this.getReportFields(slug);
    const lower = fieldName.toLowerCase().trim();
    if (selected) {
      fields.add(lower);
    } else {
      fields.delete(lower);
    }
    this._onDidChangeTreeData.fire();
  }

  public selectAllFields(slug?: string): void {
    if (slug) {
      const all = new Set(this.detectedFields.map(f => f.name.toLowerCase()));
      this.selectedFieldsByReport.set(slug, all);
    } else {
      for (const r of CORE_REPORTS) {
        const all = new Set(this.detectedFields.map(f => f.name.toLowerCase()));
        this.selectedFieldsByReport.set(r.slug, all);
      }
    }
    this._onDidChangeTreeData.fire();
  }

  public deselectAllFields(slug?: string): void {
    if (slug) {
      this.selectedFieldsByReport.set(slug, new Set<string>());
    } else {
      for (const r of CORE_REPORTS) {
        this.selectedFieldsByReport.set(r.slug, new Set<string>());
      }
    }
    this._onDidChangeTreeData.fire();
  }

  public runReportDirect(reportSlug: string): void {
    const fields = this.getReportFields(reportSlug);
    let fieldsArg = '';
    if (this.detectedFields.length > 0) {
      if (fields.size === this.detectedFields.length) {
        fieldsArg = ' --fields="all"';
      } else if (fields.size === 0) {
        fieldsArg = ' --fields="none"';
      } else {
        const names = Array.from(fields).join(',');
        fieldsArg = ` --fields="${names}"`;
      }
    }

    const fmt = this.getFormat(reportSlug);
    runTestformCommand(`report ${reportSlug} -format=${fmt}${fieldsArg}`);
  }

  getTreeItem(element: ReportTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ReportTreeItem): Promise<ReportTreeItem[]> {
    // 1. Root Level: Directly list the reports (clean, no redundant parent folders)
    if (!element) {
      const reports = await this.getReportDefinitions();
      return reports.map(r => {
        const fmt = this.getFormat(r.slug);
        const item = new ReportTreeItem(
          r.label,
          vscode.TreeItemCollapsibleState.Collapsed,
          'report_item',
          r.slug,
          undefined,
          `[${fmt}]`,
          r.icon
        );

        const fields = this.getReportFields(r.slug);
        const summary = fields.size > 0
          ? `${fields.size} campos seleccionados`
          : 'columnas nativas';
        item.tooltip = `${r.label} (${fmt})\n${r.description}\n\nCampos a incluir: ${summary}\n\n▶ Haz clic en Play para generar este reporte directamente.`;
        return item;
      });
    }

    // 2. Children of an expanded Report: Directly the clean checkable fields
    if (element.kind === 'report_item' && element.slug) {
      const slug = element.slug;
      const fields = this.getReportFields(slug);
      const items: ReportTreeItem[] = [];

      // Field items with clean checkboxes (no redundant check icon, no extra internal rows)
      for (const f of this.detectedFields) {
        const isChecked = fields.has(f.name.toLowerCase());
        const fieldItem = new ReportTreeItem(
          f.name,
          vscode.TreeItemCollapsibleState.None,
          'field_item',
          slug,
          f.name
        );

        // Native interactive checkbox
        fieldItem.checkboxState = isChecked
          ? vscode.TreeItemCheckboxState.Checked
          : vscode.TreeItemCheckboxState.Unchecked;

        fieldItem.tooltip = `Campo: ${f.name}\nOrigen: ${f.origin}\nApariciones: ${f.count}\nEstado: ${isChecked ? 'Marcado (se incluirá)' : 'Desmarcado (no se incluirá)'}\n\nHaz clic para marcar/desmarcar`;

        fieldItem.command = {
          command: 'testform.report.toggleField',
          title: 'Toggle Field',
          arguments: [slug, f.name]
        };

        items.push(fieldItem);
      }

      return items;
    }

    return [];
  }

  private async getReportDefinitions(): Promise<ReportMeta[]> {
    const items: ReportMeta[] = [...CORE_REPORTS];

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
              if (!items.some(c => c.slug === slug)) {
                items.push({
                  slug,
                  label: `Custom: ${slug}`,
                  description: `Reporte en .testform/reports/${e.name}`,
                  icon: 'extensions'
                });
              }
            }
          }
        } catch {}
      }
    }

    return items;
  }
}
