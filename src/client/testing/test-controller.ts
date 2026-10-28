import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runTestformCommand } from '../terminal';

interface ReferencedFeatureInfo {
  featureTitle: string;
  scenariosByTag: Map<string, string>; // e.g. "@tc-1" -> "Inicio de sesión exitoso con usuario estándar"
  scenariosByName: Map<string, string>;
}

export class TestformTestController {
  private controller: vscode.TestController;
  private disposables: vscode.Disposable[] = [];
  private scenarioStatusMap: Map<string, string> = new Map(); // testId -> status ("passed", "failed", etc.)

  constructor() {
    this.controller = vscode.tests.createTestController('testform-controller', 'Testform Test Runs');
    this.disposables.push(this.controller);

    // Run Profile for executing tests
    this.controller.createRunProfile(
      'Run Testform Suite',
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

    // Check header tags for @testrun
    const firstLines = content.split(/\r?\n/).slice(0, 15);
    for (const line of firstLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('@') && trimmed.includes('@testrun')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Reads a referenced feature file (e.g. auth/login.case.feature)
   * to extract its Feature title and scenario names by tag.
   */
  private resolveReferencedFeature(rootPath: string, ruleText: string): ReferencedFeatureInfo | null {
    try {
      // Find possible candidate path
      let candidatePath = path.resolve(rootPath, ruleText);
      if (!fs.existsSync(candidatePath)) {
        if (!candidatePath.endsWith('.feature')) {
          candidatePath = `${candidatePath}.feature`;
        }
      }

      if (!fs.existsSync(candidatePath)) {
        // Fallback: search in workspace by basename
        const base = path.basename(ruleText);
        const searchBase = base.endsWith('.feature') ? base : `${base}.feature`;
        const findInDir = (dir: string): string | null => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
              const res = findInDir(path.join(dir, e.name));
              if (res) return res;
            } else if (e.isFile() && e.name.toLowerCase() === searchBase.toLowerCase()) {
              return path.join(dir, e.name);
            }
          }
          return null;
        };
        const found = findInDir(rootPath);
        if (found) candidatePath = found;
      }

      if (!fs.existsSync(candidatePath)) return null;

      const content = fs.readFileSync(candidatePath, 'utf8');
      const lines = content.split(/\r?\n/);

      let featureTitle = path.basename(candidatePath);
      const scenariosByTag = new Map<string, string>();
      const scenariosByName = new Map<string, string>();

      let pendingTags: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#')) continue;

        const featMatch = line.match(/^(?:Feature|Característica):\s*(.+)$/i);
        if (featMatch) {
          featureTitle = featMatch[1].trim();
          continue;
        }

        if (line.startsWith('@')) {
          const tags = line.split(/\s+/).filter(t => t.startsWith('@'));
          pendingTags.push(...tags);
          continue;
        }

        const scenMatch = line.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.+)$/i);
        if (scenMatch) {
          const title = scenMatch[1].trim();
          scenariosByName.set(title.toLowerCase(), title);

          for (const tag of pendingTags) {
            if (/^@(tc|tr|tp)-[0-9]+/i.test(tag)) {
              scenariosByTag.set(tag.toLowerCase(), title);
            }
          }
          pendingTags = [];
        } else if (line.length > 0 && !line.startsWith('@')) {
          pendingTags = [];
        }
      }

      return { featureTitle, scenariosByTag, scenariosByName };
    } catch {
      return null;
    }
  }

  private async updateFileTests(uri: vscode.Uri): Promise<void> {
    try {
      if (!fs.existsSync(uri.fsPath)) {
        this.removeFileTests(uri);
        return;
      }

      const content = fs.readFileSync(uri.fsPath, 'utf8');

      // Only expose test runs in the Test Explorer
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

      let currentRuleItem: vscode.TestItem | null = null;
      let currentRefInfo: ReferencedFeatureInfo | null = null;
      let currentScenarioItem: vscode.TestItem | null = null;

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim();

        if (trimmed.startsWith('#')) continue;

        // 1. Rule block: Rule: auth/login.case.feature
        const ruleMatch = trimmed.match(/^(?:Rule|Regla):\s*(.+)$/i);
        if (ruleMatch) {
          const ruleText = ruleMatch[1].trim();
          currentRefInfo = this.resolveReferencedFeature(rootPath, ruleText);

          // Use the referenced feature's title as the label if resolved
          const ruleLabel = currentRefInfo?.featureTitle || ruleText;
          const ruleId = `${uri.toString()}::rule_${i}`;

          currentRuleItem = this.controller.createTestItem(ruleId, ruleLabel, uri);
          currentRuleItem.description = ruleText;
          currentRuleItem.range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, rawLine.length));

          fileTestItem.children.add(currentRuleItem);
          currentScenarioItem = null;
          continue;
        }

        // 2. Scenario block: Scenario: login.case.feature.@tc-1
        const scenarioMatch = trimmed.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.+)$/i);
        if (scenarioMatch) {
          const rawScenarioText = scenarioMatch[1].trim();

          // Check if it references a testcase tag like @tc-1 or an address
          const tagMatch = rawScenarioText.match(/@(tc|tr|tp)-[0-9]+/i);
          const tag = tagMatch ? tagMatch[0].toLowerCase() : undefined;

          // Lookup linked scenario name from referenced feature
          let linkedTitle: string | undefined;
          if (tag && currentRefInfo) {
            linkedTitle = currentRefInfo.scenariosByTag.get(tag);
          }

          const displayTitle = linkedTitle || rawScenarioText;
          const id = `${uri.toString()}::scenario_${i}`;

          currentScenarioItem = this.controller.createTestItem(id, displayTitle, uri);
          currentScenarioItem.range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, rawLine.length));
          currentScenarioItem.description = tag ? tag.toUpperCase() : undefined;

          if (currentRuleItem) {
            currentRuleItem.children.add(currentScenarioItem);
          } else {
            fileTestItem.children.add(currentScenarioItem);
          }
          continue;
        }

        // 3. Status mark step: * mark status = passed | failed | pending | skipped | blocked
        const statusMatch = trimmed.match(/^\*\s+mark\s+status\s*=\s*([a-zA-Z]+)/i);
        if (statusMatch && currentScenarioItem) {
          const status = statusMatch[1].toLowerCase();
          this.scenarioStatusMap.set(currentScenarioItem.id, status);

          const existingTag = currentScenarioItem.description?.split(' ')[0] || '';
          currentScenarioItem.description = existingTag
            ? `${existingTag} [${status.toUpperCase()}]`
            : `[${status.toUpperCase()}]`;
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

    // Collect all root feature items
    const executedFiles = new Set<string>();

    for (const item of queue) {
      if (token.isCancellationRequested) {
        run.skipped(item);
        continue;
      }

      const uri = item.uri;
      if (!uri) continue;

      const fileKey = uri.toString();
      if (!executedFiles.has(fileKey)) {
        executedFiles.add(fileKey);
        const relPath = rootPath ? path.relative(rootPath, uri.fsPath).replace(/\\/g, '/') : path.basename(uri.fsPath);

        run.appendOutput(`Executing Testform suite: ${relPath}\r\n`);
        // Always run at Feature level directly
        runTestformCommand(`apply --auto-approve --target="${relPath}"`);
      }

      // Propagate mark status to scenario items
      const reportScenarioStatus = (node: vscode.TestItem) => {
        const status = this.scenarioStatusMap.get(node.id);
        run.started(node);

        if (status === 'passed') {
          run.passed(node);
        } else if (status === 'failed') {
          run.failed(node, new vscode.TestMessage('Status in ledger: failed'));
        } else if (status === 'skipped' || status === 'blocked') {
          run.skipped(node);
        } else {
          run.enqueued(node);
        }

        node.children.forEach(c => reportScenarioStatus(c));
      };

      reportScenarioStatus(item);
    }

    run.end();
  }
}
