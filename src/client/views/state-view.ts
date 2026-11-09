import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type StateNodeKind =
  | 'category'
  | 'resource'
  | 'cases_group'
  | 'executed_case'
  | 'runs_group'
  | 'associated_run'
  | 'attribute'
  | 'output'
  | 'file'
  | 'rule'
  | 'scenario'
  | 'bug'
  | 'info';

export class StateTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: StateNodeKind,
    public readonly address?: string,
    public readonly details?: string,
    public readonly childrenNodes?: StateTreeItem[],
    public readonly rawResource?: any,
    public readonly isTainted: boolean = false,
    public readonly fsPath?: string,
    public readonly line?: number
  ) {
    super(label, collapsibleState);

    if (details) {
      this.description = details;
    }

    if (fsPath && line !== undefined) {
      this.command = {
        command: 'vscode.open',
        title: 'Open Specification',
        arguments: [
          vscode.Uri.file(fsPath),
          { selection: new vscode.Range(line, 0, line, 0) }
        ]
      };
    } else if (fsPath) {
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [vscode.Uri.file(fsPath)]
      };
    } else if (address) {
      this.command = {
        command: 'testform.state.inspectResource',
        title: 'Inspect Resource in Editor',
        arguments: [this]
      };
    }

    switch (kind) {
      case 'category':
        this.contextValue = 'testformCategory';
        break;
      case 'resource':
        this.contextValue = isTainted ? 'testformResourceTainted' : 'testformResource';
        this.tooltip = `Address: ${address}\n${details || ''}`;
        break;
      case 'cases_group':
        this.contextValue = 'testformCasesGroup';
        this.iconPath = new vscode.ThemeIcon('checklist');
        break;
      case 'runs_group':
        this.contextValue = 'testformRunsGroup';
        this.iconPath = new vscode.ThemeIcon('layers');
        break;
      case 'executed_case':
        this.contextValue = 'testformExecutedCase';
        break;
      case 'associated_run':
        this.contextValue = 'testformAssociatedRun';
        break;
      case 'output':
        this.contextValue = 'testformOutput';
        this.iconPath = new vscode.ThemeIcon('symbol-variable');
        break;
      case 'attribute':
        this.contextValue = 'testformAttribute';
        this.iconPath = new vscode.ThemeIcon('tag');
        break;
      case 'file':
        this.contextValue = 'testformFeatureFile';
        this.iconPath = new vscode.ThemeIcon('file-code');
        this.tooltip = fsPath;
        break;
      case 'rule':
        this.contextValue = 'testformFeatureRule';
        this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        break;
      case 'scenario':
        this.contextValue = 'testformFeatureScenario';
        this.iconPath = new vscode.ThemeIcon('symbol-method');
        break;
      case 'bug':
        this.contextValue = 'testformFeatureBug';
        this.iconPath = new vscode.ThemeIcon('bug', new vscode.ThemeColor('charts.red'));
        break;
      default:
        this.iconPath = new vscode.ThemeIcon('info');
        break;
    }
  }
}

