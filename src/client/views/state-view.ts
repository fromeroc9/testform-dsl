import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type StateNodeKind = 'category' | 'resource' | 'cases_group' | 'executed_case' | 'runs_group' | 'associated_run' | 'attribute' | 'output' | 'info';

export class StateTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: StateNodeKind,
    public readonly address?: string,
    public readonly details?: string,
    public readonly childrenNodes?: StateTreeItem[],
    public readonly rawResource?: any,
    public readonly isTainted: boolean = false
  ) {
    super(label, collapsibleState);

    if (details) {
      this.description = details;
    }

    if (kind === 'category') {
      this.contextValue = 'testformCategory';
    } else if (kind === 'resource') {
      this.contextValue = isTainted ? 'testformResourceTainted' : 'testformResource';
      this.tooltip = `Address: ${address}\n${details || ''}`;
      if (address) {
        this.command = {
          command: 'testform.state.inspectResource',
          title: 'Inspect Resource in Editor',
          arguments: [this]
        };
      }
    } else if (kind === 'cases_group') {
      this.contextValue = 'testformCasesGroup';
      this.iconPath = new vscode.ThemeIcon('checklist');
    } else if (kind === 'runs_group') {
      this.contextValue = 'testformRunsGroup';
      this.iconPath = new vscode.ThemeIcon('layers');
    } else if (kind === 'executed_case') {
      this.contextValue = 'testformExecutedCase';
      if (address) {
        this.command = {
          command: 'testform.state.inspectResource',
          title: 'Inspect Resource in Editor',
          arguments: [this]
        };
      }
    } else if (kind === 'associated_run') {
      this.contextValue = 'testformAssociatedRun';
      if (address) {
        this.command = {
          command: 'testform.state.inspectResource',
          title: 'Inspect Resource in Editor',
          arguments: [this]
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

      // Build lookup maps for resolving real names in runs and plans
      const caseTitleMap = new Map<string, string>();
      const runLookupMap = new Map<string, { title: string; issueNumber?: number; status?: string }>();

      for (const r of resources) {
        const id = (r.identity || '').replace(/\\/g, '/').toLowerCase();
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

        // 1.1 In Testrun: Group executed testcases into a dedicated collapsible sub-tree
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

            // Resolve real scenario name
            const scenarioName =
              caseTitleMap.get(normAddr) ||
              caseTitleMap.get(normAddr.replace(/^(?:testcase\/|tests\/)/i, '')) ||
              (tag ? caseTitleMap.get(tag.toLowerCase()) : undefined) ||
              shortAddr;

            const st = String(stVal || 'pending').toLowerCase();
            const caseItem = new StateTreeItem(
              scenarioName,
              vscode.TreeItemCollapsibleState.None,
              'executed_case',
              shortAddr,
              tag ? `[${st.toUpperCase()}] ${tag}` : `[${st.toUpperCase()}]`
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

        // 1.2 In Testplan: Group associated testruns into a dedicated collapsible sub-tree
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
              runRemote ? `[${runStatus.toUpperCase()}] ${runRemote}` : `[${runStatus.toUpperCase()}]`
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

        const resItem = new StateTreeItem(
          title,
          vscode.TreeItemCollapsibleState.Collapsed,
          'resource',
          identity,
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
