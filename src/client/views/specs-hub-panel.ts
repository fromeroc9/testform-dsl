import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface TestCaseItem {
  tag?: string;
  title: string;
  line: number;
  tags: string[];
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

export class SpecsHubPanel {
  public static currentPanel: SpecsHubPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): SpecsHubPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn || vscode.ViewColumn.One
      : vscode.ViewColumn.One;

    if (SpecsHubPanel.currentPanel) {
      SpecsHubPanel.currentPanel._panel.reveal(column);
      SpecsHubPanel.currentPanel.refresh();
      return SpecsHubPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'testformSpecsHub',
      'Test Cases, Runs & Plans',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    SpecsHubPanel.currentPanel = new SpecsHubPanel(panel, extensionUri);
    return SpecsHubPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Set panel icon
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
        }
      },
      null,
      this._disposables
    );

    // Watch for .feature file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.feature');
    watcher.onDidCreate(() => this.refresh());
    watcher.onDidChange(() => this.refresh());
    watcher.onDidDelete(() => this.refresh());
    this._disposables.push(watcher);
  }

  public async refresh(): Promise<void> {
    const data = await this.scanSpecs();
    this._panel.webview.html = this.renderHtml(data);
  }

  public dispose(): void {
    SpecsHubPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
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

        if (scope === 'testcase') {
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
              const tag = pendingTags.find(t => /^@tc-[0-9]+/i.test(t));
              scenarios.push({
                tag,
                title: scTitle,
                line: i,
                tags: [...pendingTags]
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
                rules.push({
                  title: '(Suite Level)',
                  line: i,
                  scenarios: [scTitle]
                });
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

  private renderHtml(data: {
    testcases: FeatureFileItem[];
    testruns: TestRunSuiteItem[];
    testplans: TestPlanItem[];
  }): string {
    const totalCases = data.testcases.reduce((sum, f) => sum + f.scenarios.length, 0);
    const totalRuns = data.testruns.length;
    const totalPlans = data.testplans.length;

    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Cases, Runs & Plans</title>
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
    }
    * { box-sizing: border-box; }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
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
      margin-bottom: 24px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.3px;
    }
    .subtitle {
      color: var(--vscode-descriptionForeground, #888);
      font-size: 12px;
      margin-top: 2px;
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
      transition: opacity 0.15s ease;
    }
    .btn:hover { opacity: 0.9; }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
      color: var(--vscode-button-secondaryForeground, var(--fg));
    }
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      cursor: pointer;
      transition: transform 0.1s ease, border-color 0.15s ease;
    }
    .kpi-card:hover {
      border-color: var(--accent);
      transform: translateY(-1px);
    }
    .kpi-card.active {
      border-color: var(--accent);
      background: var(--hover-bg);
    }
    .kpi-title {
      font-size: 12px;
      font-weight: 500;
      color: var(--vscode-descriptionForeground, #888);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .kpi-value {
      font-size: 28px;
      font-weight: 700;
      margin: 8px 0 4px 0;
      color: var(--fg);
    }
    .kpi-sub {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .filter-bar {
      margin-bottom: 20px;
      position: relative;
    }
    .filter-input {
      width: 100%;
      background: var(--vscode-input-background, rgba(128,128,128,0.1));
      color: var(--vscode-input-foreground, var(--fg));
      border: 1px solid var(--vscode-input-border, var(--border));
      padding: 9px 14px;
      border-radius: 4px;
      font-size: 13px;
      outline: none;
    }
    .filter-input:focus {
      border-color: var(--vscode-focusBorder, var(--accent));
    }
    .tab-nav {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1px;
    }
    .tab-btn {
      background: none;
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
    .feature-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .feature-header {
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(128, 128, 128, 0.04);
      cursor: pointer;
      user-select: none;
    }
    .feature-title-area {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .feature-title {
      font-weight: 600;
      font-size: 14px;
    }
    .feature-path {
      color: var(--vscode-descriptionForeground, #888);
      font-size: 11px;
      font-family: var(--vscode-editor-font-family, monospace);
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
    .tag-tc {
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
    }
    .tag-smoke {
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
    }
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
      transition: background 0.1s ease;
    }
    .scenario-item:hover {
      background: var(--hover-bg);
    }
    .scenario-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .jump-btn {
      background: none;
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      transition: all 0.15s ease;
    }
    .jump-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
    .rule-title {
      padding: 8px 16px;
      font-weight: 600;
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888);
      background: rgba(128, 128, 128, 0.02);
      border-top: 1px solid var(--border);
    }
    .empty-state {
      text-align: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground, #888);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <div>
        <h1>Test Cases, Runs &amp; Plans</h1>
        <div class="subtitle">Testform Specification &amp; Execution Hub</div>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn btn-secondary" onclick="sendMessage('refresh')">↻ Refresh</button>
      <button class="btn btn-secondary" onclick="sendMessage('runPlan')">🔍 Speculative Plan</button>
      <button class="btn" onclick="sendMessage('runApply')">▶ Run Apply</button>
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi-card" id="kpi-testcases" onclick="switchTab('testcases')">
      <div class="kpi-title">🧪 Test Cases</div>
      <div class="kpi-value">${totalCases}</div>
      <div class="kpi-sub">${data.testcases.length} feature files registered</div>
    </div>
    <div class="kpi-card" id="kpi-testruns" onclick="switchTab('testruns')">
      <div class="kpi-title">🚀 Test Runs</div>
      <div class="kpi-value">${totalRuns}</div>
      <div class="kpi-sub">Execution suites &amp; target rules</div>
    </div>
    <div class="kpi-card" id="kpi-testplans" onclick="switchTab('testplans')">
      <div class="kpi-title">📋 Test Plans</div>
      <div class="kpi-value">${totalPlans}</div>
      <div class="kpi-sub">Release governance plans</div>
    </div>
  </div>

  <div class="filter-bar">
    <input type="text" id="searchInput" class="filter-input" placeholder="Search specs by feature, scenario name, or tag (e.g. @smoke, @tc-1)..." oninput="filterSpecs()">
  </div>

  <div class="tab-nav">
    <button class="tab-btn active" id="tab-btn-testcases" onclick="switchTab('testcases')">Test Cases (${totalCases})</button>
    <button class="tab-btn" id="tab-btn-testruns" onclick="switchTab('testruns')">Test Runs (${totalRuns})</button>
    <button class="tab-btn" id="tab-btn-testplans" onclick="switchTab('testplans')">Test Plans (${totalPlans})</button>
  </div>

  <!-- SECTION 1: TEST CASES -->
  <div id="section-testcases" class="spec-section">
    ${
      data.testcases.length === 0
        ? `<div class="empty-state">No test case feature files found (*.case.feature or @testcase)</div>`
        : data.testcases
            .map(
              f => `
      <div class="feature-card spec-card" data-search="${escape(f.title.toLowerCase())} ${escape(f.relPath.toLowerCase())} ${escape(f.scenarios.map(s => s.title + ' ' + (s.tag || '')).join(' ').toLowerCase())}">
        <div class="feature-header" onclick="openFile('${escape(f.fsPath.replace(/\\/g, '\\\\'))}', ${f.line})">
          <div class="feature-title-area">
            <span style="font-size:16px;">📄</span>
            <div>
              <div class="feature-title">${escape(f.title)}</div>
              <div class="feature-path">${escape(f.relPath)}</div>
            </div>
          </div>
          <div>
            ${f.tags.map(t => `<span class="tag">${escape(t)}</span>`).join('')}
            <button class="jump-btn" onclick="event.stopPropagation(); openFile('${escape(f.fsPath.replace(/\\/g, '\\\\'))}', ${f.line})">Open File</button>
          </div>
        </div>
        <ul class="scenario-list">
          ${f.scenarios
            .map(
              sc => `
            <li class="scenario-item spec-scenario" data-search="${escape(sc.title.toLowerCase())} ${escape((sc.tag || '').toLowerCase())}">
              <div class="scenario-info">
                ${sc.tag ? `<span class="tag tag-tc">${escape(sc.tag)}</span>` : ''}
                <span style="font-weight: 500;">${escape(sc.title)}</span>
              </div>
              <button class="jump-btn" onclick="openFile('${escape(f.fsPath.replace(/\\/g, '\\\\'))}', ${sc.line})">Jump to line ${sc.line + 1}</button>
            </li>
          `
            )
            .join('')}
        </ul>
      </div>
    `
            )
            .join('')
    }
  </div>

  <!-- SECTION 2: TEST RUNS -->
  <div id="section-testruns" class="spec-section" style="display: none;">
    ${
      data.testruns.length === 0
        ? `<div class="empty-state">No test run suites found (*.run.feature or @testrun)</div>`
        : data.testruns
            .map(
              r => `
      <div class="feature-card spec-card" data-search="${escape(r.title.toLowerCase())} ${escape(r.relPath.toLowerCase())}">
        <div class="feature-header" onclick="openFile('${escape(r.fsPath.replace(/\\/g, '\\\\'))}', ${r.line})">
          <div class="feature-title-area">
            <span style="font-size:16px;">🚀</span>
            <div>
              <div class="feature-title">${escape(r.title)}</div>
              <div class="feature-path">${escape(r.relPath)}</div>
            </div>
          </div>
          <div>
            ${r.tags.map(t => `<span class="tag">${escape(t)}</span>`).join('')}
            <button class="jump-btn" onclick="event.stopPropagation(); openFile('${escape(r.fsPath.replace(/\\/g, '\\\\'))}', ${r.line})">Open Suite</button>
          </div>
        </div>
        ${r.rules
          .map(
            rl => `
          <div class="rule-title">Rule: ${escape(rl.title)}</div>
          <ul class="scenario-list">
            ${rl.scenarios
              .map(
                sc => `
              <li class="scenario-item">
                <div class="scenario-info">
                  <span style="color: #38bdf8;">•</span>
                  <span>${escape(sc)}</span>
                </div>
                <button class="jump-btn" onclick="openFile('${escape(r.fsPath.replace(/\\/g, '\\\\'))}', ${rl.line})">View Rule</button>
              </li>
            `
              )
              .join('')}
          </ul>
        `
          )
          .join('')}
      </div>
    `
            )
            .join('')
    }
  </div>

  <!-- SECTION 3: TEST PLANS -->
  <div id="section-testplans" class="spec-section" style="display: none;">
    ${
      data.testplans.length === 0
        ? `<div class="empty-state">No test plans found (*.plan.feature or @testplan)</div>`
        : data.testplans
            .map(
              p => `
      <div class="feature-card spec-card" data-search="${escape(p.title.toLowerCase())} ${escape(p.relPath.toLowerCase())}">
        <div class="feature-header" onclick="openFile('${escape(p.fsPath.replace(/\\/g, '\\\\'))}', ${p.line})">
          <div class="feature-title-area">
            <span style="font-size:16px;">📋</span>
            <div>
              <div class="feature-title">${escape(p.title)}</div>
              <div class="feature-path">${escape(p.relPath)}</div>
            </div>
          </div>
          <div>
            ${p.tags.map(t => `<span class="tag">${escape(t)}</span>`).join('')}
            <button class="jump-btn" onclick="event.stopPropagation(); openFile('${escape(p.fsPath.replace(/\\/g, '\\\\'))}', ${p.line})">Open Plan</button>
          </div>
        </div>
        <ul class="scenario-list">
          ${p.runs
            .map(
              rn => `
            <li class="scenario-item">
              <div class="scenario-info">
                <span style="color: #4ade80;">✔ Target Run:</span>
                <span style="font-weight: 500;">${escape(rn.title)}</span>
              </div>
              <button class="jump-btn" onclick="openFile('${escape(p.fsPath.replace(/\\/g, '\\\\'))}', ${rn.line})">Line ${rn.line + 1}</button>
            </li>
          `
            )
            .join('')}
        </ul>
      </div>
    `
            )
            .join('')
    }
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function openFile(fsPath, line) {
      vscode.postMessage({ command: 'openFile', fsPath, line });
    }

    function sendMessage(command) {
      vscode.postMessage({ command });
    }

    function switchTab(tabName) {
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

    function filterSpecs() {
      const q = document.getElementById('searchInput').value.toLowerCase().trim();
      document.querySelectorAll('.spec-card').forEach(card => {
        const text = card.getAttribute('data-search') || '';
        if (!q || text.includes(q)) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    }

    // Default active card
    document.getElementById('kpi-testcases').classList.add('active');
  </script>
</body>
</html>`;
  }
}

