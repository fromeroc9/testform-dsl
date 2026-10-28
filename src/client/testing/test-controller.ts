import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runTestformCommand } from '../terminal';

export class TestformTestController {
  private controller: vscode.TestController;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.controller = vscode.tests.createTestController('testform-controller', 'Testform Test Runs');
    this.disposables.push(this.controller);

    // Run Profile for executing tests
    this.controller.createRunProfile(
      'Apply Testrun Target',
      vscode.TestRunProfileKind.Run,
      (request, token) => this.runHandler(request, token),
      true
    );

    // Initial discovery
    this.discoverWorkspaceTests();

    // Watch feature files
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.feature');
    watcher.onDidCreate(uri => this.updateFileTests(uri));
    watcher.onDidChange(uri => this.updateFileTests(uri));
    watcher.onDidDelete(uri => this.removeFileTests(uri));
    this.disposables.push(watcher);
  }

  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }

  private async discoverWorkspaceTests(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.feature', '**/node_modules/**');
    for (const uri of files) {
      await this.updateFileTests(uri);
    }
  }

  private isTestrunFile(filePath: string, content: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    if (fileName.includes('.run.feature')) return true;

    // Check header tags
    const firstLines = content.split(/\r?\n/).slice(0, 15);
    for (const line of firstLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('@') && trimmed.includes('@testrun')) {
        return true;
      }
    }
    return false;
  }

  private async updateFileTests(uri: vscode.Uri): Promise<void> {
    try {
      if (!fs.existsSync(uri.fsPath)) {
        this.removeFileTests(uri);
        return;
      }

      const content = fs.readFileSync(uri.fsPath, 'utf8');

      // Only expose test runs in the Test Explorer / Gutter Play icons
      if (!this.isTestrunFile(uri.fsPath, content)) {
        this.removeFileTests(uri);
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      const rootPath = workspaceFolder ? workspaceFolder.uri.fsPath : '';
      const relPath = rootPath ? path.relative(rootPath, uri.fsPath).replace(/\\/g, '/') : path.basename(uri.fsPath);
      const fileName = path.basename(uri.fsPath);

      const lines = content.split(/\r?\n/);

      // Extract Feature title
      let featureTitle = fileName;
      for (let i = 0; i < lines.length; i++) {
        const featMatch = lines[i].match(/^(?:Feature|Característica):\s*(.+)$/i);
        if (featMatch) {
          featureTitle = featMatch[1].trim();
          break;
        }
      }

      const fileTestItem = this.controller.createTestItem(
        uri.toString(),
        featureTitle,
        uri
      );
      fileTestItem.description = relPath;

      // Group scenarios under Rules if present
      let currentRuleItem: vscode.TestItem | null = null;
      let pendingTags: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim();

        if (trimmed.startsWith('#')) continue;

        if (trimmed.startsWith('@')) {
          const tags = trimmed.split(/\s+/).filter(t => t.startsWith('@'));
          pendingTags.push(...tags);
          continue;
        }

        const ruleMatch = trimmed.match(/^(?:Rule|Regla):\s*(.+)$/i);
        if (ruleMatch) {
          const ruleTitle = ruleMatch[1].trim();
          const ruleId = `${uri.toString()}::rule_${i}`;
          currentRuleItem = this.controller.createTestItem(ruleId, ruleTitle, uri);
          currentRuleItem.range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, rawLine.length));
          fileTestItem.children.add(currentRuleItem);
          pendingTags = [];
          continue;
        }

        const scenarioMatch = trimmed.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.+)$/i);
        if (scenarioMatch) {
          const title = scenarioMatch[1].trim();
          const identityTag = pendingTags.find(t => /^@(tr|tc|tp)-/i.test(t));
          const id = identityTag ? `${uri.toString()}::${identityTag}` : `${uri.toString()}::line_${i}`;

          const scenarioItem = this.controller.createTestItem(id, title, uri);
          scenarioItem.range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, rawLine.length));

          if (identityTag) {
            scenarioItem.description = identityTag;
          }

          if (currentRuleItem) {
            currentRuleItem.children.add(scenarioItem);
          } else {
            fileTestItem.children.add(scenarioItem);
          }
          pendingTags = [];
        } else if (trimmed.length > 0 && !trimmed.startsWith('@')) {
          pendingTags = [];
        }
      }

      this.controller.items.add(fileTestItem);
    } catch {
      // ignore read errors
    }
  }

  private removeFileTests(uri: vscode.Uri): void {
    this.controller.items.delete(uri.toString());
  }

  private async runHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken
  ): Promise<void> {
    const run = this.controller.createTestRun(request);
    const queue: vscode.TestItem[] = [];

    if (request.include) {
      request.include.forEach(item => queue.push(item));
    } else {
      this.controller.items.forEach(item => queue.push(item));
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const rootPath = workspaceFolder ? workspaceFolder.uri.fsPath : '';

    for (const item of queue) {
      if (token.isCancellationRequested) {
        run.skipped(item);
        continue;
      }

      run.started(item);

      const uri = item.uri;
      if (!uri) {
        run.skipped(item);
        continue;
      }

      const relPath = rootPath ? path.relative(rootPath, uri.fsPath).replace(/\\/g, '/') : path.basename(uri.fsPath);

      // Single scenario: target is address (e.g. suites/smoke.run.feature.@tr-1)
      const targetTag = item.description && item.description.startsWith('@') ? item.description : undefined;

      if (targetTag) {
        const address = `${relPath}.${targetTag}`;
        run.appendOutput(`Executing Testform target: ${address}\r\n`);
        runTestformCommand(`apply --auto-approve --target="${address}"`);
        run.passed(item);
      } else {
        // Entire testrun feature
        run.appendOutput(`Executing Testform suite: ${relPath}\r\n`);
        runTestformCommand(`apply --auto-approve --target="${relPath}"`);
        run.passed(item);
      }
    }

    run.end();
  }
}
