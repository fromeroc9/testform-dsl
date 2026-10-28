import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type SpecNodeKind = 'category' | 'file' | 'rule' | 'scenario';

export class SpecTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: SpecNodeKind,
    public readonly scopeType?: 'testcase' | 'testrun' | 'testplan',
    public readonly fileUri?: vscode.Uri,
    public readonly lineNumber: number = 0,
    public readonly childrenNodes?: SpecTreeItem[]
  ) {
    super(label, collapsibleState);

    if (kind === 'category') {
      this.contextValue = 'testformSpecCategory';
      if (scopeType === 'testcase') {
        this.iconPath = new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.purple'));
      } else if (scopeType === 'testrun') {
        this.iconPath = new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green'));
      } else if (scopeType === 'testplan') {
        this.iconPath = new vscode.ThemeIcon('notebook', new vscode.ThemeColor('charts.blue'));
      }
    } else if (kind === 'file') {
      this.contextValue = `testformSpecFile_${scopeType}`;
      this.iconPath = new vscode.ThemeIcon('file-code');
      if (fileUri) {
        this.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [
            fileUri,
            {
              selection: new vscode.Range(lineNumber, 0, lineNumber, 0)
            }
          ]
        };
      }
    } else if (kind === 'rule') {
      this.contextValue = 'testformSpecRule';
      this.iconPath = new vscode.ThemeIcon('symbol-namespace');
      if (fileUri) {
        this.command = {
          command: 'vscode.open',
          title: 'Jump to Rule',
          arguments: [
            fileUri,
            {
              selection: new vscode.Range(lineNumber, 0, lineNumber, 0)
            }
          ]
        };
      }
    } else if (kind === 'scenario') {
      this.contextValue = 'testformSpecScenario';
      this.iconPath = new vscode.ThemeIcon('target');
      if (fileUri) {
        this.command = {
          command: 'vscode.open',
          title: 'Jump to Scenario',
          arguments: [
            fileUri,
            {
              selection: new vscode.Range(lineNumber, 0, lineNumber, 0)
            }
          ]
        };
      }
    }
  }
}

export class SpecsTreeProvider implements vscode.TreeDataProvider<SpecTreeItem>, vscode.Disposable {
  private _onDidChangeTreeData: vscode.EventEmitter<SpecTreeItem | undefined | null | void> =
    new vscode.EventEmitter<SpecTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<SpecTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private disposables: vscode.Disposable[] = [];

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.feature');
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

