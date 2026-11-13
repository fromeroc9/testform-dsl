import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as YAML from 'yaml';
import { DataInfo, ScenarioIdentityInfo, TestformWorkspaceConfig } from '../shared/types';
import {
  applyResourceBlockToConfig,
  createDefaultIdentities,
  findAllIdentityMatchesInLine,
  findScenarioByIdentityTag,
  matchesGlobMatchPattern,
  ResourceScope
} from '../shared/identity';

const SCOPE_TO_LEGACY_KEY: Record<ResourceScope, 'tc' | 'tr' | 'tp' | 'bg'> = {
  testcase: 'tc',
  testrun: 'tr',
  testplan: 'tp',
  bug: 'bg'
};

export class WorkspaceScanner {
  private workspaceRoot: string;
  public config: TestformWorkspaceConfig;
  public installedModules: string[] = [];
  public declaredModules: Map<string, { source: string; outputs: string[] }> = new Map();
  public customReports: string[] = [];
  public customPolicies: string[] = [];
  public customFields: Map<string, {
    name: string;
    source?: string;
    required?: boolean;
    default?: any;
    enum?: string[];
    scopes?: Array<'global' | 'testcase' | 'testrun' | 'testplan' | 'bug'>;
  }> = new Map();
  public featureFiles: Map<string, {
    relPath: string;
    fullPath: string;
    scope: 'testcase' | 'testrun' | 'testplan' | 'bug';
    title: string;
    namespace?: string;
  }> = new Map();
  private explicitIdentityScopes: Set<ResourceScope> = new Set();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.config = {
      variables: new Map(),
      locals: new Map(),
      dataSources: new Map(),
      scenarios: new Map(),
      scenarioAddresses: new Map(),
      duplicateScenarioTags: new Map(),
      maxIdentityIds: { tc: 0, tr: 0, tp: 0, bg: 0 },
      maxIdentityByScope: { testcase: 0, testrun: 0, testplan: 0, bug: 0 },
      identities: createDefaultIdentities(),
      scopes: {
        testcase: '*.case.feature',
        testrun: '*.run.feature',
        testplan: '*.plan.feature',
        bug: '*.bug.feature'
      },
      scaffoldDirectories: {
        testcase: 'testcase',
        testrun: 'testruns',
        testplan: 'testplans',
        bug: 'bugs'
      },
      targetFormat: 'tag'
    };
  }

  public scanAll(): void {
    this.config.variables.clear();
    this.config.locals.clear();
    this.config.dataSources.clear();
    this.config.scenarios.clear();
    this.config.scenarioAddresses.clear();
    this.config.duplicateScenarioTags.clear();
    this.config.maxIdentityIds = { tc: 0, tr: 0, tp: 0, bg: 0 };
    this.config.maxIdentityByScope = { testcase: 0, testrun: 0, testplan: 0, bug: 0 };
    this.config.identities = createDefaultIdentities();
    this.config.scopes = {
      testcase: '*.case.feature',
      testrun: '*.run.feature',
      testplan: '*.plan.feature',
      bug: '*.bug.feature'
    };
    this.config.scaffoldDirectories = {
      testcase: 'testcase',
      testrun: 'testruns',
      testplan: 'testplans',
      bug: 'bugs'
    };
    this.explicitIdentityScopes.clear();
    this.declaredModules.clear();
    this.featureFiles.clear();
    this.customFields.clear();

    // 1. Root main.yml / testform.yml (Base Level 0)
    const baseFile = this.scanBaseConfig();

    // 2. Terraform-style Block Scanner: Scans all workspace YAMLs reading blocks regardless of filename
    this.scanManifestFiles(baseFile);

    // 3. Level 3: Auto-loaded *.vars.yml / *.vars.yaml files (sorted alphabetically)
    this.scanAutoVarFiles();

    // 4. Ingest TESTFORM_VAR_* and TF_VAR_* environment variables
    this.scanEnvironmentVariables();

    // 5. Scan .feature files for Scenarios, IDs and Addresses
    this.scanFeatureFiles();

    // 6. Scan .testform directory (modules, reports, policies)
    this.scanDotTestform();
  }

  private applyResourceBlock(resBlock: any): void {
    applyResourceBlockToConfig(resBlock, this.explicitIdentityScopes, this.config);
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
            this.parseModulesBlock(parsed.module || parsed.modules);
            const resBlock = parsed.resource || parsed.scopes;
            if (resBlock && typeof resBlock === 'object') {
              this.applyResourceBlock(resBlock);

              const extractFields = (fObj: any, scope: 'global' | 'testcase' | 'testrun' | 'testplan' | 'bug' = 'global') => {
                if (!fObj) return;

                const registerField = (name: string, source?: string, required?: boolean, defVal?: any, enumArr?: string[]) => {
                  const key = name.toLowerCase();
                  const existing = this.customFields.get(key);
                  if (existing) {
                    if (!existing.scopes) existing.scopes = ['global'];
                    if (!existing.scopes.includes(scope)) existing.scopes.push(scope);
                    if (required !== undefined) existing.required = !!required;
                    if (source) existing.source = source;
                    if (defVal !== undefined) existing.default = defVal;
                    if (enumArr && enumArr.length > 0) existing.enum = enumArr;
                  } else {
                    this.customFields.set(key, {
                      name,
                      source,
                      required: !!required,
                      default: defVal,
                      enum: enumArr,
                      scopes: [scope]
                    });
                  }
                };

                if (Array.isArray(fObj)) {
                  for (const f of fObj) {
                    if (typeof f === 'string') {
                      registerField(f, undefined, false, undefined, undefined);
                    } else if (f && typeof f === 'object' && f.name) {
                      const rawEnum = f.enum ?? f.values ?? f.options;
                      const enumArr = Array.isArray(rawEnum) ? rawEnum.map(String) : undefined;
                      registerField(f.name, f.source, f.required, f.default, enumArr);
                    }
                  }
                } else if (typeof fObj === 'object') {
                  for (const [k, v] of Object.entries(fObj)) {
                    if (typeof v === 'object' && v !== null) {
                      const vo = v as any;
                      const rawEnum = vo.enum ?? vo.values ?? vo.options;
                      const enumArr = Array.isArray(rawEnum) ? rawEnum.map(String) : undefined;
                      registerField(vo.name ?? k, vo.source, vo.required, vo.default, enumArr);
                    } else {
                      registerField(k, undefined, false, undefined, undefined);
                    }
                  }
                }
              };

              extractFields(parsed.fields, 'global');
              extractFields(resBlock.fields, 'global');
              extractFields(resBlock.global?.fields, 'global');
              extractFields(resBlock.testcase?.fields, 'testcase');
              extractFields(resBlock.testrun?.fields, 'testrun');
              extractFields(resBlock.testplan?.fields, 'testplan');
              extractFields(resBlock.bug?.fields, 'bug');
            } else if (parsed.fields) {
              const extractFields = (fObj: any, scope: 'global' | 'testcase' | 'testrun' | 'testplan' | 'bug' = 'global') => {
                if (!fObj || typeof fObj !== 'object') return;
                for (const [k, v] of Object.entries(fObj)) {
                  if (typeof v === 'object' && v !== null) {
                    const vo = v as any;
                    const rawEnum = vo.enum ?? vo.values ?? vo.options;
                    const enumArr = Array.isArray(rawEnum) ? rawEnum.map(String) : undefined;
                    this.customFields.set(k.toLowerCase(), {
                      name: vo.name ?? k,
                      source: vo.source,
                      required: !!vo.required,
                      default: vo.default,
                      enum: enumArr,
                      scopes: [scope]
                    });
                  }
                }
              };
              extractFields(parsed.fields, 'global');
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
                this.applyResourceBlock(targetRes);
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
                this.parseModulesBlock(moduleObj);
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

  private scanEnvironmentVariables(): void {
    for (const [envKey, envVal] of Object.entries(process.env)) {
      let varName: string | null = null;
      if (envKey.startsWith('TESTFORM_VAR_')) {
        varName = envKey.slice('TESTFORM_VAR_'.length);
      } else if (envKey.startsWith('TF_VAR_')) {
        varName = envKey.slice('TF_VAR_'.length);
      }
      if (varName && envVal !== undefined) {
        const existing = this.config.variables.get(varName);
        this.config.variables.set(varName, {
          name: varName,
          type: existing?.type || 'string',
          description: existing?.description || `Environment variable (${envKey})`,
          defaultValue: envVal,
          sourceFile: `env:${envKey}`,
          line: 0
        });
      }
    }
  }

  public cleanScenarioIndicesForFile(fullPath: string): void {
    const resolvedPath = path.resolve(fullPath);
    for (const [tag, info] of Array.from(this.config.scenarios.entries())) {
      if (path.resolve(info.sourceFile) === resolvedPath) {
        this.config.scenarios.delete(tag);
      }
    }
    for (const [addr, info] of Array.from(this.config.scenarioAddresses.entries())) {
      if (path.resolve(info.sourceFile) === resolvedPath) {
        this.config.scenarioAddresses.delete(addr);
      }
    }
  }

  public indexFeatureContent(fullPath: string, relPath: string, content: string): void {
    const lowerRel = relPath.toLowerCase().replace(/\\/g, '/');
    const lines = content.split(/\r?\n/);

    // 1. Detect root special scope tag: highest priority
    let specialScope: 'testcase' | 'testrun' | 'testplan' | 'bug' | undefined;
    let featureTitle = path.basename(fullPath);

    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      const line = lines[i].trim();
      if (line.includes('@testrun')) specialScope = 'testrun';
      else if (line.includes('@testplan')) specialScope = 'testplan';
      else if (line.includes('@testcase')) specialScope = 'testcase';
      else if (line.includes('@bug')) specialScope = 'bug';

      const featMatch = line.match(/^(?:Feature|Característica):\s*(.+)$/i);
      if (featMatch) {
        featureTitle = featMatch[1].trim();
      }
    }

    // 2. Scope resolution order: Special tag -> Configured match pattern -> Filename -> default
    let fileScope: ResourceScope = specialScope || 'testcase';
    if (!specialScope) {
      if (matchesGlobMatchPattern(relPath, this.config.scopes.testrun) || lowerRel.endsWith('.run.feature')) {
        fileScope = 'testrun';
      } else if (matchesGlobMatchPattern(relPath, this.config.scopes.testplan) || lowerRel.endsWith('.plan.feature')) {
        fileScope = 'testplan';
      } else if (matchesGlobMatchPattern(relPath, this.config.scopes.bug) || lowerRel.endsWith('.bug.feature')) {
        fileScope = 'bug';
      } else if (matchesGlobMatchPattern(relPath, this.config.scopes.testcase) || lowerRel.endsWith('.case.feature')) {
        fileScope = 'testcase';
      }
    }

    // 3. Detect @ns(...) or @namespace(...) or @ns:... (accepts unquoted, single-quoted, or double-quoted)
    const nonCommentContent = lines.map(l => l.replace(/#.*$/, '')).join('\n');
    const nsMatch = nonCommentContent.match(/@(?:ns|namespace)(?:\(\s*['"]?([^'"()\s]+)['"]?\s*\)|\s*:\s*([a-zA-Z0-9_-]+))/i);
    const fileNamespace = (nsMatch ? (nsMatch[1] || nsMatch[2]) : undefined)?.trim().toLowerCase();

    this.featureFiles.set(relPath, {
      relPath,
      fullPath,
      scope: fileScope,
      title: featureTitle,
      namespace: fileNamespace
    });

    // 4. Index individual scenarios and identity tags
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineWithoutDepends = line.replace(/#.*$/, '').replace(/@depends_on\s*\([^)]*\)/gi, '');
      const idMatches = findAllIdentityMatchesInLine(lineWithoutDepends, this.config.identities, fileScope);
      for (const idMatch of idMatches) {
        const matchedScope = idMatch.scope;
        const legacyKey = SCOPE_TO_LEGACY_KEY[matchedScope];
        const idNumber = idMatch.idNumber ?? 0;
        const tag = idMatch.rawTag.toLowerCase();
        const normalizedTag = idMatch.normalizedTag;

        if (idNumber > (this.config.maxIdentityIds[legacyKey] || 0)) {
          this.config.maxIdentityIds[legacyKey] = idNumber;
        }
        if (idNumber > (this.config.maxIdentityByScope[matchedScope] || 0)) {
          this.config.maxIdentityByScope[matchedScope] = idNumber;
        }

        let title = tag;
        let targetLine = i;
        for (let j = i; j < Math.min(lines.length, i + 5); j++) {
          const candidate = lines[j].trim();
          const titleMatch = candidate.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario|Rule|Regla)\s*:\s*(.*)$/i);
          if (titleMatch) {
            title = titleMatch[1].trim() || candidate;
            targetLine = j;
            break;
          }
        }

        const fileNameOnly = path.basename(fullPath);
        const defaultScaffold =
          matchedScope === 'testcase' ? 'testcase' :
          matchedScope === 'testrun' ? 'testruns' :
          matchedScope === 'testplan' ? 'testplans' : 'bugs';
        const scaffoldPrefix = (this.config.scaffoldDirectories?.[matchedScope] || defaultScaffold).replace(/^[\/\\]+|[\/\\]+$/g, '');

        let delimitedRelPath = relPath;
        const lowerPrefix = scaffoldPrefix ? scaffoldPrefix.toLowerCase() + '/' : '';
        if (scaffoldPrefix && lowerRel.startsWith(lowerPrefix)) {
          delimitedRelPath = relPath.substring(scaffoldPrefix.length + 1);
        }

        const delimitedAddress = delimitedRelPath + '.' + tag;
        const namespaceAddress = fileNamespace ? fileNamespace + '.' + fileNameOnly + '.' + tag : undefined;

        const info: ScenarioIdentityInfo = {
          tag,
          normalizedTag,
          idNumber,
          scope: matchedScope,
          title,
          address: relPath + '.' + tag,
          sourceFile: fullPath,
          line: targetLine,
          namespace: fileNamespace,
          delimitedAddress,
          namespaceAddress
        };

        const isPrimaryDeclaration = matchedScope === fileScope;

        if (isPrimaryDeclaration) {
          const existing = findScenarioByIdentityTag(this.config.scenarios, tag, this.config.identities, matchedScope);
          if (existing && path.resolve(existing.sourceFile) !== path.resolve(fullPath)) {
            const list = this.config.duplicateScenarioTags.get(tag) || [
              path.basename(existing.sourceFile) + ':' + (existing.line + 1)
            ];
            list.push(path.basename(fullPath) + ':' + (targetLine + 1));
            this.config.duplicateScenarioTags.set(tag, list);
            if (normalizedTag !== tag) {
              this.config.duplicateScenarioTags.set(normalizedTag, list);
            }
          } else {
            this.config.scenarios.set(tag, info);
          }

          this.config.scenarioAddresses.set(delimitedAddress, info);
          if (namespaceAddress) {
            this.config.scenarioAddresses.set(namespaceAddress, info);
          }
          this.config.scenarioAddresses.set(fileNameOnly + '.' + tag, info);
          this.config.scenarioAddresses.set(info.address, info);

          if (normalizedTag !== tag) {
            this.config.scenarioAddresses.set(delimitedRelPath + '.' + normalizedTag, info);
            if (fileNamespace) {
              this.config.scenarioAddresses.set(fileNamespace + '.' + fileNameOnly + '.' + normalizedTag, info);
            }
            this.config.scenarioAddresses.set(fileNameOnly + '.' + normalizedTag, info);
            this.config.scenarioAddresses.set(relPath + '.' + normalizedTag, info);
          }
        }
      }
    }
  }

  public findFeatureByUri(docUri: string): {
    relPath: string;
    fullPath: string;
    scope: 'testcase' | 'testrun' | 'testplan' | 'bug';
    title: string;
    namespace?: string;
  } | undefined {
    let docFsPath = docUri;
    if (docUri.startsWith('file://')) {
      try {
        docFsPath = fileURLToPath(docUri);
      } catch {
        docFsPath = decodeURIComponent(docUri.replace(/^file:\/\/\/?/i, ''));
      }
    }
    const normDocPath = path.resolve(docFsPath).toLowerCase().replace(/\\/g, '/');
    const normDocUri = decodeURIComponent(docUri).toLowerCase().replace(/\\/g, '/');

    for (const feat of this.featureFiles.values()) {
      const featPath = path.resolve(feat.fullPath).toLowerCase().replace(/\\/g, '/');
      if (normDocPath === featPath || normDocUri.includes(featPath)) {
        return feat;
      }
    }
    return undefined;
  }

  public scanSingleDocument(docUriOrPath: string, fileContent?: string): void {
    let fullPath = docUriOrPath;
    if (fullPath.startsWith('file://')) {
      try {
        fullPath = fileURLToPath(fullPath);
      } catch {
        fullPath = decodeURIComponent(fullPath.replace(/^file:\/\/\/?/i, ''));
      }
    }
    fullPath = path.resolve(fullPath);

    const relPath = path.relative(this.workspaceRoot, fullPath).replace(/\\/g, '/');
    if (relPath.startsWith('..')) {
      return;
    }
    const lowerRel = relPath.toLowerCase();
    if (!lowerRel.endsWith('.feature')) {
      return;
    }

    let content = fileContent;
    if (content === undefined) {
      if (!fs.existsSync(fullPath)) {
        this.featureFiles.delete(relPath);
        this.cleanScenarioIndicesForFile(fullPath);
        return;
      }
      try {
        content = fs.readFileSync(fullPath, 'utf8');
      } catch {
        return;
      }
    }

    this.cleanScenarioIndicesForFile(fullPath);
    this.indexFeatureContent(fullPath, relPath, content);
  }

  private scanFeatureFiles(): void {
    const IGNORED_DIRS = new Set(['node_modules', '.git', '.testform', '.terraform', 'dist', 'coverage', '.system_generated']);

    const walk = (currentDir: string) => {
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
              walk(path.join(currentDir, entry.name));
            }
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.feature')) {
            const fullPath = path.join(currentDir, entry.name);
            const relPath = path.relative(this.workspaceRoot, fullPath).replace(/\\/g, '/');
            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              this.indexFeatureContent(fullPath, relPath, content);
            } catch {}
          }
        }
      } catch {}
    };

    walk(this.workspaceRoot);
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
        for (const [subKey] of Object.entries(val)) {
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

  private parseModulesBlock(block: any): void {
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
