import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { runTestformCommand } from '../terminal';

export interface PlanScenarioStep {
  keyword: string;
  text: string;
}

export interface PlanScenario {
  name: string;
  line?: number;
  uri?: string;
  tags?: string[];
  steps?: PlanScenarioStep[];
}

export interface PlanChangeItem {
  action: 'add' | 'change' | 'destroy' | 'replace';
  address: string;
  path: string;
  tag?: string;
  namespace?: string;
  resourceType: string;
  scenario: PlanScenario;
  localHash?: string;
  oldAttributes?: any;
}

export interface PlanJsonOutput {
  format_version?: string;
  testform_version?: string;
  changes: PlanChangeItem[];
}

export class PlanDiffPanel {
  public static currentPanel: PlanDiffPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _projectRoot: string;
  private _target?: string;
  private _requestId: number = 0;
  private _disposables: vscode.Disposable[] = [];

  private _loading: boolean = false;
  private _error: string | null = null;
  private _planResult: PlanJsonOutput | null = null;

  private static formatTitle(target?: string): string {
    return target ? `Testform Plan Diff (${path.basename(target)})` : 'Testform Plan Diff';
  }

  public static createOrShow(extensionUri: vscode.Uri, projectRoot?: string, target?: string): PlanDiffPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn || vscode.ViewColumn.One
      : vscode.ViewColumn.One;

    const effectiveRoot = projectRoot || PlanDiffPanel.findProjectRoot();

    if (PlanDiffPanel.currentPanel) {
      PlanDiffPanel.currentPanel._panel.reveal(column);
      PlanDiffPanel.currentPanel._projectRoot = effectiveRoot;
      PlanDiffPanel.currentPanel._target = target;
      PlanDiffPanel.currentPanel.updateTitle();
      PlanDiffPanel.currentPanel.runPlan();
      return PlanDiffPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'testformPlanDiff',
      PlanDiffPanel.formatTitle(target),
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    PlanDiffPanel.currentPanel = new PlanDiffPanel(panel, extensionUri, effectiveRoot, target);
    return PlanDiffPanel.currentPanel;
  }