export class StateTreeProvider implements vscode.TreeDataProvider<StateTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<StateTreeItem | undefined | null | void> =
    new vscode.EventEmitter<StateTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<StateTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private mode: 'state' | 'files' = 'state';
  private stateMeta: { version: number; serial: number } | null = null;
  private filterQuery: string = '';

  public setFilter(query: string): void {
    this.filterQuery = (query || '').trim().toLowerCase();
    this.refresh();
  }

  public clearFilter(): void {
    this.filterQuery = '';
    this.refresh();
  }

  public getFilter(): string {
    return this.filterQuery;
  }

  public getStateMeta(): { version: number; serial: number } | null {
    return this.stateMeta;
  }

  public getMode(): 'state' | 'files' {
    return this.mode;
  }

  public setMode(mode: 'state' | 'files'): void {
    if (this.mode !== mode) {
      this.mode = mode;
      this.refresh();
    }
  }

  public toggleMode(): 'state' | 'files' {
    this.mode = this.mode === 'state' ? 'files' : 'state';
    this.refresh();
    return this.mode;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: StateTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: StateTreeItem): Promise<StateTreeItem[]> {
    if (element) {
      return element.childrenNodes || [];
    }

    if (this.mode === 'files') {
      return this.getFilesChildren();
    }

    return this.getStateChildren();
  }

  // ─── STATE MODE: testform.state ──────────────────────────────────────────
  private async getStateChildren(): Promise<StateTreeItem[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [new StateTreeItem('No workspace open', vscode.TreeItemCollapsibleState.None, 'info')];
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const stateCandidates = [
      path.join(rootPath, 'testform.state'),
      path.join(rootPath, '.testform', 'testform.state')
    ];
    const statePath = stateCandidates.find(p => fs.existsSync(p));

    if (!statePath) {
      const item = new StateTreeItem('No state file found (run testform apply or testform plan)', vscode.TreeItemCollapsibleState.None, 'info');
      item.iconPath = new vscode.ThemeIcon('info');
      return [item];
    }

    try {
      const content = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(content);
      const resources: any[] = parsed.resources || [];
      const outputs: Record<string, any> = parsed.outputs || {};

      if (resources.length === 0 && Object.keys(outputs).length === 0) {
        return [
          new StateTreeItem('Empty state (0 managed resources)', vscode.TreeItemCollapsibleState.None, 'info')
        ];
      }

      const caseTitleMap = new Map<string, string>();
      const runLookupMap = new Map<string, { title: string; issueNumber?: number; status?: string }>();

      for (const r of resources) {
        const id = (r.address || r.identity || '').replace(/\\/g, '/').toLowerCase();
        const type = r.type || '';
        const title = r.attributes?.title;

        if (type.includes('testcase') && id && title) {
          caseTitleMap.set(id, title);
          const cleanNoScope = id.replace(/^(?:testcase\/|tests\/)/i, '');
          caseTitleMap.set(cleanNoScope, title);
          const tagMatch = id.match(/@(tc|tr|tp)-[0-9]+/i);
          if (tagMatch) {
            caseTitleMap.set(tagMatch[0].toLowerCase(), title);
          }
          const baseName = id.split('/').pop() || id;
          caseTitleMap.set(baseName, title);
        } else if (type.includes('testrun') && id) {
          const runInfo = {
            title: title || id,
            issueNumber: r.attributes?.issueNumber,
            status: r.attributes?.status || 'pending'
          };
          runLookupMap.set(id, runInfo);
          const cleanNoScope = id.replace(/^(?:testcycle\/|testrun\/|testruns\/)/i, '');
          runLookupMap.set(cleanNoScope, runInfo);
          const baseName = id.split('/').pop() || id;
          runLookupMap.set(baseName, runInfo);
          const tagMatch = id.match(/@tr-[0-9]+/i);
          if (tagMatch) {
            runLookupMap.set(tagMatch[0].toLowerCase(), runInfo);
          }
        }
      }

      const testruns: StateTreeItem[] = [];
      const testcases: StateTreeItem[] = [];
      const testplans: StateTreeItem[] = [];
      const bugs: StateTreeItem[] = [];
      const outputItems: StateTreeItem[] = [];

      let activeResources = resources;
      if (this.filterQuery) {
        const q = this.filterQuery;
        activeResources = resources.filter((r: any) => {
          const addr = (r.address || r.identity || '').toLowerCase();
          const phys = (r.physicalAddress || '').toLowerCase();
          const tag = (r.tag || '').toLowerCase();
          const type = (r.type || '').toLowerCase();
          const title = (r.attributes?.title || '').toLowerCase();
          const status = (r.attributes?.status || '').toLowerCase();
          const issue = String(r.attributes?.issueNumber || '').toLowerCase();
          return addr.includes(q) || phys.includes(q) || tag.includes(q) || type.includes(q) || title.includes(q) || status.includes(q) || issue.includes(q);
        });

        if (activeResources.length === 0) {
          const emptyItem = new StateTreeItem(
            `No resources match "${this.filterQuery}" (Click to clear)`,
            vscode.TreeItemCollapsibleState.None,
            'info'
          );
          emptyItem.command = {
            command: 'testform.clearStateFilter',
            title: 'Clear Filter'
          };
          emptyItem.iconPath = new vscode.ThemeIcon('clear-all');
          return [emptyItem];
        }
      }

      for (const r of activeResources) {
        const type: string = r.type || '';
        const address: string = (r.address || r.identity || '').replace(/\\/g, '/');
        const attrs = r.attributes || {};
        const title: string = attrs.title || address || type;
        const remoteRef = attrs.remoteId || (attrs.issueNumber ? `#${attrs.issueNumber}` : '');
        const isTainted = !!r.tainted;

        const childNodes: StateTreeItem[] = [];

        // Group executed testcases inside testrun
        const rawCases = attrs.testcases || attrs.testcaseStatuses;
        if (rawCases) {
          const executedCaseNodes: StateTreeItem[] = [];
          const entries: [string, any][] = Array.isArray(rawCases)
            ? rawCases.map((tc: any) => [typeof tc === 'string' ? tc : tc.identity || '', tc.status || 'pending'])
            : Object.entries(rawCases);

          for (const [tcAddr, stVal] of entries) {
            if (!tcAddr) continue;
            const shortAddr = tcAddr.replace(/\\/g, '/');
            const normAddr = shortAddr.toLowerCase();
            const tagMatch = shortAddr.match(/@(tc|tr|tp)-[0-9]+/i);
            const tag = tagMatch ? tagMatch[0] : '';

            const scenarioName =
              caseTitleMap.get(normAddr) ||
              caseTitleMap.get(normAddr.replace(/^(?:testcase\/|tests\/)/i, '')) ||
              (tag ? caseTitleMap.get(tag.toLowerCase()) : undefined) ||
              shortAddr;

            const st = String(stVal || 'pending').toLowerCase();
            const caseChildNodes: StateTreeItem[] = [];
            caseChildNodes.push(new StateTreeItem(`Status: ${st}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
            caseChildNodes.push(new StateTreeItem(`Address: ${shortAddr}`, vscode.TreeItemCollapsibleState.None, 'attribute', shortAddr));

            const matchedTc = resources.find(r => {
              const rIdent = (r.identity || '').replace(/\\/g, '/').toLowerCase();
              if (rIdent === normAddr) return true;
              if (tag && rIdent.includes(tag.toLowerCase())) return true;
              return false;
            });

            if (matchedTc && matchedTc.attributes) {
              const customFields = matchedTc.attributes.custom_fields || matchedTc.attributes.fields;
              if (customFields && typeof customFields === 'object') {
                for (const [cfKey, cfVal] of Object.entries(customFields)) {
                  caseChildNodes.push(new StateTreeItem(`${cfKey}: ${cfVal}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
                }
              }
              if (matchedTc.attributes.labels && Array.isArray(matchedTc.attributes.labels)) {
                caseChildNodes.push(new StateTreeItem(`Labels: ${matchedTc.attributes.labels.join(', ')}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
              }
            }

            const caseItem = new StateTreeItem(
              scenarioName,
              caseChildNodes.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
              'executed_case',
              shortAddr,
              tag || undefined,
              caseChildNodes
            );

            caseItem.tooltip = `Scenario: ${scenarioName}\nAddress: ${shortAddr}\nStatus: ${st}`;

            if (st === 'passed') {
              caseItem.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
            } else if (st === 'failed') {
              caseItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            } else if (st === 'pending') {
              caseItem.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconQueued'));
            } else if (st === 'blocked') {
              caseItem.iconPath = new vscode.ThemeIcon('stop', new vscode.ThemeColor('testing.iconErrored'));
            } else if (st === 'skipped') {
              caseItem.iconPath = new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('testing.iconSkipped'));
            } else {
              caseItem.iconPath = new vscode.ThemeIcon('circle-outline');
            }

            executedCaseNodes.push(caseItem);
          }

          if (executedCaseNodes.length > 0) {
            const casesGroup = new StateTreeItem(
              `Executed Cases (${executedCaseNodes.length})`,
              vscode.TreeItemCollapsibleState.Expanded,
              'cases_group',
              undefined,
              undefined,
              executedCaseNodes
            );
            casesGroup.iconPath = new vscode.ThemeIcon('checklist');
            childNodes.push(casesGroup);
          }
        }

        // Group associated testruns inside testplan
        const rawRuns = attrs.testruns;
        if (rawRuns) {
          const runNodes: StateTreeItem[] = [];
          const runEntries: [string, any][] = Array.isArray(rawRuns)
            ? rawRuns.map((tr: any) => [typeof tr === 'string' ? tr : tr.identity || '', tr.status || 'pending'])
            : Object.entries(rawRuns);

          for (const [trAddr, stVal] of runEntries) {
            if (!trAddr) continue;
            const normTr = trAddr.replace(/\\/g, '/').toLowerCase();
            const lookup = runLookupMap.get(normTr) ||
              runLookupMap.get(normTr.replace(/^(?:testcycle\/|testrun\/|testruns\/)/i, '')) ||
              runLookupMap.get(normTr.split('/').pop() || normTr);

            const runTitle = lookup?.title || trAddr;
            const runStatus = String(lookup?.status || stVal || 'pending').toLowerCase();
            const runRemote = lookup?.issueNumber ? `#${lookup.issueNumber}` : '';

            const runItem = new StateTreeItem(
              runTitle,
              vscode.TreeItemCollapsibleState.None,
              'associated_run',
              trAddr,
              runRemote || undefined
            );

            runItem.tooltip = `Test Run: ${runTitle}\nAddress: ${trAddr}\nStatus: ${runStatus}`;

            if (runStatus === 'passed') {
              runItem.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
            } else if (runStatus === 'failed') {
              runItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            } else {
              runItem.iconPath = new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green'));
            }

            runNodes.push(runItem);
          }

          if (runNodes.length > 0) {
            const runsGroup = new StateTreeItem(
              `Associated Test Runs (${runNodes.length})`,
              vscode.TreeItemCollapsibleState.Expanded,
              'runs_group',
              undefined,
              undefined,
              runNodes
            );
            runsGroup.iconPath = new vscode.ThemeIcon('layers');
            childNodes.push(runsGroup);
          }
        }

        childNodes.push(new StateTreeItem(`Address: ${address}`, vscode.TreeItemCollapsibleState.None, 'attribute', address));
        if (r.path) {
          childNodes.push(new StateTreeItem(`Path: ${r.path}`, vscode.TreeItemCollapsibleState.None, 'attribute', r.path));
        }
        if (r.tag) {
          childNodes.push(new StateTreeItem(`Tag: ${r.tag}`, vscode.TreeItemCollapsibleState.None, 'attribute', r.tag));
        }
        if (r.namespace) {
          childNodes.push(new StateTreeItem(`Namespace: ${r.namespace}`, vscode.TreeItemCollapsibleState.None, 'attribute', r.namespace));
        }
        if (remoteRef) {
          childNodes.push(new StateTreeItem(`Remote: ${remoteRef}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
        }
        const targetVal = attrs.target || attrs.execution?.target;
        if (targetVal) {
          childNodes.push(new StateTreeItem(`Target: ${targetVal}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
        }
        const statusVal = attrs.status || attrs.execution?.status;
        if (statusVal) {
          childNodes.push(new StateTreeItem(`Status: ${statusVal}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
        }
        const customFields = attrs.custom_fields || attrs.fields;
        if (customFields && typeof customFields === 'object') {
          for (const [cfKey, cfVal] of Object.entries(customFields)) {
            childNodes.push(new StateTreeItem(`${cfKey}: ${cfVal}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
          }
        }
        const traceVal = attrs.trace || attrs.execution?.trace;
        if (traceVal) {
          childNodes.push(new StateTreeItem(`Trace: ${traceVal}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
        }
        const evidenceVal = attrs.evidence || attrs.execution?.evidence;
        if (evidenceVal) {
          childNodes.push(new StateTreeItem(`Evidence: ${evidenceVal}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
        }
        if (attrs.labels && Array.isArray(attrs.labels)) {
          childNodes.push(new StateTreeItem(`Labels: ${attrs.labels.join(', ')}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
        }
        if (r.lastApplied) {
          childNodes.push(new StateTreeItem(`Last Applied: ${r.lastApplied}`, vscode.TreeItemCollapsibleState.None, 'attribute'));
        }

        const resItem = new StateTreeItem(
          title,
          vscode.TreeItemCollapsibleState.Collapsed,
          'resource',
          address,
          remoteRef || '',
          childNodes,
          r,
          isTainted
        );

        if (isTainted) {
          resItem.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
        } else if (type.includes('testrun')) {
          resItem.iconPath = new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green'));
          testruns.push(resItem);
        } else if (type.includes('testplan')) {
          resItem.iconPath = new vscode.ThemeIcon('notebook', new vscode.ThemeColor('charts.blue'));
          testplans.push(resItem);
        } else if (type.includes('bug')) {
          resItem.iconPath = new vscode.ThemeIcon('bug', new vscode.ThemeColor('charts.red'));
          bugs.push(resItem);
        } else {
          resItem.iconPath = new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.purple'));
          testcases.push(resItem);
        }
      }

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

      const categories: StateTreeItem[] = [];
      this.stateMeta = { version: parsed.version || 1, serial: parsed.serial ?? 1 };

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

      if (bugs.length > 0) {
        const cat = new StateTreeItem(`Bugs & Defects (${bugs.length})`, vscode.TreeItemCollapsibleState.Expanded, 'category', undefined, undefined, bugs);
        cat.iconPath = new vscode.ThemeIcon('bug');
        categories.push(cat);
      }

      if (outputItems.length > 0) {
        const cat = new StateTreeItem(`Outputs (${outputItems.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'category', undefined, undefined, outputItems);
        cat.iconPath = new vscode.ThemeIcon('symbol-variable');
        categories.push(cat);
      }

      return categories;
    } catch (err: any) {
      const item = new StateTreeItem(`Error reading state: ${err.message}`, vscode.TreeItemCollapsibleState.None, 'info');
      item.iconPath = new vscode.ThemeIcon('error');
      return [item];
    }
  }

  // ─── FILES MODE: Workspace .feature files ────────────────────────────────
  private async getFilesChildren(): Promise<StateTreeItem[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [new StateTreeItem('No workspace open', vscode.TreeItemCollapsibleState.None, 'info')];
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const uris = await vscode.workspace.findFiles('**/*.feature', '{**/node_modules/**,**/.git/**}');

    if (uris.length === 0) {
      return [new StateTreeItem('No .feature files found', vscode.TreeItemCollapsibleState.None, 'info')];
    }

    const testcaseFiles: StateTreeItem[] = [];
    const testrunFiles: StateTreeItem[] = [];
    const testplanFiles: StateTreeItem[] = [];
    const bugFiles: StateTreeItem[] = [];
    let totalScenarios = 0;

    const stateResourceMap = new Map<string, any>();
    const statePathCandidates = [
      path.join(rootPath, 'testform.state'),
      path.join(rootPath, '.testform', 'testform.state')
    ];
    for (const sp of statePathCandidates) {
      if (fs.existsSync(sp)) {
        try {
          const raw = fs.readFileSync(sp, 'utf8');
          const parsed = JSON.parse(raw);
          const resources = parsed.resources || [];
          for (const r of resources) {
            const ident = (r.address || r.identity || '').replace(/\\/g, '/');
            stateResourceMap.set(ident.toLowerCase(), r);
            const baseIdent = ident.split('/').pop() || ident;
            stateResourceMap.set(baseIdent.toLowerCase(), r);
            const tagMatch = ident.match(/@(tc|tr|tp|bg)-[0-9]+/i);
            if (tagMatch) {
              stateResourceMap.set(tagMatch[0].toLowerCase(), r);
            }
          }
          break;
        } catch {}
      }
    }

    const extractScenarioFields = (linesArr: string[], startLine: number) => {
      const fields: Record<string, string> = {};
      let markStatus: string | undefined;
      let markTarget: string | undefined;
      let markTrace: string | undefined;
      let markEvidence: string | undefined;

      for (let k = startLine + 1; k < linesArr.length; k++) {
        const stepLine = linesArr[k].trim();
        if (!stepLine || stepLine.startsWith('#')) continue;
        if (/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario|Rule|Regla|Feature|Característica):/i.test(stepLine)) {
          break;
        }
        const markMatch = stepLine.match(/^(?:\*\s*)?set\s+([a-zA-Z0-9_-]+)\s*=\s*(.*)$/i);
        if (markMatch) {
          const mKey = markMatch[1].toLowerCase();
          const mVal = markMatch[2].trim().replace(/^["']|["']$/g, '');
          if (mKey === 'status') markStatus = mVal;
          else if (mKey === 'target') markTarget = mVal;
          else if (mKey === 'trace') markTrace = mVal;
          else if (mKey === 'evidence') markEvidence = mVal;
          else fields[mKey] = mVal;
          continue;
        }
        const fieldMatch = stepLine.match(/^(?:\*\s*)?field\s+([a-zA-Z0-9_-]+)\s*=\s*(.*)$/i);
        if (fieldMatch) {
          const fKey = fieldMatch[1].trim();
          const fVal = fieldMatch[2].trim().replace(/^["']|["']$/g, '');
          fields[fKey] = fVal;
          continue;
        }
      }

      return { fields, markStatus, markTarget, markTrace, markEvidence };
    };

    const extractPrecedingTags = (linesArr: string[], scenarioLine: number) => {
      let tag: string | undefined;
      const tagFields: Record<string, string> = {};
      const labels: string[] = [];

      for (let j = scenarioLine - 1; j >= 0; j--) {
        const prev = linesArr[j].trim();
        if (!prev.startsWith('@')) break;
        const tokens = prev.split(/\s+/).filter(t => t.startsWith('@'));
        for (const tok of tokens) {
          const tagMatch = tok.match(/^@(tc|tr|tp|bg)-\w+/i);
          if (tagMatch && !tag) {
            tag = tagMatch[0];
          } else if (tok.toLowerCase() !== '@testcase' && tok.toLowerCase() !== '@testrun' && tok.toLowerCase() !== '@testplan' && tok.toLowerCase() !== '@bug') {
            const eqIdx = tok.indexOf('=');
            if (eqIdx > 1) {
              const k = tok.slice(1, eqIdx);
              const v = tok.slice(eqIdx + 1);
              tagFields[k] = v;
            } else {
              labels.push(tok);
            }
          }
        }
      }

      return { tag, tagFields, labels };
    };

    for (const uri of uris) {
      const fsPath = uri.fsPath;
      const relPath = path.relative(rootPath, fsPath).replace(/\\/g, '/');
      const lower = relPath.toLowerCase();

      try {
        const content = fs.readFileSync(fsPath, 'utf8');
        const lines = content.split(/\r?\n/);

        let scope: 'testcase' | 'testrun' | 'testplan' | 'bug' = 'testcase';
        if (lower.includes('.run.feature') || lower.includes('/testrun/')) {
          scope = 'testrun';
        } else if (lower.includes('.plan.feature') || lower.includes('/testplan/')) {
          scope = 'testplan';
        } else if (lower.includes('.bug.feature') || lower.includes('/bugs/') || lower.includes('/defects/')) {
          scope = 'bug';
        } else {
          for (let i = 0; i < Math.min(lines.length, 15); i++) {
            const line = lines[i].trim().toLowerCase();
            if (line.includes('@testrun')) {
              scope = 'testrun';
              break;
            }
            if (line.includes('@testplan')) {
              scope = 'testplan';
              break;
            }
            if (line.includes('@bug')) {
              scope = 'bug';
              break;
            }
          }
        }

        let featureTitle = path.basename(fsPath, '.feature');
        let featureLine = 0;

        for (let i = 0; i < Math.min(lines.length, 30); i++) {
          const match = lines[i].match(/^(?:Feature|Característica):\s*(.+)$/i);
          if (match) {
            featureTitle = match[1].trim();
            featureLine = i;
            break;
          }
        }

        if (scope === 'testcase') {
          const scenarioItems: StateTreeItem[] = [];
          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('#')) continue;

            const scMatch = trimmed.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.+)$/i);
            if (scMatch) {
              const scTitle = scMatch[1].trim();
              const { tag, tagFields, labels } = extractPrecedingTags(lines, i);
              const { fields, markStatus, markTarget, markTrace, markEvidence } = extractScenarioFields(lines, i);

              const mergedFields = { ...tagFields, ...fields };
              const scAddress = tag ? `${relPath}.${tag}` : relPath;
              const normScAddress = scAddress.toLowerCase();
              const stateRes = stateResourceMap.get(normScAddress) || (tag ? stateResourceMap.get(tag.toLowerCase()) : undefined);

              if (stateRes?.attributes) {
                const sf = stateRes.attributes.custom_fields || stateRes.attributes.fields;
                if (sf && typeof sf === 'object') {
                  for (const [k, v] of Object.entries(sf)) {
                    if (mergedFields[k] === undefined && v !== undefined && v !== null) {
                      mergedFields[k] = String(v);
                    }
                  }
                }
              }

              const childNodes: StateTreeItem[] = [];
              childNodes.push(new StateTreeItem(`Address: ${scAddress}`, vscode.TreeItemCollapsibleState.None, 'attribute', scAddress));

              if (stateRes) {
                const remoteRef = stateRes.attributes?.remoteId || (stateRes.attributes?.issueNumber ? `#${stateRes.attributes?.issueNumber}` : '');
                if (remoteRef) {
                  childNodes.push(new StateTreeItem(`Remote: ${remoteRef}`, vscode.TreeItemCollapsibleState.None, 'attribute', remoteRef));
                }
              }

              const targetVal = markTarget || stateRes?.attributes?.target;
              if (targetVal) {
                childNodes.push(new StateTreeItem(`Target: ${targetVal}`, vscode.TreeItemCollapsibleState.None, 'attribute', targetVal));
              }

              const statusVal = markStatus || stateRes?.attributes?.status;
              if (statusVal) {
                childNodes.push(new StateTreeItem(`Status: ${statusVal}`, vscode.TreeItemCollapsibleState.None, 'attribute', statusVal));
              }

              for (const [k, v] of Object.entries(mergedFields)) {
                childNodes.push(new StateTreeItem(`${k}: ${v}`, vscode.TreeItemCollapsibleState.None, 'attribute', v));
              }

              const traceVal = markTrace || stateRes?.attributes?.trace;
              if (traceVal) {
                childNodes.push(new StateTreeItem(`Trace: ${traceVal}`, vscode.TreeItemCollapsibleState.None, 'attribute', traceVal));
              }

              const evidenceVal = markEvidence || stateRes?.attributes?.evidence;
              if (evidenceVal) {
                childNodes.push(new StateTreeItem(`Evidence: ${evidenceVal}`, vscode.TreeItemCollapsibleState.None, 'attribute', evidenceVal));
              }

              if (labels.length > 0) {
                childNodes.push(new StateTreeItem(`Labels: ${labels.join(', ')}`, vscode.TreeItemCollapsibleState.None, 'attribute', labels.join(', ')));
              }

              const scItem = new StateTreeItem(
                scTitle,
                childNodes.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                'scenario',
                scAddress,
                tag || (statusVal ? `(${statusVal})` : undefined),
                childNodes,
                stateRes,
                false,
                fsPath,
                i
              );

              if (statusVal === 'passed') {
                scItem.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
              } else if (statusVal === 'failed') {
                scItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
              } else if (statusVal === 'pending') {
                scItem.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconQueued'));
              } else if (statusVal === 'blocked') {
                scItem.iconPath = new vscode.ThemeIcon('stop', new vscode.ThemeColor('testing.iconErrored'));
              } else {
                scItem.iconPath = new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.purple'));
              }

              scenarioItems.push(scItem);
              totalScenarios++;
            }
          }

          const fileItem = new StateTreeItem(
            path.basename(fsPath),
            vscode.TreeItemCollapsibleState.Collapsed,
            'file',
            undefined,
            `${scenarioItems.length} scenario${scenarioItems.length !== 1 ? 's' : ''}`,
            scenarioItems,
            undefined,
            false,
            fsPath,
            featureLine
          );
          fileItem.tooltip = `${relPath}\n${featureTitle}`;
          testcaseFiles.push(fileItem);
        } else if (scope === 'testrun') {
          const ruleItems: StateTreeItem[] = [];
          let currentRule: { title: string; line: number; scenarios: StateTreeItem[] } | null = null;

          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('#')) continue;

            const ruleMatch = trimmed.match(/^(?:Rule|Regla):\s*(.+)$/i);
            if (ruleMatch) {
              const ruleScenarios: StateTreeItem[] = [];
              currentRule = { title: ruleMatch[1].trim(), line: i, scenarios: ruleScenarios };
              const rItem = new StateTreeItem(
                currentRule.title,
                vscode.TreeItemCollapsibleState.Expanded,
                'rule',
                undefined,
                undefined,
                ruleScenarios,
                undefined,
                false,
                fsPath,
                i
              );
              ruleItems.push(rItem);
              continue;
            }

            const scMatch = trimmed.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.+)$/i);
            if (scMatch) {
              const scTitle = scMatch[1].trim();
              const scAddress = currentRule ? `${currentRule.title}.${scTitle}` : `${relPath}.${scTitle}`;
              const { fields, markStatus, markTarget, markTrace, markEvidence } = extractScenarioFields(lines, i);

              const childNodes: StateTreeItem[] = [];
              childNodes.push(new StateTreeItem(`Address: ${scAddress}`, vscode.TreeItemCollapsibleState.None, 'attribute', scAddress));

              if (markTarget) {
                childNodes.push(new StateTreeItem(`Target: ${markTarget}`, vscode.TreeItemCollapsibleState.None, 'attribute', markTarget));
              }
              if (markStatus) {
                childNodes.push(new StateTreeItem(`Status: ${markStatus}`, vscode.TreeItemCollapsibleState.None, 'attribute', markStatus));
              }
              for (const [k, v] of Object.entries(fields)) {
                childNodes.push(new StateTreeItem(`${k}: ${v}`, vscode.TreeItemCollapsibleState.None, 'attribute', v));
              }
              if (markTrace) {
                childNodes.push(new StateTreeItem(`Trace: ${markTrace}`, vscode.TreeItemCollapsibleState.None, 'attribute', markTrace));
              }
              if (markEvidence) {
                childNodes.push(new StateTreeItem(`Evidence: ${markEvidence}`, vscode.TreeItemCollapsibleState.None, 'attribute', markEvidence));
              }

              const scItem = new StateTreeItem(
                scTitle,
                childNodes.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                'scenario',
                scAddress,
                markStatus ? `(${markStatus})` : undefined,
                childNodes,
                undefined,
                false,
                fsPath,
                i
              );

              if (markStatus === 'passed') {
                scItem.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
              } else if (markStatus === 'failed') {
                scItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
              } else {
                scItem.iconPath = new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green'));
              }

              if (currentRule) {
                currentRule.scenarios.push(scItem);
              } else {
                ruleItems.push(scItem);
              }
            }
          }

          const fileItem = new StateTreeItem(
            path.basename(fsPath),
            vscode.TreeItemCollapsibleState.Collapsed,
            'file',
            undefined,
            featureTitle,
            ruleItems,
            undefined,
            false,
            fsPath,
            featureLine
          );
          fileItem.iconPath = new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green'));
          testrunFiles.push(fileItem);
        } else if (scope === 'testplan') {
          const ruleItems: StateTreeItem[] = [];
          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('#')) continue;

            const ruleMatch = trimmed.match(/^(?:Rule|Regla):\s*(.+)$/i);
            if (ruleMatch) {
              const rTitle = ruleMatch[1].trim();
              ruleItems.push(new StateTreeItem(
                rTitle,
                vscode.TreeItemCollapsibleState.None,
                'rule',
                undefined,
                undefined,
                undefined,
                undefined,
                false,
                fsPath,
                i
              ));
            }
          }

          const fileItem = new StateTreeItem(
            path.basename(fsPath),
            vscode.TreeItemCollapsibleState.Collapsed,
            'file',
            undefined,
            featureTitle,
            ruleItems,
            undefined,
            false,
            fsPath,
            featureLine
          );
          fileItem.iconPath = new vscode.ThemeIcon('notebook', new vscode.ThemeColor('charts.blue'));
          testplanFiles.push(fileItem);
        } else if (scope === 'bug') {
          const bugItems: StateTreeItem[] = [];
          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('#')) continue;

            const scMatch = trimmed.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.+)$/i);
            if (scMatch) {
              const scTitle = scMatch[1].trim();
              const { tag, tagFields, labels } = extractPrecedingTags(lines, i);
              const { fields, markStatus, markTarget, markTrace, markEvidence } = extractScenarioFields(lines, i);
              const mergedFields = { ...tagFields, ...fields };
              const scAddress = tag ? `${relPath}.${tag}` : relPath;

              const childNodes: StateTreeItem[] = [];
              childNodes.push(new StateTreeItem(`Address: ${scAddress}`, vscode.TreeItemCollapsibleState.None, 'attribute', scAddress));

              if (markTarget) {
                childNodes.push(new StateTreeItem(`Target: ${markTarget}`, vscode.TreeItemCollapsibleState.None, 'attribute', markTarget));
              }
              if (markStatus) {
                childNodes.push(new StateTreeItem(`Status: ${markStatus}`, vscode.TreeItemCollapsibleState.None, 'attribute', markStatus));
              }
              for (const [k, v] of Object.entries(mergedFields)) {
                childNodes.push(new StateTreeItem(`${k}: ${v}`, vscode.TreeItemCollapsibleState.None, 'attribute', v));
              }
              if (markTrace) {
                childNodes.push(new StateTreeItem(`Trace: ${markTrace}`, vscode.TreeItemCollapsibleState.None, 'attribute', markTrace));
              }
              if (markEvidence) {
                childNodes.push(new StateTreeItem(`Evidence: ${markEvidence}`, vscode.TreeItemCollapsibleState.None, 'attribute', markEvidence));
              }
              if (labels.length > 0) {
                childNodes.push(new StateTreeItem(`Labels: ${labels.join(', ')}`, vscode.TreeItemCollapsibleState.None, 'attribute', labels.join(', ')));
              }

              const bugItem = new StateTreeItem(
                scTitle,
                childNodes.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                'bug',
                scAddress,
                tag,
                childNodes,
                undefined,
                false,
                fsPath,
                i
              );
              bugItems.push(bugItem);
            }
          }

          const fileItem = new StateTreeItem(
            path.basename(fsPath),
            vscode.TreeItemCollapsibleState.Collapsed,
            'file',
            undefined,
            featureTitle,
            bugItems,
            undefined,
            false,
            fsPath,
            featureLine
          );
          fileItem.iconPath = new vscode.ThemeIcon('bug', new vscode.ThemeColor('charts.red'));
          bugFiles.push(fileItem);
        }
      } catch {}
    }

    testcaseFiles.sort((a, b) => a.label.localeCompare(b.label));
    testrunFiles.sort((a, b) => a.label.localeCompare(b.label));
    testplanFiles.sort((a, b) => a.label.localeCompare(b.label));
    bugFiles.sort((a, b) => a.label.localeCompare(b.label));

    const categories: StateTreeItem[] = [];

    if (testcaseFiles.length > 0) {
      const cat = new StateTreeItem(
        `Test Cases (${testcaseFiles.length} files, ${totalScenarios} scenarios)`,
        vscode.TreeItemCollapsibleState.Expanded,
        'category',
        undefined,
        undefined,
        testcaseFiles
      );
      cat.iconPath = new vscode.ThemeIcon('beaker');
      categories.push(cat);
    }

    if (testrunFiles.length > 0) {
      const cat = new StateTreeItem(
        `Test Runs (${testrunFiles.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'category',
        undefined,
        undefined,
        testrunFiles
      );
      cat.iconPath = new vscode.ThemeIcon('play-circle');
      categories.push(cat);
    }

    if (testplanFiles.length > 0) {
      const cat = new StateTreeItem(
        `Test Plans (${testplanFiles.length})`,
        vscode.TreeItemCollapsibleState.Collapsed,
        'category',
        undefined,
        undefined,
        testplanFiles
      );
      cat.iconPath = new vscode.ThemeIcon('notebook');
      categories.push(cat);
    }

    if (bugFiles.length > 0) {
      const cat = new StateTreeItem(
        `Bugs (${bugFiles.length})`,
        vscode.TreeItemCollapsibleState.Collapsed,
        'category',
        undefined,
        undefined,
        bugFiles
      );
      cat.iconPath = new vscode.ThemeIcon('bug');
      categories.push(cat);
    }

    return categories;
  }
}
