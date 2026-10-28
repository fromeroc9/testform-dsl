import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

export class ModuleTreeItem extends vscode.TreeItem {
  public children?: ModuleTreeItem[];

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: 'category' | 'module-declared' | 'module-installed' | 'env-item' | 'policy' | 'info' | 'property',
    public readonly filePath?: string,
    public readonly details?: {
      source?: string;
      vars?: Record<string, any>;
      outputs?: Record<string, any>;
      extra?: string;
    }
  ) {
    super(label, collapsibleState);

    switch (kind) {
      case 'category':
        this.contextValue = 'testformCategory';
        break;
      case 'module-declared':
        this.iconPath = new vscode.ThemeIcon('package');
        this.contextValue = 'testformDeclaredModule';
        this.tooltip = details?.source ? `Declared module: ${label}\nSource: ${details.source}` : `Declared module: ${label}`;
        if (filePath && fs.existsSync(filePath)) {
          this.command = {
            command: 'vscode.open',
            title: 'Open Module Source',
            arguments: [vscode.Uri.file(filePath)]
          };
        }
        break;
      case 'module-installed':
        this.iconPath = new vscode.ThemeIcon('cloud-download');
        this.contextValue = 'testformInstalledModule';
        this.tooltip = `Installed module: ${label}\nPath: ${filePath}`;
        if (filePath && fs.existsSync(filePath)) {
          this.command = {
            command: 'revealInExplorer',
            title: 'Reveal in Explorer',
            arguments: [vscode.Uri.file(filePath)]
          };
        }
        break;
      case 'env-item':
        this.contextValue = 'testformEnvItem';
        break;
      case 'policy':
        this.iconPath = new vscode.ThemeIcon('shield');
        this.contextValue = 'testformPolicy';
        if (filePath && fs.existsSync(filePath)) {
          this.command = {
            command: 'vscode.open',
            title: 'Open Policy File',
            arguments: [vscode.Uri.file(filePath)]
          };
        }
        break;
      case 'property':
        this.iconPath = new vscode.ThemeIcon('symbol-property');
        this.contextValue = 'testformProperty';
        break;
      case 'info':
        this.iconPath = new vscode.ThemeIcon('info');
        this.contextValue = 'testformInfo';
        break;
    }
  }
}

export class ModulesTreeProvider implements vscode.TreeDataProvider<ModuleTreeItem>, vscode.Disposable {
  private _onDidChangeTreeData: vscode.EventEmitter<ModuleTreeItem | undefined | null | void> =
    new vscode.EventEmitter<ModuleTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ModuleTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private disposables: vscode.Disposable[] = [];

  constructor() {
    // Watch workspace manifests and .testform folder for automatic refresh
    const watcher = vscode.workspace.createFileSystemWatcher(
      '{**/main.yml,**/main.yaml,**/testform.yml,**/testform.yaml,**/.testform/**,**/.testform.lock.hcl}'
    );
    watcher.onDidCreate(() => this.refresh());
    watcher.onDidChange(() => this.refresh());
    watcher.onDidDelete(() => this.refresh());
    this.disposables.push(watcher);
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ModuleTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ModuleTreeItem): Promise<ModuleTreeItem[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [new ModuleTreeItem('No workspace open', vscode.TreeItemCollapsibleState.None, 'info')];
    }

    const rootPath = workspaceFolders[0].uri.fsPath;

    // Children of a specific item
    if (element) {
      if (element.children && element.children.length > 0) {
        return element.children;
      }

      if (element.kind === 'category') {
        if (element.label.startsWith('Declared Modules')) {
          return this.getDeclaredModules(rootPath);
        }
        if (element.label.startsWith('Installed Modules')) {
          return this.getInstalledModules(rootPath);
        }
        if (element.label.startsWith('Runtime Environment')) {
          return this.getEnvironmentItems(rootPath);
        }
        if (element.label.startsWith('Policies')) {
          return this.getPolicies(rootPath);
        }
      }

      return [];
    }

    // Root categories
    const declaredCount = this.countDeclaredModules(rootPath);
    const installedCount = this.countInstalledModules(rootPath);
    const policiesCount = this.countPolicies(rootPath);