  private static findProjectRoot(): string {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      let curr = path.dirname(editor.document.uri.fsPath);
      while (curr && curr !== path.dirname(curr)) {
        if (
          fs.existsSync(path.join(curr, 'main.yml')) ||
          fs.existsSync(path.join(curr, 'main.yaml')) ||
          fs.existsSync(path.join(curr, 'testform.yml')) ||
          fs.existsSync(path.join(curr, 'testform.yaml'))
        ) {
          return curr;
        }
        curr = path.dirname(curr);
      }
    }
    const ws = vscode.workspace.workspaceFolders;
    return ws && ws.length > 0 ? ws[0].uri.fsPath : process.cwd();
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, projectRoot: string, target?: string) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._projectRoot = projectRoot;
    this._target = target;

    const iconPath = vscode.Uri.joinPath(this._extensionUri, 'assets', 'icon.svg');
    this._panel.iconPath = iconPath;

    this.runPlan();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'refresh':
            this.runPlan();
            break;
          case 'showAll':
            this._target = undefined;
            this.updateTitle();
            this.runPlan();
            break;
          case 'apply':
            runTestformCommand(`apply${this.getTargetFlag()}`);
            break;
          case 'applyAutoApprove':
            runTestformCommand(`apply -auto-approve${this.getTargetFlag()}`);
            break;
          case 'openFile':
            if (message.fsPath) {
              const fullPath = path.isAbsolute(message.fsPath)
                ? message.fsPath
                : path.join(this._projectRoot, message.fsPath);
              if (fs.existsSync(fullPath)) {
                const uri = vscode.Uri.file(fullPath);
                const line = typeof message.line === 'number' && message.line > 0 ? message.line - 1 : 0;
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, {
                  selection: new vscode.Range(line, 0, line, 0),
                  viewColumn: vscode.ViewColumn.One
                });
              } else {
                vscode.window.showWarningMessage(`File not found: ${fullPath}`);
              }
            }
            break;
          case 'copyAddress':
            if (message.address) {
              await vscode.env.clipboard.writeText(message.address);
              vscode.window.showInformationMessage(`Copied to clipboard: ${message.address}`);
            }
            break;
        }
      },
      null,
      this._disposables
    );
  }

  private updateTitle(): void {
    this._panel.title = PlanDiffPanel.formatTitle(this._target);
  }

  private getTargetFlag(): string {
    if (!this._target) return '';
    return ` -target="${this._target.replace(/"/g, '\\"')}"`;
  }

  public runPlan(): void {
    const reqId = ++this._requestId;
    this._loading = true;
    this._error = null;
    this.updateWebview();

    const config = vscode.workspace.getConfiguration('testform');
    const executable = config.get<string>('executablePath') || 'testform';
    const cmd = `"${executable}" plan${this.getTargetFlag()} -json`;

    exec(cmd, { cwd: this._projectRoot, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (reqId !== this._requestId) return;
      this._loading = false;
      const combinedOutput = (stdout || '') + (stderr || '');

      const jsonStart = stdout.indexOf('{');
      const jsonEnd = stdout.lastIndexOf('}');

      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        try {
          const raw = stdout.substring(jsonStart, jsonEnd + 1);
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.changes)) {
            this._planResult = parsed;
            this._error = null;
            this.updateWebview();
            return;
          }
        } catch {
          // fall through to error handling
        }
      }

      if (err) {
        this._error = combinedOutput.trim() || err.message;
        this._planResult = null;
      } else {
        this._planResult = { changes: [] };
        this._error = null;
      }

      this.updateWebview();
    });
  }

  private updateWebview(): void {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview(): string {
    const changes = this._planResult?.changes || [];
    const adds = changes.filter(c => c.action === 'add');
    const modifications = changes.filter(c => c.action === 'change');
    const destroys = changes.filter(c => c.action === 'destroy');
    const replacements = changes.filter(c => c.action === 'replace');

    const escapeHtml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Testform Plan Diff</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --card-bg: var(--vscode-sideBar-background, #1e1e1e);
      --border: var(--vscode-widget-border, #333333);
      --primary: var(--vscode-button-background, #007acc);
      --primary-fg: var(--vscode-button-foreground, #ffffff);
      --hover-bg: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05));
      --badge-bg: var(--vscode-badge-background, #3c3c3c);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
      
      --color-add: #22c55e;
      --color-add-bg: rgba(34, 197, 94, 0.12);
      --color-add-border: rgba(34, 197, 94, 0.35);

      --color-change: #eab308;
      --color-change-bg: rgba(234, 179, 8, 0.12);
      --color-change-border: rgba(234, 179, 8, 0.35);

      --color-destroy: #ef4444;
      --color-destroy-bg: rgba(239, 68, 68, 0.12);
      --color-destroy-border: rgba(239, 68, 68, 0.35);

      --color-replace: #06b6d4;
      --color-replace-bg: rgba(6, 182, 212, 0.12);
      --color-replace-border: rgba(6, 182, 212, 0.35);
    }

    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      line-height: 1.5;
      margin: 0;
      padding: 20px 24px;
    }

    /* Top Sticky Control Bar */
    .top-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
    }

    .title-area {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .title {
      font-size: 1.35rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .subtitle {
      font-size: 0.85rem;
      opacity: 0.7;
    }

    .actions-bar {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--card-bg);
      color: var(--fg);
      border: 1px solid var(--border);
      padding: 6px 14px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
      transition: background 0.15s, border-color 0.15s;
    }
    .btn:hover {
      background: var(--hover-bg);
      border-color: var(--fg);
    }
    .btn-primary {
      background: #16a34a;
      color: #ffffff;
      border: 1px solid #15803d;
      font-weight: 600;
    }
    .btn-primary:hover {
      background: #15803d;
      border-color: #166534;
    }

    /* Summary Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }

    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .stat-card.stat-add { border-left: 4px solid var(--color-add); }
    .stat-card.stat-change { border-left: 4px solid var(--color-change); }
    .stat-card.stat-destroy { border-left: 4px solid var(--color-destroy); }
    .stat-card.stat-replace { border-left: 4px solid var(--color-replace); }

    .stat-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.75;
    }
    .stat-value {
      font-size: 1.4rem;
      font-weight: 700;
    }

    /* Filter & Search Bar */
    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-bottom: 20px;
    }

    .search-box {
      flex: 1;
      min-width: 220px;
      background: var(--card-bg);
      color: var(--fg);
      border: 1px solid var(--border);
      padding: 6px 12px;
      border-radius: 5px;
      outline: none;
      font-size: 0.85rem;
    }
    .search-box:focus {
      border-color: var(--primary);
    }

    .filter-pills {
      display: flex;
      gap: 6px;
    }

    .filter-pill {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .filter-pill.active {
      background: var(--primary);
      color: var(--primary-fg);
      border-color: var(--primary);
    }

    /* Change Item Cards */
    .changes-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .change-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      transition: transform 0.1s, border-color 0.15s;
    }
    .change-card:hover {
      border-color: rgba(255, 255, 255, 0.25);
    }
    .change-card.action-add { border-left: 5px solid var(--color-add); }
    .change-card.action-change { border-left: 5px solid var(--color-change); }
    .change-card.action-destroy { border-left: 5px solid var(--color-destroy); }
    .change-card.action-replace { border-left: 5px solid var(--color-replace); }

    .card-header {
      padding: 12px 16px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: rgba(255, 255, 255, 0.02);
      border-bottom: 1px solid var(--border);
    }

    .badge-action {
      font-size: 0.75rem;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .action-add .badge-action { background: var(--color-add-bg); color: var(--color-add); border: 1px solid var(--color-add-border); }
    .action-change .badge-action { background: var(--color-change-bg); color: var(--color-change); border: 1px solid var(--color-change-border); }
    .action-destroy .badge-action { background: var(--color-destroy-bg); color: var(--color-destroy); border: 1px solid var(--color-destroy-border); }
    .action-replace .badge-action { background: var(--color-replace-bg); color: var(--color-replace); border: 1px solid var(--color-replace-border); }

    .badge-scope {
      font-size: 0.72rem;
      padding: 2px 7px;
      border-radius: 4px;
      background: var(--badge-bg);
      color: var(--badge-fg);
      font-family: monospace;
      text-transform: uppercase;
    }

    .address {
      font-family: monospace;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }
    .address:hover {
      text-decoration: underline;
    }

    .card-meta-right {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.8rem;
    }

    .file-link {
      color: var(--primary);
      text-decoration: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .file-link:hover {
      text-decoration: underline;
    }

    .card-body {
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .scenario-title {
      font-size: 1rem;
      font-weight: 600;
    }

    .tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .tag-item {
      font-family: monospace;
      font-size: 0.75rem;
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 6px;
      border-radius: 3px;
      opacity: 0.85;
    }

    .steps-container {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 10px 14px;
      font-family: monospace;
      font-size: 0.82rem;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .step-line {
      display: flex;
      gap: 8px;
    }
    .step-keyword {
      color: #38bdf8;
      font-weight: 600;
      min-width: 48px;
    }
    .step-keyword.set {
      color: #f472b6;
      font-weight: 700;
    }
    .step-text {
      color: var(--fg);
    }

    /* Diff View for Changes */
    .diff-box {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 10px 12px;
      font-family: monospace;
      font-size: 0.8rem;
      margin-top: 6px;
    }
    .diff-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      opacity: 0.7;
      margin-bottom: 6px;
    }
    .diff-row {
      display: flex;
      gap: 8px;
      padding: 2px 0;
    }
    .diff-row.old { color: var(--color-destroy); }
    .diff-row.new { color: var(--color-add); }

    /* State messages */
    .state-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      text-align: center;
      gap: 14px;
    }

    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .error-box {
      background: var(--color-destroy-bg);
      border: 1px solid var(--color-destroy-border);
      color: var(--fg);
      border-radius: 6px;
      padding: 16px;
      width: 100%;
      max-width: 800px;
      text-align: left;
      font-family: monospace;
      white-space: pre-wrap;
      font-size: 0.82rem;
      overflow-x: auto;
    }
  </style>
</head>
<body>

  <!-- Top Bar -->
  <div class="top-bar">
    <div class="title-area">
      <div class="title">
        <span>⚡ Testform Plan Diff</span>
        ${this._target ? `<span class="badge-scope" style="background: rgba(0,122,204,0.2); border: 1px solid rgba(0,122,204,0.4);">File Scope</span>` : ''}
      </div>
      <div class="subtitle">
        Directory: <code>${escapeHtml(this._projectRoot)}</code>${this._target ? ` &bull; Target: <code>${escapeHtml(this._target)}</code>` : ''}
      </div>
    </div>
    <div class="actions-bar">
      ${this._target ? `<button class="btn" onclick="sendCmd('showAll')" title="Calculate diff for the entire workspace">🌐 Full Plan</button>` : ''}
      <button class="btn" onclick="sendCmd('refresh')">↻ Re-Plan</button>
      <button class="btn btn-primary" onclick="sendCmd('apply')">▶ Apply Plan</button>
      <button class="btn" onclick="sendCmd('applyAutoApprove')">⚡ Apply (-auto-approve)</button>
    </div>
  </div>

  ${
    this._loading
      ? `
    <div class="state-container">
      <div class="spinner"></div>
      <div style="font-weight: 500;">Calculating execution plan...</div>
      <div style="font-size: 0.85rem; opacity: 0.7;">Running <code>testform plan${escapeHtml(this.getTargetFlag())} -json</code></div>
    </div>
    `
      : this._error
      ? `
    <div class="state-container">
      <div style="font-size: 1.5rem; color: var(--color-destroy);">✕ Planning Diagnostic</div>
      <div class="error-box">${escapeHtml(this._error)}</div>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button class="btn btn-primary" onclick="sendCmd('refresh')">Try Again</button>
      </div>
    </div>
    `
      : changes.length === 0
      ? `
    <div class="state-container">
      <div style="font-size: 2.2rem;">✨</div>
      <div style="font-size: 1.2rem; font-weight: 600;">No changes. ${this._target ? 'Target file is up to date.' : 'Infrastructure is up to date.'}</div>
      <div style="font-size: 0.85rem; opacity: 0.7; max-width: 500px;">
        ${this._target ? `<code>${escapeHtml(this._target)}</code> matches` : 'Your configuration matches'} the recorded state in <code>testform.state</code>. No actions are needed.
      </div>
      <button class="btn" style="margin-top: 10px;" onclick="sendCmd('refresh')">↻ Refresh Plan</button>
    </div>
    `
      : `
    <!-- Stats Grid -->
    <div class="stats-grid">
      <div class="stat-card stat-add">
        <span class="stat-label">To Add</span>
        <span class="stat-value" style="color: var(--color-add);">+${adds.length}</span>
      </div>
      <div class="stat-card stat-change">
        <span class="stat-label">To Change</span>
        <span class="stat-value" style="color: var(--color-change);">~${modifications.length}</span>
      </div>
      <div class="stat-card stat-destroy">
        <span class="stat-label">To Destroy</span>
        <span class="stat-value" style="color: var(--color-destroy);">-${destroys.length}</span>
      </div>
      <div class="stat-card stat-replace">
        <span class="stat-label">To Replace</span>
        <span class="stat-value" style="color: var(--color-replace);">+/-${replacements.length}</span>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="filter-bar">
      <input type="text" id="searchInput" class="search-box" placeholder="Search by address, title, tag, or step..." oninput="filterCards()" />
      <div class="filter-pills">
        <button class="filter-pill active" data-action="all" onclick="setActionFilter('all')">All (${changes.length})</button>
        <button class="filter-pill" data-action="add" onclick="setActionFilter('add')">Add (${adds.length})</button>
        <button class="filter-pill" data-action="change" onclick="setActionFilter('change')">Change (${modifications.length})</button>
        <button class="filter-pill" data-action="destroy" onclick="setActionFilter('destroy')">Destroy (${destroys.length})</button>
        ${replacements.length > 0 ? `<button class="filter-pill" data-action="replace" onclick="setActionFilter('replace')">Replace (${replacements.length})</button>` : ''}
      </div>
    </div>

    <!-- Changes List -->
    <div class="changes-list" id="changesList">
      ${changes
        .map((c, idx) => {
          const actionClass = 'action-' + c.action;
          const actionSymbol = c.action === 'add' ? '+ ADD' : c.action === 'change' ? '~ CHANGE' : c.action === 'destroy' ? '- DESTROY' : '+/- REPLACE';
          const scenarioName = c.scenario?.name || c.address;
          const line = c.scenario?.line || 1;
          const openPath = c.scenario?.uri && c.scenario.uri !== '(state)' ? c.scenario.uri : c.path;
          const tags = c.scenario?.tags || [];
          const steps = c.scenario?.steps || [];

          return `
        <div class="change-card ${actionClass}" data-action="${c.action}" data-search="${escapeHtml((c.address + ' ' + scenarioName + ' ' + tags.join(' ')).toLowerCase())}">
          <div class="card-header">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span class="badge-action">${actionSymbol}</span>
              <span class="badge-scope">${escapeHtml(c.resourceType || 'resource')}</span>
              <span class="address" title="Click to copy canonical address" onclick="copyAddress('${escapeHtml(c.address)}')">${escapeHtml(c.address)}</span>
              ${c.tag ? `<span class="badge-scope" style="background: rgba(0,122,204,0.2);">${escapeHtml(c.tag)}</span>` : ''}
            </div>
            <div class="card-meta-right">
              ${
                c.path || openPath
                  ? `<a class="file-link" onclick="openFile('${escapeHtml(openPath || c.path)}', ${line})">📄 ${escapeHtml(c.path || openPath)}:${line}</a>`
                  : ''
              }
            </div>
          </div>
          <div class="card-body">
            <div class="scenario-title">${escapeHtml(scenarioName)}</div>
            ${
              tags.length > 0
                ? `<div class="tag-list">${tags.map(t => `<span class="tag-item">${escapeHtml(t)}</span>`).join('')}</div>`
                : ''
            }
            ${
              steps.length > 0
                ? `
            <div class="steps-container">
              ${steps
                .map(s => {
                  const isSet = s.text.trim().startsWith('set ') || s.keyword.trim() === '* set';
                  return `
                <div class="step-line">
                  <span class="step-keyword ${isSet ? 'set' : ''}">${escapeHtml(s.keyword || '*')}</span>
                  <span class="step-text">${escapeHtml(s.text || '')}</span>
                </div>
              `;
                })
                .join('')}
            </div>
            `
                : ''
            }
            ${
              c.localHash
                ? `
            <div class="diff-box">
              <div class="diff-title">Resource Identity / Hash</div>
              <div class="diff-row"><span style="opacity: 0.6;">Local Hash:</span> <code>${escapeHtml(c.localHash)}</code></div>
              ${c.oldAttributes?.localHash ? `<div class="diff-row old">- State Hash: <code>${escapeHtml(c.oldAttributes.localHash)}</code></div>` : ''}
            </div>
            `
                : ''
            }
          </div>
        </div>
        `;
        })
        .join('')}
    </div>
    `
  }

  <script>
    const vscode = acquireVsCodeApi();
    let currentActionFilter = 'all';

    function sendCmd(cmd) {
      vscode.postMessage({ command: cmd });
    }

    function openFile(fsPath, line) {
      vscode.postMessage({ command: 'openFile', fsPath, line });
    }

    function copyAddress(address) {
      vscode.postMessage({ command: 'copyAddress', address });
    }

    function setActionFilter(action) {
      currentActionFilter = action;
      document.querySelectorAll('.filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-action') === action);
      });
      filterCards();
    }

    function filterCards() {
      const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
      const cards = document.querySelectorAll('.change-card');
      cards.forEach(card => {
        const action = card.getAttribute('data-action');
        const searchData = card.getAttribute('data-search') || '';
        const matchesAction = currentActionFilter === 'all' || action === currentActionFilter;
        const matchesQuery = !q || searchData.includes(q);
        card.style.display = matchesAction && matchesQuery ? 'block' : 'none';
      });
    }
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    PlanDiffPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
