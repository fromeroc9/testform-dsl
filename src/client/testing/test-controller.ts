import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runTestformCommand } from '../terminal';

export class TestformTestController {
  private controller: vscode.TestController;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.controller = vscode.tests.createTestController('testform-controller', 'Testform Tests');
    this.disposables.push(this.controller);

    // Run Profile
    this.controller.createRunProfile(
      'Run Testform Target',
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

  private async updateFileTests(uri: vscode.Uri): Promise<void> {
    const fileName = path.basename(uri.fsPath);
    let scopeKind = 'Testcase';
    if (fileName.includes('.run.')) scopeKind = 'Testrun';
    else if (fileName.includes('.plan.')) scopeKind = 'Testplan';

    const fileTestItem = this.controller.createTestItem(
      uri.toString(),
      `[${scopeKind}] ${fileName}`,
      uri
    );

    try {
      const content = fs.readFileSync(uri.fsPath, 'utf8');
      const lines = content.split('\n');

      let currentScenario: vscode.TestItem | null = null;
      let pendingTags: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('@')) {
          const tags = line.split(/\s+/).filter(t => t.startsWith('@'));
          pendingTags.push(...tags);
          continue;
        }

        const scenarioMatch = line.match(/^Scenario(?:\s+Outline)?:\s*(.+)$/i);
        if (scenarioMatch) {
          const title = scenarioMatch[1].trim();
          const identityTag = pendingTags.find(t => /^@(tc|tr|tp)-/i.test(t));
          const id = identityTag ? `${uri.toString()}::${identityTag}` : `${uri.toString()}::line_${i}`;
          const label = identityTag ? `${title} (${identityTag})` : title;

          const scenarioItem = this.controller.createTestItem(id, label, uri);
          scenarioItem.range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, line.length));
          
          if (identityTag) {
            scenarioItem.description = identityTag;
          }

          fileTestItem.children.add(scenarioItem);
          pendingTags = [];
        } else if (!line.startsWith('#') && line.length > 0) {
          pendingTags = [];
        }
      }
    } catch {}

    this.controller.items.add(fileTestItem);
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

    for (const item of queue) {
      if (token.isCancellationRequested) {
        run.skipped(item);
        continue;
      }

      run.started(item);

      // Extract target tag if present
      const targetTag = item.description && item.description.startsWith('@') ? item.description : undefined;
      if (targetTag) {
        run.appendOutput(`Executing Testform target: ${targetTag}\r\n`);
        runTestformCommand(`plan -target=${targetTag}`);
        run.passed(item);
      } else {
        run.appendOutput(`Executing feature: ${item.label}\r\n`);
        runTestformCommand(`plan`);
        run.passed(item);
      }
    }

    run.end();
  }
}
