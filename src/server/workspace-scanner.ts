import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { VariableInfo, LocalInfo, DataInfo, TestformWorkspaceConfig } from '../shared/types';

export class WorkspaceScanner {
  private workspaceRoot: string;
  public config: TestformWorkspaceConfig;
  public installedModules: string[] = [];
  public declaredModules: Map<string, { source: string; outputs: string[] }> = new Map();
  public customReports: string[] = [];
  public customPolicies: string[] = [];

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.config = {
      variables: new Map(),
      locals: new Map(),
      dataSources: new Map(),
      scopes: {
        testcase: '*.case.feature',
        testrun: '*.run.feature',
        testplan: '*.plan.feature'
      }
    };
  }

  public scanAll(): void {
    this.config.variables.clear();
    this.config.locals.clear();
    this.config.dataSources.clear();
    this.declaredModules.clear();

    // 1. Root main.yml / testform.yml (Base Level 0)
    const baseFile = this.scanBaseConfig();

    // 2. Terraform-style Block Scanner: Scans all workspace YAMLs reading blocks regardless of filename
    this.scanManifestFiles(baseFile);

    // 3. Level 3: Auto-loaded *.vars.yml / *.vars.yaml files (sorted alphabetically)
    this.scanAutoVarFiles();

    // 4. Scan .testform directory (modules, reports, policies)
    this.scanDotTestform();
  }

  private scanBaseConfig(): string | null {
    const candidateFiles = ['main.yml', 'main.yaml', 'testform.yml', 'testform.yaml', 'testform.config.yml', 'testform.config.yaml'];
    for (const file of candidateFiles) {
      const fullPath = path.join(this.workspaceRoot, file);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const parsed = YAML.parse(content);
          if (parsed && typeof parsed === 'object') {
            this.parseVariableBlock(parsed.variable || parsed.variables || parsed.vars, fullPath, content);
            this.parseLocalsBlock(parsed.locals || parsed.local, fullPath, content);
            this.parseDataBlock(parsed.data, fullPath, content);
            this.parseModulesBlock(parsed.module || parsed.modules, fullPath, content);
            const resBlock = parsed.resource || parsed.scopes;
            if (resBlock && typeof resBlock === 'object') {
              if (resBlock.testcase?.match) this.config.scopes.testcase = resBlock.testcase.match;
              if (resBlock.testrun?.match) this.config.scopes.testrun = resBlock.testrun.match;
              if (resBlock.testplan?.match) this.config.scopes.testplan = resBlock.testplan.match;
            }
          }
        } catch {
          // ignore YAML syntax errors while editing
        }
        return fullPath;
      }
    }
    return null;
  }

  /**
   * Scans all YAML files in the workspace (Terraform style).
   * Reads and merges blocks (variable, locals, resource, data, module, output, policy)
   * regardless of arbitrary file naming.
   */
  private scanManifestFiles(baseFile: string | null): void {
    const IGNORED_DIRS = new Set(['node_modules', '.git', '.testform', '.terraform', 'dist', 'coverage', '.system_generated']);

    const walk = (currentDir: string) => {
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
              walk(path.join(currentDir, entry.name));
            }
          } else if (entry.isFile()) {
            const lower = entry.name.toLowerCase();
            // Skip non-YAML files, *.vars.yml value files (handled in Level 3), and base config already parsed
            if (!lower.endsWith('.yml') && !lower.endsWith('.yaml')) continue;
            if (lower.endsWith('.vars.yml') || lower.endsWith('.vars.yaml')) continue;

            const fullPath = path.join(currentDir, entry.name);
            if (baseFile && path.resolve(fullPath) === path.resolve(baseFile)) continue;

            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              const parsed = YAML.parse(content);
              if (!parsed || typeof parsed !== 'object') continue;

              // 1. Variable block (variable: or variables: or naked object in variable.yml / variables.yml)
              const varsObj = parsed.variable || parsed.variables || parsed.vars;
              if (varsObj && typeof varsObj === 'object') {
                this.parseVariableBlock(varsObj, fullPath, content);
              } else if (lower.startsWith('variable.') || lower.startsWith('variables.') || lower.startsWith('vars.')) {
                this.parseVariableBlock(parsed, fullPath, content);
              }

              // 2. Locals block (locals: or local: or naked object in locals.yml / local.yml)
              const localsObj = parsed.locals || parsed.local;
              if (localsObj && typeof localsObj === 'object') {
                this.parseLocalsBlock(localsObj, fullPath, content);
              } else if (lower.startsWith('locals.') || lower.startsWith('local.')) {
                this.parseLocalsBlock(parsed, fullPath, content);
              }

              // 3. Resource block (resource: or scopes: or naked object in resource.yml)
              const resBlock = parsed.resource || parsed.scopes;
              const targetRes = (resBlock && typeof resBlock === 'object') ? resBlock : (lower.startsWith('resource.') ? parsed : null);
              if (targetRes && typeof targetRes === 'object') {
                if (targetRes.testcase?.match) this.config.scopes.testcase = targetRes.testcase.match;
                if (targetRes.testrun?.match) this.config.scopes.testrun = targetRes.testrun.match;
                if (targetRes.testplan?.match) this.config.scopes.testplan = targetRes.testplan.match;
              }

              // 4. Data block (data: or naked object in data.yml)
              const dataObj = parsed.data;
              if (dataObj && typeof dataObj === 'object') {
                this.parseDataBlock(dataObj, fullPath, content);
              } else if (lower.startsWith('data.')) {
                this.parseDataBlock(parsed, fullPath, content);
              }

              // 5. Module block (module: or modules:)
              const moduleObj = parsed.module || parsed.modules;
              if (moduleObj && typeof moduleObj === 'object') {
                this.parseModulesBlock(moduleObj, fullPath, content);
              }
            } catch {
              // Ignore syntax errors while typing
            }
          }
        }
      } catch {}
    };

    walk(this.workspaceRoot);
  }

  private scanAutoVarFiles(): void {
    if (!fs.existsSync(this.workspaceRoot)) return;
    try {
      const entries = fs.readdirSync(this.workspaceRoot);
      const autoVarFiles = entries
        .filter(f => f.endsWith('.vars.yml') || f.endsWith('.vars.yaml'))
        .sort();

      for (const file of autoVarFiles) {
        const fullPath = path.join(this.workspaceRoot, file);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const parsed = YAML.parse(content);
          if (parsed && typeof parsed === 'object') {
            for (const [key, val] of Object.entries(parsed)) {
              const existing = this.config.variables.get(key);
              const line = this.findKeyLineInYaml(content, key);
              this.config.variables.set(key, {
                name: key,
                type: existing?.type || typeof val,
                description: existing?.description,
                defaultValue: val,
                sourceFile: fullPath,
                line
              });
            }
          }
        } catch {}
      }
    } catch {}
  }

  private scanDotTestform(): void {
    const dotTestform = path.join(this.workspaceRoot, '.testform');
    this.installedModules = [];
    this.customReports = [];
    this.customPolicies = [];

    if (!fs.existsSync(dotTestform)) return;

    // 1. Modules
    const modulesDir = path.join(dotTestform, 'modules');
    if (fs.existsSync(modulesDir)) {
      try {
        const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) this.installedModules.push(e.name);
        }
      } catch {}
    }

    // 2. Reports
    const reportsDir = path.join(dotTestform, 'reports');
    if (fs.existsSync(reportsDir)) {
      try {
        const entries = fs.readdirSync(reportsDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.js'))) {
            this.customReports.push(e.name.replace(/\.(format\.)?(ts|js)$/, ''));
          } else if (e.isDirectory()) {
            this.customReports.push(e.name);
          }
        }
      } catch {}
    }

    // 3. Policies
    const policiesDir = path.join(dotTestform, 'policies');
    if (fs.existsSync(policiesDir)) {
      try {
        const entries = fs.readdirSync(policiesDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.js'))) {
            this.customPolicies.push(e.name);
          }
        }
      } catch {}
    }
  }

  private parseVariableBlock(block: any, sourceFile: string, content: string): void {
    if (!block || typeof block !== 'object') return;
    for (const [key, decl] of Object.entries(block)) {
      const line = this.findKeyLineInYaml(content, key);
      if (decl && typeof decl === 'object' && !Array.isArray(decl)) {
        const d = decl as any;
        this.config.variables.set(key, {
          name: key,
          type: d.type || (d.default !== undefined ? typeof d.default : 'string'),
          description: d.description,
          defaultValue: d.default,
          sourceFile,
          line
        });
      } else {
        this.config.variables.set(key, {
          name: key,
          type: typeof decl,
          defaultValue: decl,
          sourceFile,
          line
        });
      }
    }
  }

  private parseLocalsBlock(block: any, sourceFile: string, content: string): void {
    if (!block || typeof block !== 'object') return;
    for (const [key, val] of Object.entries(block)) {
      const line = this.findKeyLineInYaml(content, key);
      this.config.locals.set(key, {
        name: key,
        expression: String(val),
        sourceFile,
        line
      });
    }
  }

  private parseDataBlock(block: any, sourceFile: string, content: string): void {
    if (!block || typeof block !== 'object') return;
    const KNOWN_SCOPES = new Set(['testcase', 'testrun', 'testplan', 'local_file', 'http']);

    for (const [key, val] of Object.entries(block)) {
      if (val === undefined || val === null) continue;
      const line = this.findKeyLineInYaml(content, key);

      // 1. Grouped by scope/type (e.g. http: { api: "https://..." } or local_file: { users: "..." })
      if (KNOWN_SCOPES.has(key) && typeof val === 'object' && !Array.isArray(val)) {
        for (const [subKey, subVal] of Object.entries(val)) {
          const subLine = this.findKeyLineInYaml(content, subKey);
          const dataInfo: DataInfo = {
            type: key,
            name: subKey,
            sourceFile,
            line: subLine || line
          };
          this.config.dataSources.set(`${key}.${subKey}`, dataInfo);
          this.config.dataSources.set(subKey, dataInfo);
        }
        continue;
      }

      // 2. Compact single-line string at root: e.g. users: "fixtures/users.json", api: "https://..."
      if (typeof val === 'string') {
        const lower = val.toLowerCase().trim();
        let detectedType = 'data';
        if (lower.startsWith('http://') || lower.startsWith('https://')) {
          detectedType = 'http';
        } else if (lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.csv')) {
          detectedType = 'local_file';
        } else if (lower.includes('.feature') || lower.startsWith('@')) {
          detectedType = 'testcase';
        }

        const dataInfo: DataInfo = {
          type: detectedType,
          name: key,
          sourceFile,
          line
        };
        this.config.dataSources.set(key, dataInfo);
        this.config.dataSources.set(`${detectedType}.${key}`, dataInfo);
        continue;
      }

      // 3. Object instance at root: e.g. my_api: { url: "https://...", method: "POST" }
      if (typeof val === 'object') {
        const v = val as any;
        let detectedType = 'data';
        if (v.url) detectedType = 'http';
        else if (v.file) detectedType = 'local_file';
        else if (v.address) detectedType = 'testcase';

        const dataInfo: DataInfo = {
          type: detectedType,
          name: key,
          sourceFile,
          line
        };
        this.config.dataSources.set(key, dataInfo);
        this.config.dataSources.set(`${detectedType}.${key}`, dataInfo);
      }
    }
  }

  private parseModulesBlock(block: any, sourceFile: string, content: string): void {
    if (!block || typeof block !== 'object') return;
    for (const [key, mod] of Object.entries(block)) {
      if (!mod || typeof mod !== 'object') continue;
      const outputs: string[] = [];
      if ((mod as any).outputs && typeof (mod as any).outputs === 'object') {
        outputs.push(...Object.keys((mod as any).outputs));
      }
      this.declaredModules.set(key, {
        source: (mod as any).source || '',
        outputs
      });
      if (!this.installedModules.includes(key)) {
        this.installedModules.push(key);
      }
    }
  }

  private findKeyLineInYaml(content: string, key: string): number {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith(`${key}:`) || trimmed.startsWith(`"${key}":`) || trimmed.startsWith(`'${key}':`)) {
        return i;
      }
    }
    return 0;
  }
}
