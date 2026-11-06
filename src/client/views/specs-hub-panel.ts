import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runTestformCommand } from '../terminal';
import { detectProjectCustomFields, DetectedField } from '../field-detector';

export interface TestCaseItem {
  tag?: string;
  title: string;
  line: number;
  tags: string[];
  fields?: Record<string, string>;
}

export interface FeatureFileItem {
  uri: vscode.Uri;
  fsPath: string;
  relPath: string;
  title: string;
  line: number;
  tags: string[];
  scenarios: TestCaseItem[];
}

export interface TestRunSuiteItem {
  uri: vscode.Uri;
  fsPath: string;
  relPath: string;
  title: string;
  line: number;
  tags: string[];
  rules: {
    title: string;
    line: number;
    scenarios: string[];
  }[];
}

export interface TestPlanItem {
  uri: vscode.Uri;
  fsPath: string;
  relPath: string;
  title: string;
  line: number;
  tags: string[];
  runs: {
    title: string;
    line: number;
  }[];
}

export interface StateReportData {
  hasState: boolean;
  version?: number;
  serial?: number;
  lineage?: string;
  statePath?: string;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  blocked: number;
  skipped: number;
  runs: any[];
  cases: any[];
  plans: any[];
  bugs: any[];
  outputs: Record<string, any>;
}

export class SpecsHubPanel {
  public static currentPanel: SpecsHubPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  public currentMode: 'state' | 'files' = 'state';

  public static createOrShow(extensionUri: vscode.Uri, initialMode: 'state' | 'files' = 'state'): SpecsHubPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn || vscode.ViewColumn.One
      : vscode.ViewColumn.One;

