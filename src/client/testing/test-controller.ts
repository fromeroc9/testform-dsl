import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runTestformCommand } from '../terminal';

interface ReferencedScenario {
  id: string;
  title: string;
  tag?: string;
  status?: string;
  lineIndex?: number;
  targetAddress?: string;
}

interface ReferencedFeatureInfo {
  featureTitle: string;
  scope: 'testcase' | 'testrun' | 'testplan';
  scenariosByTag: Map<string, string>; // e.g. "@tc-1" -> "Inicio de sesión exitoso con usuario estándar"
  scenarios: ReferencedScenario[];
}

export class TestformTestController implements vscode.Disposable {
  private controller: vscode.TestController;
  private disposables: vscode.Disposable[] = [];
  private scenarioStatusMap: Map<string, string> = new Map();
  private scenarioAddressMap: Map<string, string> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

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
    const featureWatcher = vscode.workspace.createFileSystemWatcher('**/*.feature');
    featureWatcher.onDidCreate(uri => this.updateFileTests(uri));
    featureWatcher.onDidChange(uri => this.updateFileTests(uri));
    featureWatcher.onDidDelete(uri => this.removeFileTests(uri));
    this.disposables.push(featureWatcher);

    // Watch state file for live updates from apply
    const stateWatcher = vscode.workspace.createFileSystemWatcher('{testform.state,**/*.state}');
    stateWatcher.onDidCreate(() => this.syncAllWithState());
    stateWatcher.onDidChange(() => this.syncAllWithState());
    this.disposables.push(stateWatcher);