    const categories: ModuleTreeItem[] = [
      new ModuleTreeItem(
        `Declared Modules (${declaredCount})`,
        declaredCount > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'category'
      ),
      new ModuleTreeItem(
        `Installed Modules (.testform/modules) (${installedCount})`,
        installedCount > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'category'
      ),
      new ModuleTreeItem(
        'Runtime Environment (.testform)',
        vscode.TreeItemCollapsibleState.Expanded,
        'category'
      ),
      new ModuleTreeItem(
        `Policies & Governance (${policiesCount})`,
        policiesCount > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'category'
      )
    ];

    categories[0].iconPath = new vscode.ThemeIcon('package');
    categories[1].iconPath = new vscode.ThemeIcon('cloud-download');
    categories[2].iconPath = new vscode.ThemeIcon('server-process');
    categories[3].iconPath = new vscode.ThemeIcon('shield');

    return categories;
  }

  private countDeclaredModules(rootPath: string): number {
    return this.getDeclaredModules(rootPath).filter(i => i.kind === 'module-declared').length;
  }

  private getDeclaredModules(rootPath: string): ModuleTreeItem[] {
    const items: ModuleTreeItem[] = [];
    const candidates = ['main.yml', 'main.yaml', 'testform.yml', 'testform.yaml'];

    for (const name of candidates) {
      const fullPath = path.join(rootPath, name);
      if (fs.existsSync(fullPath)) {
        try {
          const raw = fs.readFileSync(fullPath, 'utf8');
          const doc = YAML.parse(raw);
          if (doc && typeof doc === 'object') {
            const modBlock = doc.modules || doc.module;
            if (modBlock && typeof modBlock === 'object') {
              for (const [modName, modVal] of Object.entries(modBlock)) {
                if (modVal && typeof modVal === 'object') {
                  const m = modVal as any;
                  const source = m.source || '';
                  const sourceFile = source ? path.resolve(rootPath, source) : undefined;

                  const subItems: ModuleTreeItem[] = [];

                  if (source) {
                    const srcItem = new ModuleTreeItem(`Source: ${source}`, vscode.TreeItemCollapsibleState.None, 'property');
                    srcItem.iconPath = new vscode.ThemeIcon('file-code');
                    if (sourceFile && fs.existsSync(sourceFile)) {
                      srcItem.command = {
                        command: 'vscode.open',
                        title: 'Open Source',
                        arguments: [vscode.Uri.file(sourceFile)]
                      };
                    }
                    subItems.push(srcItem);
                  }

                  const vars = m.vars || m.variables;
                  if (vars && typeof vars === 'object') {
                    for (const [vk, vv] of Object.entries(vars)) {
                      const vItem = new ModuleTreeItem(`Var: ${vk} = ${JSON.stringify(vv)}`, vscode.TreeItemCollapsibleState.None, 'property');
                      vItem.iconPath = new vscode.ThemeIcon('variable');
                      subItems.push(vItem);
                    }
                  }

                  const outputs = m.outputs;
                  if (outputs && typeof outputs === 'object') {
                    for (const [ok, ov] of Object.entries(outputs)) {
                      const outVal = typeof ov === 'object' && ov !== null ? (ov as any).value : ov;
                      const oItem = new ModuleTreeItem(`Output: ${ok} (${outVal || 'computed'})`, vscode.TreeItemCollapsibleState.None, 'property');
                      oItem.iconPath = new vscode.ThemeIcon('symbol-field');
                      subItems.push(oItem);
                    }
                  }

                  const modItem = new ModuleTreeItem(
                    modName,
                    subItems.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    'module-declared',
                    sourceFile,
                    { source, vars, outputs }
                  );
                  modItem.description = source ? `→ ${source}` : 'local module';
                  modItem.children = subItems;
                  items.push(modItem);
                }
              }
            }
          }
        } catch {
          // ignore parse error
        }
      }
    }

    if (items.length === 0) {
      items.push(new ModuleTreeItem('No modules declared in main.yml', vscode.TreeItemCollapsibleState.None, 'info'));
    }

    return items;
  }

  private countInstalledModules(rootPath: string): number {
    const modulesDir = path.join(rootPath, '.testform', 'modules');
    if (!fs.existsSync(modulesDir)) return 0;
    try {
      return fs.readdirSync(modulesDir, { withFileTypes: true }).filter(e => e.isDirectory()).length;
    } catch {
      return 0;
    }
  }

  private getInstalledModules(rootPath: string): ModuleTreeItem[] {
    const modulesDir = path.join(rootPath, '.testform', 'modules');
    const items: ModuleTreeItem[] = [];

    if (fs.existsSync(modulesDir)) {
      try {
        const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            const item = new ModuleTreeItem(
              e.name,
              vscode.TreeItemCollapsibleState.None,
              'module-installed',
              path.join(modulesDir, e.name)
            );
            item.description = '.testform/modules/' + e.name;
            items.push(item);
          }
        }
      } catch {}
    }

    if (items.length === 0) {
      items.push(new ModuleTreeItem('No downloaded packages (run "testform init")', vscode.TreeItemCollapsibleState.None, 'info'));
    }

    return items;
  }

  private getEnvironmentItems(rootPath: string): ModuleTreeItem[] {
    const items: ModuleTreeItem[] = [];

    // 1. Active Workspace from .testform/environment
    const envPath = path.join(rootPath, '.testform', 'environment');
    let currentEnv = 'default';
    if (fs.existsSync(envPath)) {
      try {
        const raw = fs.readFileSync(envPath, 'utf8').trim();
        if (raw) currentEnv = raw;
      } catch {}
    }

    const envItem = new ModuleTreeItem(
      `Workspace: ${currentEnv}`,
      vscode.TreeItemCollapsibleState.None,
      'env-item'
    );
    envItem.iconPath = new vscode.ThemeIcon('layers');
    envItem.description = '(active workspace)';
    envItem.tooltip = `Active isolated workspace: ${currentEnv}\nClick to switch or create workspaces.`;
    envItem.command = {
      command: 'testform.workspace.select',
      title: 'Select Workspace'
    };
    items.push(envItem);

    // 2. Backend Config
    const backendJsonPath = path.join(rootPath, '.testform', 'backend.json');
    let backendName = 'local';
    if (fs.existsSync(backendJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(backendJsonPath, 'utf8'));
        if (parsed.type) backendName = parsed.type;
      } catch {}
    }

    const backendItem = new ModuleTreeItem(
      `Backend: ${backendName}`,
      vscode.TreeItemCollapsibleState.None,
      'env-item'
    );
    backendItem.iconPath = new vscode.ThemeIcon('database');
    backendItem.description = fs.existsSync(backendJsonPath) ? '.testform/backend.json' : 'default';
    items.push(backendItem);

    // 3. Lock File Status
    const lockPath = path.join(rootPath, '.testform.lock.hcl');
    const hasLock = fs.existsSync(lockPath);
    const lockItem = new ModuleTreeItem(
      `Lock: ${hasLock ? '.testform.lock.hcl verified' : 'No lockfile'}`,
      vscode.TreeItemCollapsibleState.None,
      'env-item',
      hasLock ? lockPath : undefined
    );
    lockItem.iconPath = new vscode.ThemeIcon(hasLock ? 'lock' : 'unlock');
    if (hasLock) {
      lockItem.command = {
        command: 'vscode.open',
        title: 'Open Lockfile',
        arguments: [vscode.Uri.file(lockPath)]
      };
    }
    items.push(lockItem);

    return items;
  }

  private countPolicies(rootPath: string): number {
    return this.getPolicies(rootPath).filter(i => i.kind === 'policy').length;
  }

  private getPolicies(rootPath: string): ModuleTreeItem[] {
    const items: ModuleTreeItem[] = [];
    const searchDirs = [
      path.join(rootPath, '.testform', 'policies'),
      path.join(rootPath, 'policies')
    ];

    for (const dir of searchDirs) {
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir);
          for (const f of files) {
            if (f.endsWith('.rego') || f.endsWith('.rego.yml') || f.endsWith('.yaml')) {
              const full = path.join(dir, f);
              const pItem = new ModuleTreeItem(f, vscode.TreeItemCollapsibleState.None, 'policy', full);
              pItem.description = path.relative(rootPath, full).replace(/\\/g, '/');
              items.push(pItem);
            }
          }
        } catch {}
      }
    }

    if (items.length === 0) {
      items.push(new ModuleTreeItem('No custom policies in .testform/policies/', vscode.TreeItemCollapsibleState.None, 'info'));
    }

    return items;
  }
}