    if (SpecsHubPanel.currentPanel) {
      SpecsHubPanel.currentPanel._panel.reveal(column);
      SpecsHubPanel.currentPanel.currentMode = initialMode;
      SpecsHubPanel.currentPanel.refresh();
      return SpecsHubPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'testformSpecsHub',
      'Testform Hub (State & Files)',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    SpecsHubPanel.currentPanel = new SpecsHubPanel(panel, extensionUri, initialMode);
    return SpecsHubPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, initialMode: 'state' | 'files' = 'state') {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this.currentMode = initialMode;

    const iconPath = vscode.Uri.joinPath(this._extensionUri, 'assets', 'icon.svg');
    this._panel.iconPath = iconPath;

    this.refresh();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'openFile': {
            if (message.fsPath) {
              const uri = vscode.Uri.file(message.fsPath);
              const line = typeof message.line === 'number' ? message.line : 0;
              const doc = await vscode.workspace.openTextDocument(uri);
              await vscode.window.showTextDocument(doc, {
                selection: new vscode.Range(line, 0, line, 0),
                viewColumn: vscode.ViewColumn.One
              });
            }
            break;
          }
          case 'switchMode': {
            if (message.mode === 'state' || message.mode === 'files') {
              this.currentMode = message.mode;
              this.refresh();
            }
            break;
          }
          case 'refresh': {
            this.refresh();
            break;
          }
          case 'runApply': {
            vscode.commands.executeCommand('testform.apply');
            break;
          }
          case 'runPlan': {
            vscode.commands.executeCommand('testform.plan');
            break;
          }
          case 'exportReport': {
            const slug = message.slug || 'testcase-summary';
            const fmt = message.format || 'xlsx';
            let fieldsArg = '';
            if (message.fields === 'all') {
              fieldsArg = ' --fields="all"';
            } else if (message.fields === 'none') {
              fieldsArg = ' --fields="none"';
            } else if (Array.isArray(message.fields) && message.fields.length > 0) {
              fieldsArg = ` --fields="${message.fields.join(',')}"`;
            }
            runTestformCommand(`report ${slug} -format=${fmt}${fieldsArg}`);
            break;
          }
        }
      },
      null,
      this._disposables
    );

    const watcher = vscode.workspace.createFileSystemWatcher('**/*.feature');
    watcher.onDidChange(() => this.refresh());
    watcher.onDidCreate(() => this.refresh());
    watcher.onDidDelete(() => this.refresh());
    this._disposables.push(watcher);

    const stateWatcher = vscode.workspace.createFileSystemWatcher('**/testform.state');
    stateWatcher.onDidChange(() => this.refresh());
    stateWatcher.onDidCreate(() => this.refresh());
    stateWatcher.onDidDelete(() => this.refresh());
    this._disposables.push(stateWatcher);
  }

  public async refresh(): Promise<void> {
    const filesData = await this.scanSpecs();
    const stateData = await this.scanState();
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const detectedFields = rootPath ? detectProjectCustomFields(rootPath) : [];
    this._panel.webview.html = this.renderHtml(filesData, stateData, detectedFields);
  }

  public dispose(): void {
    SpecsHubPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  private async scanState(): Promise<StateReportData> {
    const empty: StateReportData = {
      hasState: false,
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      blocked: 0,
      skipped: 0,
      runs: [],
      cases: [],
      plans: [],
      bugs: [],
      outputs: {}
    };

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return empty;

    const rootPath = workspaceFolders[0].uri.fsPath;
    const statePath = path.join(rootPath, 'testform.state');
    if (!fs.existsSync(statePath)) return empty;

    try {
      const raw = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      const resources: any[] = parsed.resources || [];
      const outputs: Record<string, any> = parsed.outputs || {};

      let passed = 0;
      let failed = 0;
      let pending = 0;
      let blocked = 0;
      let skipped = 0;

      const runs: any[] = [];
      const cases: any[] = [];
      const plans: any[] = [];
      const bugs: any[] = [];

      for (const r of resources) {
        const type = (r.type || '').toLowerCase();
        const attrs = r.attributes || {};
        const st = String(attrs.status || attrs.execution?.status || 'pending').toLowerCase();

        if (st === 'passed') passed++;
        else if (st === 'failed') failed++;
        else if (st === 'blocked') blocked++;
        else if (st === 'skipped') skipped++;
        else pending++;

        if (type.includes('testrun')) runs.push(r);
        else if (type.includes('testplan')) plans.push(r);
        else if (type.includes('bug')) bugs.push(r);
        else cases.push(r);
      }

      return {
        hasState: true,
        version: parsed.version || 1,
        serial: parsed.serial ?? 1,
        lineage: parsed.lineage,
        statePath,
        total: resources.length,
        passed,
        failed,
        pending,
        blocked,
        skipped,
        runs,
        cases,
        plans,
        bugs,
        outputs
      };
    } catch {
      return empty;
    }
  }

  private async scanSpecs(): Promise<{
    testcases: FeatureFileItem[];
    testruns: TestRunSuiteItem[];
    testplans: TestPlanItem[];
  }> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return { testcases: [], testruns: [], testplans: [] };
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const files = await vscode.workspace.findFiles('**/*.feature', '**/node_modules/**');

    const testcases: FeatureFileItem[] = [];
    const testruns: TestRunSuiteItem[] = [];
    const testplans: TestPlanItem[] = [];

    for (const uri of files) {
      try {
        const content = fs.readFileSync(uri.fsPath, 'utf8');
        const lines = content.split(/\r?\n/);
        const relPath = path.relative(rootPath, uri.fsPath).replace(/\\/g, '/');
        const lowerName = path.basename(uri.fsPath).toLowerCase();

        let scope: 'testcase' | 'testrun' | 'testplan' | 'bug' = 'testcase';
        if (lowerName.includes('.run.feature')) scope = 'testrun';
        else if (lowerName.includes('.plan.feature')) scope = 'testplan';
        else if (lowerName.includes('.bug.feature')) scope = 'bug';

        for (let i = 0; i < Math.min(lines.length, 15); i++) {
          const l = lines[i].trim();
          if (l.includes('@testrun')) scope = 'testrun';
          else if (l.includes('@testplan')) scope = 'testplan';
          else if (l.includes('@testcase')) scope = 'testcase';
          else if (l.includes('@bug')) scope = 'bug';
        }

        let featureTitle = path.basename(uri.fsPath);
        let featureLine = 0;
        const fileTags: string[] = [];

        for (let i = 0; i < lines.length; i++) {
          const l = lines[i].trim();
          if (l.startsWith('@') && i < 10) {
            fileTags.push(...l.split(/\s+/).filter(t => t.startsWith('@')));
          }
          const featMatch = lines[i].match(/^(?:Feature|Característica):\s*(.+)$/i);
          if (featMatch) {
            featureTitle = featMatch[1].trim();
            featureLine = i;
            break;
          }
        }

        if (scope === 'testcase' || scope === 'bug') {
          const scenarios: TestCaseItem[] = [];
          let pendingTags: string[] = [];

          for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const trimmed = raw.trim();
            if (trimmed.startsWith('#')) continue;

            if (trimmed.startsWith('@')) {
              pendingTags.push(...trimmed.split(/\s+/).filter(t => t.startsWith('@')));
              continue;
            }

            const scenMatch = trimmed.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.+)$/i);
            if (scenMatch) {
              const scTitle = scenMatch[1].trim();
              const tag = pendingTags.find(t => /^@(tc|bg)-[0-9]+/i.test(t));
              const scFields: Record<string, string> = {};

              // Extract key=value from tags
              for (const pt of pendingTags) {
                const eqIdx = pt.indexOf('=');
                if (eqIdx !== -1) {
                  const k = pt.slice(1, eqIdx).trim().toLowerCase();
                  const v = pt.slice(eqIdx + 1).trim();
                  if (k && v) scFields[k] = v;
                }
              }

              // Extract fields from subsequent steps
              for (let k = i + 1; k < lines.length; k++) {
                const sLine = lines[k].trim();
                if (!sLine || sLine.startsWith('#')) continue;
                if (/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario|Rule|Regla|Feature|Característica):/i.test(sLine)) {
                  break;
                }
                const fieldMatch = sLine.match(/^(?:\*\s*)?field\s+([a-zA-Z0-9_-]+)\s*=\s*(.*)$/i);
                if (fieldMatch) {
                  scFields[fieldMatch[1].toLowerCase()] = fieldMatch[2].trim().replace(/^["']|["']$/g, '');
                }
                const markMatch = sLine.match(/^(?:\*\s*)?mark\s+([a-zA-Z0-9_-]+)\s*=\s*(.*)$/i);
                if (markMatch) {
                  scFields[markMatch[1].toLowerCase()] = markMatch[2].trim().replace(/^["']|["']$/g, '');
                }
              }

              scenarios.push({
                tag,
                title: scTitle,
                line: i,
                tags: [...pendingTags],
                fields: scFields
              });
              pendingTags = [];
            }
          }

          testcases.push({
            uri,
            fsPath: uri.fsPath,
            relPath,
            title: featureTitle,
            line: featureLine,
            tags: fileTags,
            scenarios
          });
        } else if (scope === 'testrun') {
          const rules: TestRunSuiteItem['rules'] = [];
          let currentRule: { title: string; line: number; scenarios: string[] } | null = null;

          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('#')) continue;

            const ruleMatch = trimmed.match(/^(?:Rule|Regla):\s*(.+)$/i);
            if (ruleMatch) {
              currentRule = {
                title: ruleMatch[1].trim(),
                line: i,
                scenarios: []
              };
              rules.push(currentRule);
              continue;
            }

            const scenMatch = trimmed.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.+)$/i);
            if (scenMatch) {
              const scTitle = scenMatch[1].trim();
              if (currentRule) {
                currentRule.scenarios.push(scTitle);
              } else {
                let suiteRule = rules.find(r => r.title === '(Direct Scenarios)');
                if (!suiteRule) {
                  suiteRule = { title: '(Direct Scenarios)', line: i, scenarios: [] };
                  rules.push(suiteRule);
                }
                suiteRule.scenarios.push(scTitle);
              }
            }
          }

          testruns.push({
            uri,
            fsPath: uri.fsPath,
            relPath,
            title: featureTitle,
            line: featureLine,
            tags: fileTags,
            rules
          });
        } else if (scope === 'testplan') {
          const runs: TestPlanItem['runs'] = [];

          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('#')) continue;

            const ruleMatch = trimmed.match(/^(?:Rule|Regla):\s*(.+)$/i);
            if (ruleMatch) {
              runs.push({
                title: ruleMatch[1].trim(),
                line: i
              });
            }
          }

          testplans.push({
            uri,
            fsPath: uri.fsPath,
            relPath,
            title: featureTitle,
            line: featureLine,
            tags: fileTags,
            runs
          });
        }
      } catch {}
    }

    testcases.sort((a, b) => a.relPath.localeCompare(b.relPath));
    testruns.sort((a, b) => a.relPath.localeCompare(b.relPath));
    testplans.sort((a, b) => a.relPath.localeCompare(b.relPath));

    return { testcases, testruns, testplans };
  }

  private renderHtml(
    filesData: {
      testcases: FeatureFileItem[];
      testruns: TestRunSuiteItem[];
      testplans: TestPlanItem[];
    },
    stateData: StateReportData,
    detectedFields: DetectedField[] = []
  ): string {
    const totalFilesCases = filesData.testcases.reduce((sum, f) => sum + f.scenarios.length, 0);
    const totalFilesRuns = filesData.testruns.length;
    const totalFilesPlans = filesData.testplans.length;

    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const mode = this.currentMode;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Testform Hub</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --card-bg: var(--vscode-sideBar-background, rgba(128,128,128,0.06));
      --border: var(--vscode-panel-border, rgba(128,128,128,0.2));
      --accent: var(--vscode-button-background, #007acc);
      --accent-fg: var(--vscode-button-foreground, #fff);
      --badge-bg: var(--vscode-badge-background, #007acc);
      --badge-fg: var(--vscode-badge-foreground, #fff);
      --hover-bg: var(--vscode-list-hoverBackground, rgba(128,128,128,0.1));
      --pass: #22c55e;
      --fail: #ef4444;
      --warn: #eab308;
      --info: #3b82f6;
    }
    * { box-sizing: border-box; }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      margin: 0;
      padding: 24px 32px;
      font-size: 13px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
    }
    .subtitle {
      color: var(--vscode-descriptionForeground, #888);
      font-size: 12px;
      margin-top: 2px;
    }
    .mode-switch {
      display: inline-flex;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 3px;
      gap: 3px;
    }
    .mode-btn {
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground, #888);
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .mode-btn.active {
      background: var(--accent);
      color: var(--accent-fg);
    }
    .header-actions {
      display: flex;
      gap: 10px;
    }
    .btn {
      background: var(--accent);
      color: var(--accent-fg);
      border: none;
      padding: 7px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
    }
    .btn-secondary:hover {
      background: var(--hover-bg);
    }
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px 16px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .kpi-card:hover, .kpi-card.active {
      border-color: var(--accent);
      background: var(--hover-bg);
    }
    .kpi-title {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 6px;
    }
    .kpi-value {
      font-size: 26px;
      font-weight: 700;
      line-height: 1.1;
      margin-bottom: 4px;
    }
    .kpi-sub {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .filter-bar {
      margin-bottom: 16px;
    }
    .filter-input {
      width: 100%;
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 13px;
      outline: none;
    }
    .filter-input:focus {
      border-color: var(--accent);
    }
    .tab-nav {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      padding: 8px 16px;
      cursor: pointer;
      color: var(--vscode-descriptionForeground, #888);
      font-size: 13px;
      font-weight: 500;
    }
    .tab-btn.active {
      color: var(--fg);
      border-bottom-color: var(--accent);
    }
    .spec-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      margin-bottom: 14px;
      overflow: hidden;
    }
    .spec-header {
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(128, 128, 128, 0.04);
      cursor: pointer;
    }
    .spec-title-area {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .spec-title {
      font-weight: 600;
      font-size: 14px;
    }
    .spec-path {
      color: var(--vscode-descriptionForeground, #888);
      font-size: 11px;
      font-family: monospace;
    }
    .tag {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: 500;
      background: rgba(99, 102, 241, 0.15);
      color: #818cf8;
      margin-right: 4px;
    }
    .field-pill {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-family: var(--vscode-editor-font-family, monospace);
      background: rgba(14, 165, 233, 0.12);
      color: #38bdf8;
      border: 1px solid rgba(14, 165, 233, 0.25);
      margin-right: 4px;
      margin-top: 3px;
    }
    .status-pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .status-passed { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
    .status-failed { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
    .status-pending { background: rgba(234, 179, 8, 0.2); color: #eab308; }
    .status-blocked { background: rgba(168, 85, 247, 0.2); color: #a855f7; }
    .status-skipped { background: rgba(148, 163, 184, 0.2); color: #94a3b8; }
    .scenario-list {
      padding: 0;
      margin: 0;
      list-style: none;
    }
    .scenario-item {
      padding: 10px 16px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .scenario-item:hover {
      background: var(--hover-bg);
    }
    .jump-btn {
      background: none;
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
    }
    .jump-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
    .empty-state {
      text-align: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .state-banner {
      background: rgba(59, 130, 246, 0.1);
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 6px;
      padding: 10px 16px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
    }
    /* Export Drawer */
    .export-drawer {
      background: var(--card-bg);
      border: 1px solid var(--accent);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 24px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .export-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .btn-close {
      background: none;
      border: none;
      color: var(--fg);
      font-size: 14px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .btn-close:hover {
      background: var(--hover-bg);
    }
    .export-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 14px;
    }
    @media (max-width: 640px) {
      .export-grid { grid-template-columns: 1fr; }
    }
    .export-col {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .export-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--fg);
    }
    .export-select {
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 12px;
      outline: none;
    }
    .export-select:focus {
      border-color: var(--accent);
    }
    .format-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip-label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 5px 9px;
      font-size: 11px;
      cursor: pointer;
      user-select: none;
    }
    .chip-label:hover {
      background: var(--hover-bg);
      border-color: var(--accent);
    }
    .chip-label input[type="radio"] {
      margin: 0;
      cursor: pointer;
    }
    .export-fields-box {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 14px;
    }
    .export-fields-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .fields-actions {
      display: flex;
      gap: 8px;
    }
    .mini-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      cursor: pointer;
    }
    .mini-btn:hover {
      background: var(--hover-bg);
      border-color: var(--accent);
    }
    .fields-checklist {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      max-height: 140px;
      overflow-y: auto;
      padding: 4px 0;
    }
    .field-check-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
      transition: all 0.1s ease;
    }
    .field-check-item:hover {
      border-color: var(--accent);
      background: var(--hover-bg);
    }
    .field-check-item input[type="checkbox"] {
      margin: 0;
      cursor: pointer;
      accent-color: var(--accent);
    }
    .field-badge {
      font-size: 10px;
      background: var(--hover-bg);
      padding: 1px 5px;
      border-radius: 10px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .export-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding-top: 6px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <div>
        <h1>Testform Hub</h1>
        <div class="subtitle">${mode === 'state' ? 'State Ledger Explorer (testform.state)' : 'Workspace Source Specifications (*.feature)'}</div>
      </div>
      <div class="mode-switch">
        <button class="mode-btn ${mode === 'state' ? 'active' : ''}" onclick="switchMode('state')">
          🗄️ State (${stateData.total})
        </button>
        <button class="mode-btn ${mode === 'files' ? 'active' : ''}" onclick="switchMode('files')">
          📁 Files (${totalFilesCases + totalFilesRuns + totalFilesPlans})
        </button>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn btn-secondary" onclick="toggleExportBar()">📊 Export Report</button>
      <button class="btn btn-secondary" onclick="sendMessage('refresh')">↻ Refresh</button>
      <button class="btn btn-secondary" onclick="sendMessage('runPlan')">🔍 Speculative Plan</button>
      <button class="btn" onclick="sendMessage('runApply')">▶ Run Apply</button>
    </div>
  </div>

  <!-- EXPORT REPORT DRAWER -->
  <div id="exportBar" class="export-drawer" style="display: none;">
    <div class="export-header">
      <div style="font-weight: 600; font-size: 13px;">📊 Quality Reports Generator</div>
      <button class="btn-close" onclick="toggleExportBar()">✕</button>
    </div>
    <div class="export-grid">
      <div class="export-col">
        <label class="export-label">Report Type:</label>
        <select id="exportSlug" class="export-select">
          <option value="testcase-summary" selected>Test Case Summary (testcase-summary)</option>
          <option value="testrun-summary">Test Run Summary (testrun-summary)</option>
          <option value="testrun-detailed">Detailed Test Runs (testrun-detailed)</option>
          <option value="testplan-summary">Test Plan Summary (testplan-summary)</option>
          <option value="defects">Defect Backlog (defects)</option>
          <option value="traceability">Traceability Matrix (traceability)</option>
          <option value="coverage">Coverage Matrix (coverage)</option>
          <option value="two-dimensional">Two-Dimensional Matrix (two-dimensional)</option>
          <option value="test-case-activity">Automation & Activity (test-case-activity)</option>
        </select>
      </div>
      <div class="export-col">
        <label class="export-label">Output Format:</label>
        <div class="format-chips">
          <label class="chip-label"><input type="radio" name="exportFormat" value="md" checked> <span>📝 Markdown (.md)</span></label>
          <label class="chip-label"><input type="radio" name="exportFormat" value="xlsx"> <span>📊 Excel (.xlsx)</span></label>
          <label class="chip-label"><input type="radio" name="exportFormat" value="docx"> <span>📄 Word (.docx)</span></label>
          <label class="chip-label"><input type="radio" name="exportFormat" value="csv"> <span>📑 CSV (.csv)</span></label>
          <label class="chip-label"><input type="radio" name="exportFormat" value="json"> <span>{ } JSON</span></label>
        </div>
      </div>
    </div>

    <div class="export-fields-box">
      <div class="export-fields-header">
        <div class="export-label" style="margin-bottom: 0;">
          Custom Fields (Additional columns):
        </div>
        <div class="fields-actions">
          <button class="mini-btn" type="button" onclick="selectAllFields(true)">✓ Select All</button>
          <button class="mini-btn" type="button" onclick="selectAllFields(false)">✕ Deselect All</button>
        </div>
      </div>
      <div class="fields-checklist">
        ${
          detectedFields.length === 0
            ? '<span style="color: var(--vscode-descriptionForeground, #888); font-size: 11px;">No custom fields detected in project (native columns will be used).</span>'
            : detectedFields.map(f => `
                <label class="field-check-item">
                  <input type="checkbox" name="customField" value="${escape(f.name)}" checked>
                  <strong>${escape(f.name)}</strong>
                  <span class="field-badge">${f.count} ${f.count === 1 ? 'case' : 'cases'}</span>
                </label>
              `).join('')
        }
      </div>
    </div>

    <div class="export-footer">
      <div style="font-size: 11px; color: var(--vscode-descriptionForeground, #888);">
        Selected custom fields will be included as extra columns in the report.
      </div>
      <button class="btn" style="padding: 7px 18px;" onclick="doExportReport()">
        🚀 Generate and Open Report
      </button>
    </div>
  </div>

  ${
    mode === 'state'
      ? `
  <!-- STATE DASHBOARD -->
  <div class="state-banner">
    <div>
      <strong>Ledger:</strong> <code>testform.state</code> (Format v${stateData.version || 1} • Serial ${stateData.serial ?? 1} • Lineage: ${stateData.lineage ? stateData.lineage.slice(0, 8) + '...' : 'default'})
    </div>
    <div style="color: #3b82f6; font-weight: 500;">
      ${stateData.hasState ? '● State Loaded &amp; Synced' : '○ No state file found (run testform apply)'}
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi-card" id="kpi-st-runs" onclick="switchStateTab('runs')">
      <div class="kpi-title">🚀 Test Runs</div>
      <div class="kpi-value">${stateData.runs.length}</div>
      <div class="kpi-sub">Reconciled execution cycles</div>
    </div>
    <div class="kpi-card" id="kpi-st-cases" onclick="switchStateTab('cases')">
      <div class="kpi-title">🧪 Test Cases</div>
      <div class="kpi-value">${stateData.cases.length}</div>
      <div class="kpi-sub">Managed state resources</div>
    </div>
    <div class="kpi-card" id="kpi-st-passed" onclick="switchStateTab('cases')">
      <div class="kpi-title" style="color: #22c55e;">✔ Passed</div>
      <div class="kpi-value" style="color: #22c55e;">${stateData.passed}</div>
      <div class="kpi-sub">${stateData.total > 0 ? Math.round((stateData.passed / stateData.total) * 100) : 0}% success rate</div>
    </div>
    <div class="kpi-card" id="kpi-st-failed" onclick="switchStateTab('bugs')">
      <div class="kpi-title" style="color: #ef4444;">✖ Failed / Blocked</div>
      <div class="kpi-value" style="color: #ef4444;">${stateData.failed + stateData.blocked}</div>
      <div class="kpi-sub">${stateData.bugs.length} defect items</div>
    </div>
  </div>

  <div class="filter-bar">
    <input type="text" id="stateSearchInput" class="filter-input" placeholder="Search state resources by title, address, status, or tag..." oninput="filterStateResources()">
  </div>

  <div class="tab-nav">
    <button class="tab-btn active" id="tab-btn-st-runs" onclick="switchStateTab('runs')">Test Runs (${stateData.runs.length})</button>
    <button class="tab-btn" id="tab-btn-st-cases" onclick="switchStateTab('cases')">Test Cases (${stateData.cases.length})</button>
    <button class="tab-btn" id="tab-btn-st-plans" onclick="switchStateTab('plans')">Test Plans (${stateData.plans.length})</button>
    <button class="tab-btn" id="tab-btn-st-bugs" onclick="switchStateTab('bugs')">Bugs (${stateData.bugs.length})</button>
  </div>

  <!-- SECTION: STATE TEST RUNS -->
  <div id="section-st-runs" class="state-section">
    ${
      stateData.runs.length === 0
        ? `<div class="empty-state">No test runs found in state ledger. Run <code>testform apply</code> to execute and persist runs.</div>`
        : stateData.runs.map(r => {
            const attrs = r.attributes || {};
            const st = String(attrs.status || 'pending').toLowerCase();
            const cases = attrs.testcases || attrs.testcaseStatuses || [];
            const casesArr = Array.isArray(cases) ? cases : Object.keys(cases);
            return `
      <div class="spec-card state-card" data-search="${escape((attrs.title || r.identity || '').toLowerCase())} ${escape(st)}">
        <div class="spec-header">
          <div class="spec-title-area">
            <span style="font-size:16px;">🚀</span>
            <div>
              <div class="spec-title">${escape(attrs.title || r.identity)}</div>
              <div class="spec-path">${escape(r.identity || '')} ${attrs.remoteId ? `(${escape(attrs.remoteId)})` : ''}</div>
            </div>
          </div>
          <div>
            <span class="status-pill status-${st}">${st}</span>
          </div>
        </div>
        ${
          casesArr.length > 0
            ? `<ul class="scenario-list">
                ${casesArr.map((c: any) => {
                  const cAddr = typeof c === 'string' ? c : c.identity || '';
                  const cSt = String(typeof c === 'object' && c.status ? c.status : 'pending').toLowerCase();
                  return `
                <li class="scenario-item">
                  <div>
                    <span class="status-pill status-${cSt}">${cSt}</span>
                    <span style="font-weight: 500; margin-left: 8px;">${escape(cAddr)}</span>
                  </div>
                </li>`;
                }).join('')}
              </ul>`
            : ''
        }
      </div>`;
          }).join('')
    }
  </div>

  <!-- SECTION: STATE TEST CASES -->
  <div id="section-st-cases" class="state-section" style="display:none;">
    ${
      stateData.cases.length === 0
        ? `<div class="empty-state">No test cases found in state.</div>`
        : stateData.cases.map(c => {
            const attrs = c.attributes || {};
            const st = String(attrs.status || 'pending').toLowerCase();
            const customFields = (attrs.custom_fields || attrs.fields || {}) as Record<string, any>;
            const fieldEntries = Object.entries(customFields);
            const searchTerms = `${escape((attrs.title || c.identity || '').toLowerCase())} ${escape(st)} ${escape((attrs.labels || []).join(' ')).toLowerCase()} ${fieldEntries.map(([k, v]) => `${k} ${v}`).join(' ').toLowerCase()}`;
            return `
      <div class="spec-card state-card" data-search="${searchTerms}">
        <div class="spec-header">
          <div class="spec-title-area">
            <span style="font-size:16px;">🧪</span>
            <div>
              <div class="spec-title">${escape(attrs.title || c.identity)}</div>
              <div class="spec-path">${escape(c.identity || '')}</div>
              ${
                fieldEntries.length > 0
                  ? `<div style="margin-top: 4px;">
                      ${fieldEntries.map(([k, v]) => `<span class="field-pill"><strong>${escape(k)}:</strong> ${escape(String(v))}</span>`).join('')}
                     </div>`
                  : ''
              }
            </div>
          </div>
          <div>
            ${(attrs.labels || []).map((l: string) => `<span class="tag">${escape(l)}</span>`).join('')}
            <span class="status-pill status-${st}">${st}</span>
          </div>
        </div>
      </div>`;
          }).join('')
    }
  </div>

  <!-- SECTION: STATE TEST PLANS -->
  <div id="section-st-plans" class="state-section" style="display:none;">
    ${
      stateData.plans.length === 0
        ? `<div class="empty-state">No test plans found in state.</div>`
        : stateData.plans.map(p => {
            const attrs = p.attributes || {};
            const linked = attrs.testruns || [];
            return `
      <div class="spec-card state-card" data-search="${escape((attrs.title || p.identity || '').toLowerCase())}">
        <div class="spec-header">
          <div class="spec-title-area">
            <span style="font-size:16px;">📋</span>
            <div>
              <div class="spec-title">${escape(attrs.title || p.identity)}</div>
              <div class="spec-path">${escape(p.identity || '')}</div>
            </div>
          </div>
          <div>
            <span class="tag">${linked.length} runs linked</span>
          </div>
        </div>
      </div>`;
          }).join('')
    }
  </div>

  <!-- SECTION: STATE BUGS -->
  <div id="section-st-bugs" class="state-section" style="display:none;">
    ${
      stateData.bugs.length === 0
        ? `<div class="empty-state">No defects recorded in state ledger.</div>`
        : stateData.bugs.map(b => {
            const attrs = b.attributes || {};
            const st = String(attrs.status || 'open').toLowerCase();
            const customFields = (attrs.custom_fields || attrs.fields || {}) as Record<string, any>;
            const fieldEntries = Object.entries(customFields);
            if (attrs.severity && !customFields['severity']) fieldEntries.unshift(['severity', attrs.severity]);
            if (attrs.priority && !customFields['priority']) fieldEntries.unshift(['priority', attrs.priority]);
            const searchTerms = `${escape((attrs.title || b.identity || '').toLowerCase())} ${fieldEntries.map(([k, v]) => `${k} ${v}`).join(' ').toLowerCase()}`;
            return `
      <div class="spec-card state-card" data-search="${searchTerms}">
        <div class="spec-header">
          <div class="spec-title-area">
            <span style="font-size:16px;">🐛</span>
            <div>
              <div class="spec-title">${escape(attrs.title || b.identity)}</div>
              <div class="spec-path">${escape(b.identity || '')}</div>
              ${
                fieldEntries.length > 0
                  ? `<div style="margin-top: 4px;">
                      ${fieldEntries.map(([k, v]) => `<span class="field-pill"><strong>${escape(k)}:</strong> ${escape(String(v))}</span>`).join('')}
                     </div>`
                  : ''
              }
            </div>
          </div>
          <div>
            <span class="status-pill status-failed">${st}</span>
          </div>
        </div>
      </div>`;
          }).join('')
    }
  </div>
      `
      : `
  <!-- FILES DASHBOARD -->
  <div class="kpi-row">
    <div class="kpi-card active" id="kpi-testcases" onclick="switchFilesTab('testcases')">
      <div class="kpi-title">🧪 Test Cases</div>
      <div class="kpi-value">${totalFilesCases}</div>
      <div class="kpi-sub">${filesData.testcases.length} feature files registered</div>
    </div>
    <div class="kpi-card" id="kpi-testruns" onclick="switchFilesTab('testruns')">
      <div class="kpi-title">🚀 Test Runs</div>
      <div class="kpi-value">${totalFilesRuns}</div>
      <div class="kpi-sub">Execution suites &amp; target rules</div>
    </div>
    <div class="kpi-card" id="kpi-testplans" onclick="switchFilesTab('testplans')">
      <div class="kpi-title">📋 Test Plans</div>
      <div class="kpi-value">${totalFilesPlans}</div>
      <div class="kpi-sub">Release governance plans</div>
    </div>
  </div>

  <div class="filter-bar">
    <input type="text" id="searchInput" class="filter-input" placeholder="Search specs by feature, scenario name, or tag (e.g. @smoke, @tc-1)..." oninput="filterFilesSpecs()">
  </div>

  <div class="tab-nav">
    <button class="tab-btn active" id="tab-btn-testcases" onclick="switchFilesTab('testcases')">Test Cases (${totalFilesCases})</button>
    <button class="tab-btn" id="tab-btn-testruns" onclick="switchFilesTab('testruns')">Test Runs (${totalFilesRuns})</button>
    <button class="tab-btn" id="tab-btn-testplans" onclick="switchFilesTab('testplans')">Test Plans (${totalFilesPlans})</button>
  </div>

  <!-- SECTION 1: TEST CASES -->
  <div id="section-testcases" class="spec-section">
    ${
      filesData.testcases.length === 0
        ? `<div class="empty-state">No test case feature files found (*.case.feature or @testcase)</div>`
        : filesData.testcases.map(f => {
            const allFieldsSearch = f.scenarios
              .map(s => Object.entries(s.fields || {}).map(([k, v]) => `${k} ${v}`).join(' '))
              .join(' ')
              .toLowerCase();
            return `
      <div class="spec-card file-card" data-search="${escape(f.title.toLowerCase())} ${escape(f.relPath.toLowerCase())} ${escape(f.scenarios.map(s => s.title + ' ' + (s.tag || '')).join(' ').toLowerCase())} ${escape(allFieldsSearch)}">
        <div class="spec-header" onclick="openFile('${escape(f.fsPath.replace(/\\/g, '\\\\'))}', ${f.line})">
          <div class="spec-title-area">
            <span style="font-size:16px;">📄</span>
            <div>
              <div class="spec-title">${escape(f.title)}</div>
              <div class="spec-path">${escape(f.relPath)}</div>
            </div>
          </div>
          <div>
            ${f.tags.map(t => `<span class="tag">${escape(t)}</span>`).join('')}
            <button class="jump-btn" onclick="event.stopPropagation(); openFile('${escape(f.fsPath.replace(/\\/g, '\\\\'))}', ${f.line})">Open File</button>
          </div>
        </div>
        <ul class="scenario-list">
          ${f.scenarios.map(sc => {
            const fieldEntries = Object.entries(sc.fields || {});
            return `
            <li class="scenario-item">
              <div>
                ${sc.tag ? `<span class="tag" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">${escape(sc.tag)}</span>` : ''}
                <span style="font-weight: 500;">${escape(sc.title)}</span>
                ${
                  fieldEntries.length > 0
                    ? `<div style="margin-top: 4px;">
                        ${fieldEntries.map(([k, v]) => `<span class="field-pill"><strong>${escape(k)}:</strong> ${escape(v)}</span>`).join('')}
                       </div>`
                    : ''
                }
              </div>
              <button class="jump-btn" onclick="openFile('${escape(f.fsPath.replace(/\\/g, '\\\\'))}', ${sc.line})">Line ${sc.line + 1}</button>
            </li>`;
          }).join('')}
        </ul>
      </div>`;
          }).join('')
    }
  </div>

  <!-- SECTION 2: TEST RUNS -->
  <div id="section-testruns" class="spec-section" style="display:none;">
    ${
      filesData.testruns.length === 0
        ? `<div class="empty-state">No test run feature files found (*.run.feature or @testrun)</div>`
        : filesData.testruns.map(r => `
      <div class="spec-card file-card" data-search="${escape(r.title.toLowerCase())} ${escape(r.relPath.toLowerCase())}">
        <div class="spec-header" onclick="openFile('${escape(r.fsPath.replace(/\\/g, '\\\\'))}', ${r.line})">
          <div class="spec-title-area">
            <span style="font-size:16px;">🚀</span>
            <div>
              <div class="spec-title">${escape(r.title)}</div>
              <div class="spec-path">${escape(r.relPath)}</div>
            </div>
          </div>
          <button class="jump-btn" onclick="event.stopPropagation(); openFile('${escape(r.fsPath.replace(/\\/g, '\\\\'))}', ${r.line})">Open File</button>
        </div>
        <ul class="scenario-list">
          ${r.rules.map(rl => `
            <li class="scenario-item">
              <div style="font-weight: 500;">Rule: ${escape(rl.title)} (${rl.scenarios.length} scenarios)</div>
              <button class="jump-btn" onclick="openFile('${escape(r.fsPath.replace(/\\/g, '\\\\'))}', ${rl.line})">Line ${rl.line + 1}</button>
            </li>
          `).join('')}
        </ul>
      </div>
    `).join('')
    }
  </div>

  <!-- SECTION 3: TEST PLANS -->
  <div id="section-testplans" class="spec-section" style="display:none;">
    ${
      filesData.testplans.length === 0
        ? `<div class="empty-state">No test plan feature files found (*.plan.feature or @testplan)</div>`
        : filesData.testplans.map(p => `
      <div class="spec-card file-card" data-search="${escape(p.title.toLowerCase())} ${escape(p.relPath.toLowerCase())}">
        <div class="spec-header" onclick="openFile('${escape(p.fsPath.replace(/\\/g, '\\\\'))}', ${p.line})">
          <div class="spec-title-area">
            <span style="font-size:16px;">📋</span>
            <div>
              <div class="spec-title">${escape(p.title)}</div>
              <div class="spec-path">${escape(p.relPath)}</div>
            </div>
          </div>
          <button class="jump-btn" onclick="event.stopPropagation(); openFile('${escape(p.fsPath.replace(/\\/g, '\\\\'))}', ${p.line})">Open File</button>
        </div>
      </div>
    `).join('')
    }
  </div>
      `
  }

  <script>
    const vscode = acquireVsCodeApi();

    function openFile(fsPath, line) {
      vscode.postMessage({ command: 'openFile', fsPath, line });
    }

    function sendMessage(command) {
      vscode.postMessage({ command });
    }

    function switchMode(mode) {
      vscode.postMessage({ command: 'switchMode', mode });
    }

    function switchFilesTab(tabName) {
      document.querySelectorAll('.spec-section').forEach(el => el.style.display = 'none');
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.kpi-card').forEach(el => el.classList.remove('active'));

      const sec = document.getElementById('section-' + tabName);
      if (sec) sec.style.display = 'block';

      const btn = document.getElementById('tab-btn-' + tabName);
      if (btn) btn.classList.add('active');

      const kpi = document.getElementById('kpi-' + tabName);
      if (kpi) kpi.classList.add('active');
    }

    function switchStateTab(tabName) {
      document.querySelectorAll('.state-section').forEach(el => el.style.display = 'none');
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.kpi-card').forEach(el => el.classList.remove('active'));

      const sec = document.getElementById('section-st-' + tabName);
      if (sec) sec.style.display = 'block';

      const btn = document.getElementById('tab-btn-st-' + tabName);
      if (btn) btn.classList.add('active');

      const kpi = document.getElementById('kpi-st-' + tabName);
      if (kpi) kpi.classList.add('active');
    }

    function filterFilesSpecs() {
      const q = document.getElementById('searchInput').value.toLowerCase().trim();
      document.querySelectorAll('.file-card').forEach(card => {
        const text = card.getAttribute('data-search') || '';
        card.style.display = (!q || text.includes(q)) ? 'block' : 'none';
      });
    }

    function filterStateResources() {
      const q = document.getElementById('stateSearchInput').value.toLowerCase().trim();
      document.querySelectorAll('.state-card').forEach(card => {
        const text = card.getAttribute('data-search') || '';
        card.style.display = (!q || text.includes(q)) ? 'block' : 'none';
      });
    }

    function toggleExportBar() {
      const el = document.getElementById('exportBar');
      if (el) {
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
        if (el.style.display === 'block') {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }

    function selectAllFields(checked) {
      document.querySelectorAll('input[name="customField"]').forEach(cb => {
        cb.checked = checked;
      });
    }

    function doExportReport() {
      const slugSelect = document.getElementById('exportSlug');
      const slug = slugSelect ? slugSelect.value : 'testcase-summary';

      const formatRadio = document.querySelector('input[name="exportFormat"]:checked');
      const format = formatRadio ? formatRadio.value : 'xlsx';

      const checkboxes = Array.from(document.querySelectorAll('input[name="customField"]'));
      let fields = 'all';
      if (checkboxes.length > 0) {
        const checked = checkboxes.filter(cb => cb.checked).map(cb => cb.value);
        if (checked.length === checkboxes.length) {
          fields = 'all';
        } else if (checked.length === 0) {
          fields = 'none';
        } else {
          fields = checked;
        }
      }

      vscode.postMessage({
        command: 'exportReport',
        slug,
        format,
        fields
      });
    }
  </script>
</body>
</html>`;
  }
}
