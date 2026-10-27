import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { VariableInfo, LocalInfo, DataInfo, TestformWorkspaceConfig } from '../shared/types';

export class WorkspaceScanner {
  private workspaceRoot: string;
  public config: TestformWorkspaceConfig;
  public installedModules: string[] = [];
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

    // 1. Root main.yml / testform.yml (Base Level 0)
    this.scanBaseConfig();

    // 2. Standard Level 1: variables.yml / vars.yml & locals.yml
    this.scanStandardConfigs();

    // 3. Domain Level 2: Project YAMLs
    this.scanDomainConfigs();

    // 4. Level 3: Auto-loaded *.vars.yml / *.vars.yaml files (sorted alphabetically)
    this.scanAutoVarFiles();

    // 5. Scan .testform directory (modules, reports, policies)
    this.scanDotTestform();
  }

  private scanBaseConfig(): void {
    const candidateFiles = ['main.yml', 'main.yaml', 'testform.yml', 'testform.yaml'];
    for (const file of candidateFiles) {
      const fullPath = path.join(this.workspaceRoot, file);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const parsed = YAML.parse(content);
          if (parsed && typeof parsed === 'object') {
            this.parseVariableBlock(parsed.variable || parsed.variables || parsed.vars, fullPath, content);
            this.parseLocalsBlock(parsed.local || parsed.locals, fullPath, content);
            this.parseDataBlock(parsed.data, fullPath, content);
            if (parsed.scopes && typeof parsed.scopes === 'object') {
              if (parsed.scopes.testcase?.match) this.config.scopes.testcase = parsed.scopes.testcase.match;
              if (parsed.scopes.testrun?.match) this.config.scopes.testrun = parsed.scopes.testrun.match;
              if (parsed.scopes.testplan?.match) this.config.scopes.testplan = parsed.scopes.testplan.match;
            }
          }
        } catch {
          // ignore YAML syntax errors while editing
        }
        break;
      }
    }
  }

  private scanStandardConfigs(): void {
    // variables.yml / vars.yml
    for (const name of ['variables.yml', 'variables.yaml', 'vars.yml', 'vars.yaml']) {
      const fullPath = path.join(this.workspaceRoot, name);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const parsed = YAML.parse(content);
          const varsObj = parsed.variable || parsed.variables || parsed.vars || parsed;
          this.parseVariableBlock(varsObj, fullPath, content);
        } catch {}
        break;
      }
    }

    // locals.yml / local.yml
    for (const name of ['locals.yml', 'locals.yaml', 'local.yml', 'local.yaml']) {
      const fullPath = path.join(this.workspaceRoot, name);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const parsed = YAML.parse(content);
          const localsObj = parsed.local || parsed.locals || parsed;
          this.parseLocalsBlock(localsObj, fullPath, content);
        } catch {}
        break;
      }
    }

    // data.yml / data.yaml
    for (const name of ['data.yml', 'data.yaml']) {
      const fullPath = path.join(this.workspaceRoot, name);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const parsed = YAML.parse(content);
          const dataObj = parsed.data || parsed;
          this.parseDataBlock(dataObj, fullPath, content);
        } catch {}
        break;
      }
    }
  }

  private scanDomainConfigs(): void {
    const IGNORED_DIRS = new Set(['node_modules', '.git', '.testform', '.terraform', 'dist', 'coverage', '.system_generated']);
    const RESERVED_ROOT_FILES = new Set([
      'main.yml', 'main.yaml', 'testform.yml', 'testform.yaml',
      'variables.yml', 'variables.yaml', 'vars.yml', 'vars.yaml',
      'locals.yml', 'locals.yaml', 'local.yml', 'local.yaml',
      'data.yml', 'data.yaml', 'outputs.yml', 'outputs.yaml'
    ]);

    const walk = (currentDir: string) => {
      try {
        const isRoot = path.resolve(currentDir) === path.resolve(this.workspaceRoot);
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
              walk(path.join(currentDir, entry.name));
            }
          } else if (entry.isFile()) {
            const lower = entry.name.toLowerCase();
            if ((lower.endsWith('.yml') || lower.endsWith('.yaml')) && !(lower.endsWith('.vars.yml') || lower.endsWith('.vars.yaml'))) {
              if (isRoot && RESERVED_ROOT_FILES.has(lower)) continue;
              const fullPath = path.join(currentDir, entry.name);
              try {
                const content = fs.readFileSync(fullPath, 'utf8');
                const parsed = YAML.parse(content);
                if (parsed && typeof parsed === 'object') {
                  if (parsed.variable || parsed.variables || parsed.vars) {
                    this.parseVariableBlock(parsed.variable || parsed.variables || parsed.vars, fullPath, content);
                  }
                  if (parsed.local || parsed.locals) {
                    this.parseLocalsBlock(parsed.local || parsed.locals, fullPath, content);
                  }
                  if (parsed.data) {
                    this.parseDataBlock(parsed.data, fullPath, content);
                  }
                }
              } catch {}
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
    for (const [type, instances] of Object.entries(block)) {
      if (instances && typeof instances === 'object') {
        for (const [name] of Object.entries(instances)) {
          const line = this.findKeyLineInYaml(content, name);
          this.config.dataSources.set(`${type}.${name}`, {
            type,
            name,
            sourceFile,
            line
          });
        }
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
