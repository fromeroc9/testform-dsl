import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class TestformFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined> =
    new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> =
    this._onDidChangeFileDecorations.event;

  private scopes = {
    testcase: '*.case.feature',
    testrun: '*.run.feature',
    testplan: '*.plan.feature'
  };

  constructor() {
    this.refreshScopes();
    // Watch for config changes
    const watcher = vscode.workspace.createFileSystemWatcher('{**/main.yml,**/main.yaml,**/testform.yml,**/testform.yaml,**/resource.yml}');
    watcher.onDidChange(() => {
      this.refreshScopes();
      this._onDidChangeFileDecorations.fire(undefined);
    });
  }

  public refreshScopes(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    for (const file of ['main.yml', 'main.yaml', 'testform.yml', 'testform.yaml', 'resource.yml']) {
      const p = path.join(folders[0].uri.fsPath, file);
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf8');
          const tcMatch = content.match(/testcase:\s*\n(?:\s+.*?\n)*?\s+match:\s*["']?([^"'\n]+)["']?/);
          if (tcMatch) this.scopes.testcase = tcMatch[1].trim();

          const trMatch = content.match(/testrun:\s*\n(?:\s+.*?\n)*?\s+match:\s*["']?([^"'\n]+)["']?/);
          if (trMatch) this.scopes.testrun = trMatch[1].trim();

          const tpMatch = content.match(/testplan:\s*\n(?:\s+.*?\n)*?\s+match:\s*["']?([^"'\n]+)["']?/);
          if (tpMatch) this.scopes.testplan = tpMatch[1].trim();
        } catch {}
        break;
      }
    }
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    const fileName = path.basename(uri.fsPath).toLowerCase();

    // 1. Check YAML manifests
    if (fileName === 'main.yml' || fileName === 'main.yaml' || fileName === 'testform.yml' || fileName === 'testform.yaml') {
      return {
        badge: 'TF',
        tooltip: 'Testform Root Manifest',
        color: new vscode.ThemeColor('symbolIcon.classForeground')
      };
    }

    if (fileName === 'resource.yml' || fileName === 'resource.yaml' || fileName === 'variables.yml' || fileName.endsWith('.vars.yml')) {
      return {
        badge: 'TF',
        tooltip: 'Testform Configuration Component',
        color: new vscode.ThemeColor('symbolIcon.variableForeground')
      };
    }

    // 2. Check dynamic scopes matched from configuration
    if (this.matchesPattern(fileName, this.scopes.testcase)) {
      return {
        badge: 'TC',
        tooltip: 'Testform Testcase Specification',
        color: new vscode.ThemeColor('testing.iconPassed')
      };
    }

    if (this.matchesPattern(fileName, this.scopes.testrun)) {
      return {
        badge: 'TR',
        tooltip: 'Testform Testrun Suite',
        color: new vscode.ThemeColor('testing.iconQueued')
      };
    }

    if (this.matchesPattern(fileName, this.scopes.testplan)) {
      return {
        badge: 'TP',
        tooltip: 'Testform Master Testplan',
        color: new vscode.ThemeColor('symbolIcon.packageForeground')
      };
    }

    return undefined;
  }

  private matchesPattern(fileName: string, pattern: string): boolean {
    if (!pattern) return false;
    const cleanPattern = pattern.split('::')[0].trim();
    // Convert glob like *.case.feature to regex
    const regexStr = '^' + cleanPattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
    try {
      return new RegExp(regexStr, 'i').test(fileName);
    } catch {
      return false;
    }
  }
}