    // Live update when document is edited in editor (without waiting for disk save)
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        const docUri = e.document.uri;
        if (docUri.fsPath.endsWith('.run.feature') || docUri.fsPath.endsWith('.feature')) {
          const key = docUri.toString();
          const existing = this.debounceTimers.get(key);
          if (existing) clearTimeout(existing);

          const timer = setTimeout(() => {
            this.debounceTimers.delete(key);
            this.updateFileTests(docUri);
          }, 250);
          this.debounceTimers.set(key, timer);
        }
      })
    );
  }

  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.debounceTimers.forEach(t => clearTimeout(t));
    this.debounceTimers.clear();
  }

  private async discoverWorkspaceTests(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.run.feature', '**/node_modules/**');
    for (const uri of files) {
      await this.updateFileTests(uri);
    }
  }

  /**
   * Only expose test runs in the Test Explorer sidebar.
   * Testcases and testplans are executed via CodeLens / Play buttons.
   */
  private isExecutableSuiteFile(filePath: string, content: string): boolean {
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

  /**
   * Resolves a referenced feature file:
   * In a testrun: Rule points to a testcase (*.case.feature)
   */
  private resolveReferencedFeature(rootPath: string, ruleText: string): ReferencedFeatureInfo | null {
    try {
      let candidatePath = path.resolve(rootPath, ruleText);
      if (!fs.existsSync(candidatePath)) {
        if (!candidatePath.endsWith('.feature')) {
          candidatePath = `${candidatePath}.feature`;
        }
      }

      if (!fs.existsSync(candidatePath)) {
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

      const lowerName = path.basename(candidatePath).toLowerCase();
      let scope: 'testcase' | 'testrun' | 'testplan' = 'testcase';
      if (lowerName.includes('.run.')) scope = 'testrun';
      else if (lowerName.includes('.plan.')) scope = 'testplan';

      let featureTitle = path.basename(candidatePath);
      const scenariosByTag = new Map<string, string>();
      const scenarios: ReferencedScenario[] = [];

      let pendingTags: string[] = [];
      let currentScen: ReferencedScenario | null = null;

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
          const identityTag = pendingTags.find(t => /^@(tc|tr|tp)-[0-9]+/i.test(t));
          if (identityTag) {
            scenariosByTag.set(identityTag.toLowerCase(), title);
          }

          currentScen = {
            id: identityTag || `line_${i}`,
            title,
            tag: identityTag,
            lineIndex: i
          };
          scenarios.push(currentScen);
          pendingTags = [];
          continue;
        }

        const statusMatch = line.match(/^\*\s+mark\s+status\s*=\s*([a-zA-Z]+)/i);
        if (statusMatch && currentScen) {
          currentScen.status = statusMatch[1].toLowerCase();
        }
      }

      return { featureTitle, scope, scenariosByTag, scenarios };
    } catch {
      return null;
    }
  }

  private getDocumentText(uri: vscode.Uri): string | null {
    const openDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (openDoc) {
      return openDoc.getText();
    }
    if (fs.existsSync(uri.fsPath)) {
      try {
        return fs.readFileSync(uri.fsPath, 'utf8');
      } catch {
        return null;
      }
    }
    return null;
  }

  private async updateFileTests(uri: vscode.Uri): Promise<void> {
    try {
      const content = this.getDocumentText(uri);
      if (content === null) {
        this.removeFileTests(uri);
        return;
      }

      // ONLY testrun files are displayed in the Test Explorer
      if (!this.isExecutableSuiteFile(uri.fsPath, content)) {
        this.removeFileTests(uri);
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      const rootPath = workspaceFolder ? workspaceFolder.uri.fsPath : '';
      const relPath = rootPath ? path.relative(rootPath, uri.fsPath).replace(/\\/g, '/') : path.basename(uri.fsPath);
      const fileName = path.basename(uri.fsPath);

      const lines = content.split(/\r?\n/);

      // Extract Feature title and its line index
      let featureTitle = fileName;
      let featureLineIndex = 0;
      for (let i = 0; i < lines.length; i++) {
        const featMatch = lines[i].match(/^(?:Feature|Característica):\s*(.+)$/i);
        if (featMatch) {
          featureTitle = featMatch[1].trim();
          featureLineIndex = i;
          break;
        }
      }

      let fileTestItem = this.controller.items.get(uri.toString());
      if (!fileTestItem) {
        fileTestItem = this.controller.createTestItem(
          uri.toString(),
          featureTitle,
          uri
        );
        this.controller.items.add(fileTestItem);
      } else {
        fileTestItem.label = featureTitle;
      }
      fileTestItem.description = relPath;

      // Gutter play icon on "Feature:" (Play entire testrun)
      fileTestItem.range = new vscode.Range(
        new vscode.Position(featureLineIndex, 0),
        new vscode.Position(featureLineIndex, lines[featureLineIndex].length)
      );

      let currentRuleItem: vscode.TestItem | null = null;
      let currentRuleText = '';
      let currentRefInfo: ReferencedFeatureInfo | null = null;
      let currentScenarioItem: vscode.TestItem | null = null;
      let currentScenarioTarget = '';

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim();

        if (trimmed.startsWith('#')) continue;

        // 1. Rule block: Rule: auth/login.case.feature
        const ruleMatch = trimmed.match(/^(?:Rule|Regla):\s*(.+)$/i);
        if (ruleMatch) {
          currentRuleText = ruleMatch[1].trim();
          currentRefInfo = this.resolveReferencedFeature(rootPath, currentRuleText);

          const ruleLabel = currentRefInfo?.featureTitle || currentRuleText;
          const ruleId = `${uri.toString()}::rule_${i}`;

          let ruleNode = fileTestItem.children.get(ruleId);
          if (!ruleNode) {
            ruleNode = this.controller.createTestItem(ruleId, ruleLabel, uri);
            fileTestItem.children.add(ruleNode);
          } else {
            ruleNode.label = ruleLabel;
          }
          ruleNode.description = currentRuleText;
          // No range set on Rule item to keep play buttons focused on Feature & Scenarios
          ruleNode.range = undefined;

          currentRuleItem = ruleNode;
          currentScenarioItem = null;
          continue;
        }

        // 2. Scenario block in testrun: Scenario: login.case.feature.@tc-1
        const scenarioMatch = trimmed.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.+)$/i);
        if (scenarioMatch) {
          const rawScenarioText = scenarioMatch[1].trim();
          const tagMatch = rawScenarioText.match(/@(tc|tr|tp)-[0-9]+/i);
          const tag = tagMatch ? tagMatch[0].toLowerCase() : undefined;

          // Determine target address for execution
          if (rawScenarioText.includes('/') || rawScenarioText.includes('.feature')) {
            currentScenarioTarget = rawScenarioText;
          } else if (currentRuleText && tag) {
            currentScenarioTarget = `${currentRuleText}.${tag}`;
          } else if (tag) {
            currentScenarioTarget = tag;
          } else {
            currentScenarioTarget = rawScenarioText;
          }

          // Resolve display title from referenced feature
          let displayTitle = rawScenarioText;
          if (tag && currentRefInfo) {
            const resolved = currentRefInfo.scenariosByTag.get(tag);
            if (resolved) {
              displayTitle = resolved;
            }
          }

          const scenId = `${uri.toString()}::scenario_${i}`;
          let scenNode: vscode.TestItem;

          const parent = currentRuleItem || fileTestItem;
          const existing = parent.children.get(scenId);
          if (existing) {
            scenNode = existing;
            scenNode.label = displayTitle;
          } else {
            scenNode = this.controller.createTestItem(scenId, displayTitle, uri);
            parent.children.add(scenNode);
          }

          // Gutter play icon on each Scenario!
          scenNode.range = new vscode.Range(
            new vscode.Position(i, 0),
            new vscode.Position(i, rawLine.length)
          );

          scenNode.description = tag ? tag.toUpperCase() : undefined;
          this.scenarioAddressMap.set(scenId, currentScenarioTarget);
          currentScenarioItem = scenNode;
          continue;
        }

        // 3. Status mark step: * mark status = passed | failed | pending | skipped | blocked
        const statusMatch = trimmed.match(/^\*\s+mark\s+status\s*=\s*([a-zA-Z]+)/i);
        if (statusMatch && currentScenarioItem) {
          const status = statusMatch[1].toLowerCase();
          this.scenarioStatusMap.set(currentScenarioItem.id, status);

          const tagPrefix = currentScenarioItem.description?.split(' ')[0] || '';
          currentScenarioItem.description = tagPrefix
            ? `${tagPrefix} [${status.toUpperCase()}]`
            : `[${status.toUpperCase()}]`;
        }
      }
    } catch {
      // ignore read errors
    }
  }

  private removeFileTests(uri: vscode.Uri): void {
    this.controller.items.delete(uri.toString());
  }

  private syncAllWithState(): void {
    for (const [, item] of this.controller.items) {
      if (item.uri) {
        this.updateFileTests(item.uri);
      }
    }
  }

  private async updateScenarioMarkInDocument(
    documentUri: vscode.Uri,
    scenarioLine: number,
    newStatus: string
  ): Promise<boolean> {
    try {
      const doc = await vscode.workspace.openTextDocument(documentUri);
      const edit = new vscode.WorkspaceEdit();

      let foundMarkLine = -1;
      const lineCount = doc.lineCount;

      for (let i = scenarioLine + 1; i < lineCount; i++) {
        const text = doc.lineAt(i).text;
        const trimmed = text.trim();
        if (/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario|Rule|Regla):/i.test(trimmed)) {
          break;
        }
        if (/^\*\s*mark\s+status\s*=/i.test(trimmed)) {
          foundMarkLine = i;
          break;
        }
      }

      if (foundMarkLine !== -1) {
        const existingLine = doc.lineAt(foundMarkLine);
        const indent = existingLine.text.match(/^\s*/)?.[0] || '      ';
        edit.replace(documentUri, existingLine.range, `${indent}* mark status = ${newStatus}`);
      } else {
        const scenLine = doc.lineAt(scenarioLine);
        const indent = (scenLine.text.match(/^\s*/)?.[0] || '    ') + '  ';
        edit.insert(documentUri, new vscode.Position(scenarioLine + 1, 0), `${indent}* mark status = ${newStatus}\n`);
      }

      const success = await vscode.workspace.applyEdit(edit);
      if (success) {
        await doc.save();
      }
      return success;
    } catch {
      return false;
    }
  }

  private async updateAllScenarioMarksInDocument(
    documentUri: vscode.Uri,
    newStatus: string
  ): Promise<boolean> {
    try {
      const doc = await vscode.workspace.openTextDocument(documentUri);
      const edit = new vscode.WorkspaceEdit();

      for (let i = 0; i < doc.lineCount; i++) {
        const text = doc.lineAt(i).text;
        const trimmed = text.trim();
        if (/^\*\s*mark\s+status\s*=/i.test(trimmed)) {
          const indent = text.match(/^\s*/)?.[0] || '      ';
          edit.replace(documentUri, doc.lineAt(i).range, `${indent}* mark status = ${newStatus}`);
        }
      }

      const success = await vscode.workspace.applyEdit(edit);
      if (success) {
        await doc.save();
      }
      return success;
    } catch {
      return false;
    }
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

      const uri = item.uri;
      if (!uri) continue;

      // Always reload latest text immediately before running so mark status is 100% current
      await this.updateFileTests(uri);

      const isScenario = item.id.includes('::scenario_');

      if (isScenario) {
        // Individual Scenario execution: prompt with form to choose status
        const targetAddress = this.scenarioAddressMap.get(item.id) || item.label;
        const scenLine = item.range ? item.range.start.line : 0;

        interface StatusOption extends vscode.QuickPickItem {
          status: string;
        }

        const statusOptions: StatusOption[] = [
          {
            label: '$(pass-filled) passed',
            detail: 'Scenario executed successfully and all assertions passed.',
            status: 'passed'
          },
          {
            label: '$(error) failed',
            detail: 'Assertion failure or execution error detected.',
            status: 'failed'
          },
          {
            label: '$(stop) blocked',
            detail: 'Execution blocked due to a preceding dependency failure.',
            status: 'blocked'
          },
          {
            label: '$(debug-step-over) skipped',
            detail: 'Execution skipped deliberately.',
            status: 'skipped'
          },
          {
            label: '$(history) pending',
            detail: 'Scenario pending execution or currently in development.',
            status: 'pending'
          }
        ];

        const selected = await vscode.window.showQuickPick(statusOptions, {
          placeHolder: `Select execution status for: ${item.label}`,
          title: `Testform: Record Execution Status`
        });

        if (!selected) {
          run.skipped(item);
          continue;
        }

        const chosenStatus = selected.status;

        // 1. Update the feature file with the chosen status
        await this.updateScenarioMarkInDocument(uri, scenLine, chosenStatus);

        // 2. Dispatch testform apply for this scenario target
        run.appendOutput(`[Testform] Running scenario target: ${targetAddress} (status: ${chosenStatus})\r\n`);
        run.started(item);
        runTestformCommand(`apply -auto-approve -target="${targetAddress}"`);

        // 3. Immediately reflect in memory and UI
        this.scenarioStatusMap.set(item.id, chosenStatus);
        const tagPrefix = item.description?.split(' ')[0] || '';
        item.description = tagPrefix
          ? `${tagPrefix} [${chosenStatus.toUpperCase()}]`
          : `[${chosenStatus.toUpperCase()}]`;

        if (chosenStatus === 'passed') {
          run.passed(item);
        } else if (chosenStatus === 'failed') {
          run.failed(item, new vscode.TestMessage(`Scenario marked as failed by user.`));
        } else if (chosenStatus === 'skipped' || chosenStatus === 'blocked') {
          run.skipped(item);
        } else {
          run.enqueued(item);
        }
      } else {
        // Feature / Full Testrun execution
        const relPath = rootPath ? path.relative(rootPath, uri.fsPath).replace(/\\/g, '/') : path.basename(uri.fsPath);

        const featureOptions: vscode.QuickPickItem[] = [
          {
            label: '$(play) Apply current state',
            detail: 'Reconcile state ledger preserving existing marks (* mark status) defined in file.'
          },
          {
            label: '$(pass-filled) Mark all as passed and apply',
            detail: 'Set all scenarios in this suite to passed and run apply.'
          },
          {
            label: '$(history) Reset all to pending and apply',
            detail: 'Reset all scenarios in this suite to pending and run apply.'
          }
        ];

        const featChoice = await vscode.window.showQuickPick(featureOptions, {
          placeHolder: `Select execution mode for suite: ${item.label}`,
          title: `Testform Suite: ${item.label}`
        });

        if (!featChoice) {
          run.skipped(item);
          continue;
        }

        if (featChoice.label.includes('passed')) {
          await this.updateAllScenarioMarksInDocument(uri, 'passed');
        } else if (featChoice.label.includes('pending')) {
          await this.updateAllScenarioMarksInDocument(uri, 'pending');
        }

        run.appendOutput(`[Testform] Running testrun suite: ${relPath}\r\n`);
        run.started(item);

        runTestformCommand(`apply -auto-approve -target="${relPath}"`);

        await this.updateFileTests(uri);

        let hasFailures = false;
        const reportChildren = (parent: vscode.TestItem) => {
          parent.children.forEach(child => {
            if (child.id.includes('::scenario_')) {
              run.started(child);
              const status = this.scenarioStatusMap.get(child.id);
              if (status === 'passed') {
                run.passed(child);
              } else if (status === 'failed') {
                hasFailures = true;
                run.failed(child, new vscode.TestMessage('Testcase failed in Testform run ledger.'));
              } else if (status === 'skipped' || status === 'blocked') {
                run.skipped(child);
              } else {
                run.enqueued(child);
              }
            } else {
              reportChildren(child);
            }
          });
        };

        reportChildren(item);

        if (hasFailures) {
          run.failed(item, new vscode.TestMessage('One or more scenarios in the suite failed.'));
        } else {
          run.passed(item);
        }
      }
    }

    run.end();
  }
}
