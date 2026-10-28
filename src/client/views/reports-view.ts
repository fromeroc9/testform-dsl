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
    label: 'Resumen de Casos de Prueba',
    description: 'Métricas de estado, ejecución y porcentaje de éxito',
    icon: 'checklist'
  },
  {
    slug: 'testrun-summary',
    label: 'Resumen de Test Runs',
    description: 'Resumen de ejecuciones y ciclos activos/cerrados',
    icon: 'play-circle'
  },
  {
    slug: 'testrun-detailed',
    label: 'Detalle de Ejecución de Corridas',
    description: 'Detalle caso por caso, prioridades y asignados',
    icon: 'list-ordered'
  },
  {
    slug: 'testplan-summary',
    label: 'Resumen de Planes de Prueba',
    description: 'Progreso y vinculación de corridas por plan',
    icon: 'notebook'
  },
  {
    slug: 'coverage',
    label: 'Matriz de Cobertura',
    description: 'Cobertura por tags, componentes y requerimientos',
    icon: 'pie-chart'
  },
  {
    slug: 'matrix',
    label: 'Matriz de Trazabilidad',
    description: 'Matriz cruzada de requerimientos y casos',
    icon: 'table'
  },
  {
    slug: 'audit',
    label: 'Auditoría y Calidad',
    description: 'Cumplimiento de políticas y control de gobernanza',
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
    this.description = isCustom ? `[Custom] ${slug}` : slug;
    this.tooltip = `${reportTitle}\n${reportDescription}\n\nComando: testform report ${slug}`;
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
                    `Reporte Personalizado (${slug})`,
                    `Reporte cargado desde .testform/reports/${e.name}`,
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
