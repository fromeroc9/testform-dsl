import * as vscode from 'vscode';

/**
 * =========================================================================================
 * TESTFORM QA FAST PASS CONTROLLER (src/client/qa-fast-pass.ts)
 * =========================================================================================
 * Provides lightning-fast keyboard-driven test execution status marking for QA engineers.
 *
 * Capabilities:
 * - Mark scenario as passed, failed, blocked, skipped, pending, or custom status
 * - Updates existing '* set status = ...' step in place or inserts it cleanly below Scenario header
 * - Automatic cursor advancement to next scenario (configurable)
 * - 100% customizable keybindings via VS Code Keyboard Shortcuts (Ctrl+K Ctrl+S)
 */

export async function markCurrentScenarioStatus(status: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const doc = editor.document;
  if (doc.languageId !== 'gherkin' && !doc.fileName.endsWith('.feature')) {
    vscode.window.showWarningMessage('Testform QA Fast Pass is only available inside Gherkin feature files (*.run.feature).');
    return;
  }

  const position = editor.selection.active;
  const currentLine = position.line;
  const lineCount = doc.lineCount;

  // 1. Locate current scenario header
  let scenarioLine = -1;
  let scenarioIndent = '    ';

  for (let i = currentLine; i >= 0; i--) {
    const lineText = doc.lineAt(i).text;
    const match = lineText.match(/^(\s*)(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):/i);
    if (match) {
      scenarioLine = i;
      const baseIndent = match[1];
      const config = vscode.workspace.getConfiguration('testform.qaFastPass');
      const indentSpaces = config.get<number>('indentation', 4);
      scenarioIndent = baseIndent + ' '.repeat(Math.max(2, indentSpaces - baseIndent.length));
      break;
    }
    // Stop if we hit a Rule or Feature before reaching a Scenario
    if (/^\s*(?:Rule|Regla|Feature|Característica):/i.test(lineText)) {
      break;
    }
  }

  // Fallback: If cursor was right before a scenario header, search downwards
  if (scenarioLine === -1) {
    for (let i = currentLine; i < lineCount; i++) {
      const lineText = doc.lineAt(i).text;
      const match = lineText.match(/^(\s*)(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):/i);
      if (match) {
        scenarioLine = i;
        const baseIndent = match[1];
        const config = vscode.workspace.getConfiguration('testform.qaFastPass');
        const indentSpaces = config.get<number>('indentation', 4);
        scenarioIndent = baseIndent + ' '.repeat(Math.max(2, indentSpaces - baseIndent.length));
        break;
      }
    }
  }

  if (scenarioLine === -1) {
    vscode.window.showInformationMessage('No Scenario found at cursor position to mark status.');
    return;
  }

  // 2. Scan lines within this scenario boundary (until next Scenario, Rule, or EOF)
  let markStatusLine = -1;

  for (let i = scenarioLine + 1; i < lineCount; i++) {
    const lineText = doc.lineAt(i).text;
    if (/^\s*(?:Scenario|Scenario Outline|Escenario|Esquema del escenario|Rule|Regla):/i.test(lineText)) {
      break;
    }
    if (/^\s*\*?\s*mark\s+status\s*=/i.test(lineText)) {
      markStatusLine = i;
      break;
    }
  }

  // 3. Edit document: Update existing or insert new step
  const success = await editor.edit(editBuilder => {
    if (markStatusLine !== -1) {
      const existingLine = doc.lineAt(markStatusLine);
      const indentMatch = existingLine.text.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : scenarioIndent;
      editBuilder.replace(existingLine.range, `${indent}* set status = ${status}`);
    } else {
      const insertLine = scenarioLine + 1;
      editBuilder.insert(new vscode.Position(insertLine, 0), `${scenarioIndent}* set status = ${status}\n`);
    }
  });

  if (!success) return;

  // 4. Auto-advance to next scenario if enabled in settings
  const config = vscode.workspace.getConfiguration('testform.qaFastPass');
  const autoAdvance = config.get<boolean>('autoAdvance', true);

  if (autoAdvance) {
    let targetNextLine = -1;
    const searchFrom = (markStatusLine !== -1 ? markStatusLine : scenarioLine + 1) + 1;
    for (let i = searchFrom; i < doc.lineCount; i++) {
      if (/^\s*(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):/i.test(doc.lineAt(i).text)) {
        targetNextLine = i;
        break;
      }
    }

    if (targetNextLine !== -1) {
      const targetText = doc.lineAt(targetNextLine).text;
      const newPos = new vscode.Position(targetNextLine, targetText.length);
      editor.selection = new vscode.Selection(newPos, newPos);
      editor.revealRange(new vscode.Range(newPos, newPos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  vscode.window.setStatusBarMessage(`$(check) Marked scenario as ${status.toUpperCase()}`, 1500);
}

/**
 * Interactive picker allowing QA engineers to choose any status or input custom status.
 */
export async function promptCustomScenarioStatus(): Promise<void> {
  const config = vscode.workspace.getConfiguration('testform.qaFastPass');
  const configuredStatuses: string[] = config.get<string[]>('customStatuses', [
    'passed',
    'failed',
    'pending',
    'skipped',
    'undefined',
    'ambiguous',
    'blocked'
  ]);

  const STATUS_ICONS: Record<string, string> = {
    passed: '✔',
    failed: '✖',
    pending: '⏳',
    skipped: '⏭',
    undefined: '❓',
    ambiguous: '🔀',
    blocked: '🚫'
  };

  const items: vscode.QuickPickItem[] = configuredStatuses.map(s => {
    const icon = STATUS_ICONS[s.toLowerCase()] || '🏷️';
    return {
      label: `${icon} ${s}`,
      description: `set status = ${s}`
    };
  });

  items.push({
    label: '$(edit) Custom status...',
    description: 'Type a custom status string'
  });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select execution status to mark on current scenario'
  });

  if (!picked) return;

  if (picked.label.includes('Custom status...')) {
    const custom = await vscode.window.showInputBox({
      prompt: 'Enter custom status name (e.g. quarantined, flaky, retest)',
      placeHolder: 'status'
    });
    if (custom && custom.trim()) {
      await markCurrentScenarioStatus(custom.trim().toLowerCase());
    }
  } else {
    const cleanStatus = picked.label.replace(/^[^a-zA-Z0-9_-]+\s*/, '').trim();
    await markCurrentScenarioStatus(cleanStatus);
  }
}
