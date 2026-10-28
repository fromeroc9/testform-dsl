import * as vscode from 'vscode';
import * as path from 'path';

export class FeatureCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const codeLenses: vscode.CodeLens[] = [];
    const fileName = document.fileName.toLowerCase();

    if (!fileName.endsWith('.feature')) {
      return codeLenses;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const rootPath = workspaceFolder ? workspaceFolder.uri.fsPath : '';
    const relPath = rootPath ? path.relative(rootPath, document.uri.fsPath).replace(/\\/g, '/') : path.basename(document.uri.fsPath);

    const isCase = fileName.includes('.case.feature');
    const isPlan = fileName.includes('.plan.feature');
    const isRun = fileName.includes('.run.feature');

    let pendingTags: string[] = [];

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const text = line.text.trim();

      if (text.startsWith('#')) continue;

      if (text.startsWith('@')) {
        const tags = text.split(/\s+/).filter(t => t.startsWith('@'));
        pendingTags.push(...tags);
        continue;
      }

      // 1. Feature header CodeLens
      const featMatch = text.match(/^(?:Feature|Característica):\s*(.+)$/i);
      if (featMatch) {
        const range = new vscode.Range(i, 0, i, line.text.length);

        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `▶ Run Apply (${isRun ? 'testrun' : isPlan ? 'testplan' : 'testcase'})`,
            tooltip: `Execute testform apply --target="${relPath}" --auto-approve`,
            command: 'testform.applyCurrent',
            arguments: [document.uri]
          }),
          new vscode.CodeLens(range, {
            title: `🔍 Plan`,
            tooltip: `Execute testform plan --target="${relPath}"`,
            command: 'testform.planCurrent',
            arguments: [document.uri]
          }),
          new vscode.CodeLens(range, {
            title: `$(diff) Drift`,
            tooltip: `Execute testform diff`,
            command: 'testform.diff'
          })
        );
        pendingTags = [];
        continue;
      }

      // 2. Scenario header CodeLens in testcase files
      if (isCase) {
        const scenMatch = text.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.+)$/i);
        if (scenMatch) {
          const range = new vscode.Range(i, 0, i, line.text.length);
          const identityTag = pendingTags.find(t => /^@tc-[0-9]+/i.test(t));
          const target = identityTag ? `${relPath}.${identityTag.toLowerCase()}` : relPath;

          codeLenses.push(
            new vscode.CodeLens(range, {
              title: `▶ Run Case (${identityTag || 'Scenario'})`,
              tooltip: `Execute testform apply --target="${target}" --auto-approve`,
              command: 'testform.applyTarget',
              arguments: [target]
            })
          );
          pendingTags = [];
        }
      }
    }

    return codeLenses;
  }
}
