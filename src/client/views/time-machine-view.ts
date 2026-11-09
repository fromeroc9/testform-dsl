import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';

export class StateRevisionContentProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'testform-state-revision';
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;

  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const commitHash = uri.authority;
    const relPath = uri.path.replace(/^\//, '') || 'testform.state';
    const projectRoot = uri.query ? decodeURIComponent(uri.query) : this.findProjectRoot();

    return new Promise((resolve, reject) => {
      execFile('git', ['show', `${commitHash}:${relPath}`], { cwd: projectRoot, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          resolve(`// Error loading state from git revision ${commitHash}\n// ${stderr || err.message}`);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  private findProjectRoot(): string {
    const ws = vscode.workspace.workspaceFolders;
    return ws && ws.length > 0 ? ws[0].uri.fsPath : process.cwd();
  }
}

export interface StateCommitInfo {
  commitHash: string;
  shortHash: string;
  author: string;
  relativeDate: string;
  absoluteDate: string;
  subject: string;
  serial?: number;
  lineage?: string;
  provider?: string;
  totalResources?: number;
  caseCount?: number;
  runCount?: number;
  planCount?: number;
  bugCount?: number;
}

export class TimeMachineCommitItem extends vscode.TreeItem {
  constructor(
    public readonly commit: StateCommitInfo,
    public readonly stateRelPath: string,
    public readonly projectRoot: string
  ) {
    const serialBadge = commit.serial !== undefined ? `[#${commit.serial}] ` : '';
    super(`${serialBadge}${commit.shortHash} - ${commit.subject}`, vscode.TreeItemCollapsibleState.Collapsed);

    this.description = `${commit.relativeDate} (${commit.author})`;
    this.contextValue = 'testformHistoryCommit';
    this.iconPath = new vscode.ThemeIcon('git-commit');

    const resDetails = commit.totalResources !== undefined
      ? `\nResources: ${commit.totalResources} (cases: ${commit.caseCount || 0}, runs: ${commit.runCount || 0}, plans: ${commit.planCount || 0}, bugs: ${commit.bugCount || 0})`
      : '';

    this.tooltip = `Commit: ${commit.commitHash}\nAuthor: ${commit.author}\nDate: ${commit.absoluteDate}\nSerial: ${commit.serial ?? 'Unknown'}${resDetails}\n\nMessage: ${commit.subject}`;

    const leftUri = vscode.Uri.from({
      scheme: StateRevisionContentProvider.scheme,
      authority: commit.commitHash,
      path: '/' + stateRelPath,
      query: encodeURIComponent(projectRoot)
    });
    const currentPath = path.join(projectRoot, stateRelPath);

    this.command = {
      command: 'vscode.diff',
      title: 'Compare with Current State',
      arguments: [
        leftUri,
        vscode.Uri.file(currentPath),
        `testform.state (${commit.shortHash}) ↔ Current`
      ]
    };
  }
}

export class TimeMachineDetailItem extends vscode.TreeItem {
  constructor(label: string, description?: string, icon?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (description) {
      this.description = description;
    }
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
    this.contextValue = 'testformHistoryDetail';
  }
}

export class StateTimeMachineProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private _commitsCache: StateCommitInfo[] = [];
  private _projectRoot: string = '';
  private _stateRelPath: string = 'testform.state';

  constructor() {
    this.detectWorkspace();
  }

  public refresh(): void {
    this._commitsCache = [];
    this.detectWorkspace();
    this._onDidChangeTreeData.fire();
  }

  private detectWorkspace(): void {
    const ws = vscode.workspace.workspaceFolders;
    if (ws && ws.length > 0) {
      this._projectRoot = ws[0].uri.fsPath;
    } else {
      this._projectRoot = process.cwd();
    }

    // Check if testform.state exists in root or search for it
    if (fs.existsSync(path.join(this._projectRoot, 'testform.state'))) {
      this._stateRelPath = 'testform.state';
    } else {
      // Find candidate
      const candidate = this.findStateFile(this._projectRoot);
      if (candidate) {
        this._stateRelPath = path.relative(this._projectRoot, candidate).replace(/\\/g, '/');
      }
    }
  }

  private findStateFile(dir: string): string | null {
    try {
      const files = fs.readdirSync(dir);
      if (files.includes('testform.state')) {
        return path.join(dir, 'testform.state');
      }
    } catch {
      // ignore
    }
    return null;
  }

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof TimeMachineCommitItem) {
      const c = element.commit;
      const items: vscode.TreeItem[] = [];

      if (c.serial !== undefined) {
        items.push(new TimeMachineDetailItem(`Serial: ${c.serial}`, undefined, 'symbol-number'));
      }
      if (c.provider) {
        items.push(new TimeMachineDetailItem(`Provider: ${c.provider}`, undefined, 'server'));
      }
      if (c.lineage) {
        items.push(new TimeMachineDetailItem(`Lineage: ${c.lineage.substring(0, 8)}...`, c.lineage, 'git-branch'));
      }
      if (c.totalResources !== undefined) {
        items.push(new TimeMachineDetailItem(`Total Resources: ${c.totalResources}`, undefined, 'layers'));
        items.push(new TimeMachineDetailItem(`Test Cases: ${c.caseCount || 0}`, undefined, 'beaker'));
        items.push(new TimeMachineDetailItem(`Test Runs: ${c.runCount || 0}`, undefined, 'run-all'));
        items.push(new TimeMachineDetailItem(`Test Plans: ${c.planCount || 0}`, undefined, 'checklist'));
        if (c.bugCount && c.bugCount > 0) {
          items.push(new TimeMachineDetailItem(`Bugs: ${c.bugCount}`, undefined, 'bug'));
        }
      }

      return items;
    }

    if (!element) {
      if (!this._projectRoot) {
        return [new vscode.TreeItem('No active workspace open', vscode.TreeItemCollapsibleState.None)];
      }

      if (this._commitsCache.length === 0) {
        await this.loadCommits();
      }

      if (this._commitsCache.length === 0) {
        const emptyItem = new vscode.TreeItem('No Git history found for testform.state', vscode.TreeItemCollapsibleState.None);
        emptyItem.description = 'Commits that touch testform.state will appear here';
        emptyItem.iconPath = new vscode.ThemeIcon('info');
        return [emptyItem];
      }

      return this._commitsCache.map(
        c => new TimeMachineCommitItem(c, this._stateRelPath, this._projectRoot)
      );
    }

    return [];
  }

  private loadCommits(): Promise<void> {
    return new Promise(resolve => {
      execFile(
        'git',
        ['log', '--follow', '--format=%H|%h|%an|%ar|%ad|%s', '-n', '50', '--', this._stateRelPath],
        { cwd: this._projectRoot, maxBuffer: 10 * 1024 * 1024 },
        async (err, stdout) => {
          if (err || !stdout.trim()) {
            this._commitsCache = [];
            resolve();
            return;
          }

          const lines = stdout.trim().split('\n');
          const results: StateCommitInfo[] = [];

          for (const line of lines) {
            const parts = line.split('|');
            if (parts.length >= 6) {
              const commitHash = parts[0];
              const shortHash = parts[1];
              const author = parts[2];
              const relativeDate = parts[3];
              const absoluteDate = parts[4];
              const subject = parts.slice(5).join('|');

              results.push({
                commitHash,
                shortHash,
                author,
                relativeDate,
                absoluteDate,
                subject
              });
            }
          }

          // Hydrate the first 10 commits with state metadata
          const inspectBatch = results.slice(0, 10);
          await Promise.all(
            inspectBatch.map(info => this.hydrateCommitMetadata(info))
          );

          this._commitsCache = results;
          resolve();
        }
      );
    });
  }

  private hydrateCommitMetadata(info: StateCommitInfo): Promise<void> {
    return new Promise(resolve => {
      execFile(
        'git',
        ['show', `${info.commitHash}:${this._stateRelPath}`],
        { cwd: this._projectRoot, maxBuffer: 15 * 1024 * 1024 },
        (err, stdout) => {
          if (!err && stdout) {
            try {
              const state = JSON.parse(stdout);
              info.serial = state.serial;
              info.lineage = state.lineage;
              info.provider = state.provider;
              if (Array.isArray(state.resources)) {
                info.totalResources = state.resources.length;
                info.caseCount = state.resources.filter((r: any) => r.type === 'testcase' || r.type === 'github_testcase').length;
                info.runCount = state.resources.filter((r: any) => r.type === 'testrun' || r.type === 'github_testcycle' || r.type === 'github_testrun').length;
                info.planCount = state.resources.filter((r: any) => r.type === 'testplan' || r.type === 'github_testplan').length;
                info.bugCount = state.resources.filter((r: any) => r.type === 'bug' || r.type === 'github_bug').length;
              }
            } catch {
              // ignore json parse errors
            }
          }
          resolve();
        }
      );
    });
  }

  public async restoreCommit(item: TimeMachineCommitItem): Promise<void> {
    const confirmation = await vscode.window.showWarningMessage(
      `Restore testform.state to commit ${item.commit.shortHash} (Serial: ${item.commit.serial ?? '?'})?\n\nCurrent uncommitted state changes will be overwritten.`,
      { modal: true },
      'Restore State'
    );

    if (confirmation !== 'Restore State') {
      return;
    }

    const stateFullPath = path.join(this._projectRoot, this._stateRelPath);

    execFile(
      'git',
      ['show', `${item.commit.commitHash}:${this._stateRelPath}`],
      { cwd: this._projectRoot, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err || !stdout) {
          vscode.window.showErrorMessage(`Failed to retrieve state from git: ${stderr || err?.message}`);
          return;
        }

        try {
          fs.writeFileSync(stateFullPath, stdout, 'utf-8');
          vscode.window.showInformationMessage(
            `Restored testform.state to commit ${item.commit.shortHash} (Serial: ${item.commit.serial ?? '?'})`
          );
          vscode.commands.executeCommand('testform.state.refresh');
          this.refresh();
        } catch (e: any) {
          vscode.window.showErrorMessage(`Failed to write state file: ${e.message}`);
        }
      }
    );
  }

  public async viewCommit(item: TimeMachineCommitItem): Promise<void> {
    const uri = vscode.Uri.from({
      scheme: StateRevisionContentProvider.scheme,
      authority: item.commit.commitHash,
      path: '/' + this._stateRelPath,
      query: encodeURIComponent(this._projectRoot)
    });

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  public async compareCommit(item: TimeMachineCommitItem): Promise<void> {
    const leftUri = vscode.Uri.from({
      scheme: StateRevisionContentProvider.scheme,
      authority: item.commit.commitHash,
      path: '/' + this._stateRelPath,
      query: encodeURIComponent(this._projectRoot)
    });
    const currentPath = path.join(this._projectRoot, this._stateRelPath);

    await vscode.commands.executeCommand(
      'vscode.diff',
      leftUri,
      vscode.Uri.file(currentPath),
      `testform.state (${item.commit.shortHash}) ↔ Current`
    );
  }
}