  getTreeItem(element: SpecTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SpecTreeItem): Promise<SpecTreeItem[]> {
    if (element) {
      return element.childrenNodes || [];
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [new SpecTreeItem('No workspace open', vscode.TreeItemCollapsibleState.None, 'category')];
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const files = await vscode.workspace.findFiles('**/*.feature', '**/node_modules/**');

    const testcaseFiles: { uri: vscode.Uri; relPath: string; title: string; line: number; scenarios: SpecTreeItem[] }[] = [];
    const testrunFiles: { uri: vscode.Uri; relPath: string; title: string; line: number; children: SpecTreeItem[] }[] = [];
    const testplanFiles: { uri: vscode.Uri; relPath: string; title: string; line: number; children: SpecTreeItem[] }[] = [];

    for (const uri of files) {
      try {
        const content = fs.readFileSync(uri.fsPath, 'utf8');
        const lines = content.split(/\r?\n/);
        const relPath = path.relative(rootPath, uri.fsPath).replace(/\\/g, '/');
        const lowerName = path.basename(uri.fsPath).toLowerCase();

        let scope: 'testcase' | 'testrun' | 'testplan' = 'testcase';
        if (lowerName.includes('.run.feature')) scope = 'testrun';
        else if (lowerName.includes('.plan.feature')) scope = 'testplan';

        for (let i = 0; i < Math.min(lines.length, 15); i++) {
          const l = lines[i].trim();
          if (l.includes('@testrun')) scope = 'testrun';
          else if (l.includes('@testplan')) scope = 'testplan';
          else if (l.includes('@testcase')) scope = 'testcase';
        }

        let featureTitle = path.basename(uri.fsPath);
        let featureLine = 0;

        for (let i = 0; i < lines.length; i++) {
          const featMatch = lines[i].match(/^(?:Feature|Característica):\s*(.+)$/i);
          if (featMatch) {
            featureTitle = featMatch[1].trim();
            featureLine = i;
            break;
          }
        }

        if (scope === 'testcase') {
          const scenarios: SpecTreeItem[] = [];
          let pendingTags: string[] = [];

          for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const trimmed = raw.trim();
            if (trimmed.startsWith('#')) continue;

            if (trimmed.startsWith('@')) {
              const tags = trimmed.split(/\s+/).filter(t => t.startsWith('@'));
              pendingTags.push(...tags);
              continue;
            }

            const scenMatch = trimmed.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.+)$/i);
            if (scenMatch) {
              const scTitle = scenMatch[1].trim();
              const tag = pendingTags.find(t => /^@tc-[0-9]+/i.test(t));
              const label = tag ? `${tag} ${scTitle}` : scTitle;

              const scItem = new SpecTreeItem(
                label,
                vscode.TreeItemCollapsibleState.None,
                'scenario',
                'testcase',
                uri,
                i
              );
              scItem.description = tag ? undefined : `line ${i + 1}`;
              scenarios.push(scItem);
              pendingTags = [];
            }
          }

          testcaseFiles.push({ uri, relPath, title: featureTitle, line: featureLine, scenarios });
        } else if (scope === 'testrun') {
          const children: SpecTreeItem[] = [];
          let currentRuleItem: SpecTreeItem | null = null;
          let currentRuleChildren: SpecTreeItem[] = [];

          for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const trimmed = raw.trim();
            if (trimmed.startsWith('#')) continue;

            const ruleMatch = trimmed.match(/^(?:Rule|Regla):\s*(.+)$/i);
            if (ruleMatch) {
              const ruleText = ruleMatch[1].trim();
              currentRuleChildren = [];
              currentRuleItem = new SpecTreeItem(
                ruleText,
                vscode.TreeItemCollapsibleState.Expanded,
                'rule',
                'testrun',
                uri,
                i,
                currentRuleChildren
              );
              children.push(currentRuleItem);
              continue;
            }

            const scenMatch = trimmed.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.+)$/i);
            if (scenMatch) {
              const scTitle = scenMatch[1].trim();
              const scItem = new SpecTreeItem(
                scTitle,
                vscode.TreeItemCollapsibleState.None,
                'scenario',
                'testrun',
                uri,
                i
              );

              if (currentRuleItem) {
                currentRuleChildren.push(scItem);
              } else {
                children.push(scItem);
              }
            }
          }

          testrunFiles.push({ uri, relPath, title: featureTitle, line: featureLine, children });
        } else if (scope === 'testplan') {
          const children: SpecTreeItem[] = [];

          for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const trimmed = raw.trim();
            if (trimmed.startsWith('#')) continue;

            const ruleMatch = trimmed.match(/^(?:Rule|Regla):\s*(.+)$/i);
            if (ruleMatch) {
              const ruleText = ruleMatch[1].trim();
              const ruleItem = new SpecTreeItem(
                ruleText,
                vscode.TreeItemCollapsibleState.None,
                'rule',
                'testplan',
                uri,
                i
              );
              children.push(ruleItem);
            }
          }

          testplanFiles.push({ uri, relPath, title: featureTitle, line: featureLine, children });
        }
      } catch {
        // ignore unreadable files
      }
    }

    // Sort files by relPath
    testcaseFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
    testrunFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
    testplanFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));

    const buildFileItems = (list: typeof testcaseFiles, scope: 'testcase' | 'testrun' | 'testplan') => {
      return list.map(f => {
        const item = new SpecTreeItem(
          f.title,
          f.scenarios && f.scenarios.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None,
          'file',
          scope,
          f.uri,
          f.line,
          f.scenarios
        );
        item.description = f.relPath;
        item.tooltip = `${f.relPath}\n${f.title}`;
        return item;
      });
    };

    const buildSuiteItems = (list: typeof testrunFiles, scope: 'testrun' | 'testplan') => {
      return list.map(f => {
        const item = new SpecTreeItem(
          f.title,
          f.children && f.children.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None,
          'file',
          scope,
          f.uri,
          f.line,
          f.children
        );
        item.description = f.relPath;
        item.tooltip = `${f.relPath}\n${f.title}`;
        return item;
      });
    };

    const caseNodes = buildFileItems(testcaseFiles, 'testcase');
    const runNodes = buildSuiteItems(testrunFiles, 'testrun');
    const planNodes = buildSuiteItems(testplanFiles, 'testplan');

    const totalCasesCount = testcaseFiles.reduce((sum, f) => sum + f.scenarios.length, 0);

    const categories: SpecTreeItem[] = [
      new SpecTreeItem(
        `Test Cases (${testcaseFiles.length} files, ${totalCasesCount} cases)`,
        vscode.TreeItemCollapsibleState.Expanded,
        'category',
        'testcase',
        undefined,
        0,
        caseNodes
      ),
      new SpecTreeItem(
        `Test Runs (${testrunFiles.length} suites)`,
        vscode.TreeItemCollapsibleState.Expanded,
        'category',
        'testrun',
        undefined,
        0,
        runNodes
      ),
      new SpecTreeItem(
        `Test Plans (${testplanFiles.length} plans)`,
        vscode.TreeItemCollapsibleState.Expanded,
        'category',
        'testplan',
        undefined,
        0,
        planNodes
      )
    ];

    return categories;
  }
}
