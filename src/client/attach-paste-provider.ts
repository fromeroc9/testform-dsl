import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as YAML from 'yaml';

function findProjectRoot(filePath: string): string {
  let curr = path.dirname(filePath);
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
  const ws = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
  return ws ? ws.uri.fsPath : path.dirname(filePath);
}

function resolveScaffoldAttachDir(projectRoot: string, scope: 'testcase' | 'testrun' | 'testplan' | 'bug'): string {
  const candidates = ['main.yml', 'main.yaml', 'testform.yml', 'testform.yaml'];
  let attachDir = 'attachments';

  for (const name of candidates) {
    const full = path.join(projectRoot, name);
    if (!fs.existsSync(full)) continue;
    try {
      const parsed = YAML.parse(fs.readFileSync(full, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        const res = parsed.resource || parsed.scopes;
        if (res) {
          // Specific resource scaffold.attach
          const specific = res[scope]?.scaffold?.attach;
          if (typeof specific === 'string' && specific.trim()) {
            return specific.trim();
          }
          // Global scaffold.attach
          const globalAttach = res.global?.scaffold?.attach || res.attach?.directory || parsed.attach?.directory;
          if (typeof globalAttach === 'string' && globalAttach.trim()) {
            attachDir = globalAttach.trim();
          }
        }
      }
    } catch {}
    break;
  }

  return attachDir;
}

export class AttachmentPasteEditProvider implements vscode.DocumentPasteEditProvider {
  public static readonly kind = vscode.DocumentDropOrPasteEditKind.Empty.append('testform', 'attachment');

  async provideDocumentPasteEdits(
    document: vscode.TextDocument,
    ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
    context: vscode.DocumentPasteEditContext,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentPasteEdit[] | undefined> {
    if (ranges.length === 0) return undefined;

    // 1. Detect image in clipboard
    const imageItem =
      dataTransfer.get('image/png') ||
      dataTransfer.get('image/jpeg') ||
      dataTransfer.get('image/webp') ||
      dataTransfer.get('image/*');

    if (!imageItem) {
      return undefined;
    }

    const file = imageItem.asFile();
    if (!file) return undefined;

    const data = await file.data();
    if (!data || data.length === 0) return undefined;

    const projectRoot = findProjectRoot(document.uri.fsPath);
    const fileName = path.basename(document.uri.fsPath).toLowerCase();
    const docText = document.getText();

    // 2. Detect resource type
    let scope: 'testcase' | 'testrun' | 'testplan' | 'bug' = 'testcase';
    if (fileName.endsWith('.bug.feature') || docText.includes('@bug')) {
      scope = 'bug';
    } else if (fileName.endsWith('.run.feature') || docText.includes('@testrun')) {
      scope = 'testrun';
    } else if (fileName.endsWith('.plan.feature') || docText.includes('@testplan')) {
      scope = 'testplan';
    }

    // 3. Detect section at cursor (Background vs Scenario)
    const activeRange = ranges[0];
    const cursorLine = activeRange.start.line;
    let inBackground = false;
    let currentScenarioTag = '';

    for (let i = cursorLine; i >= 0; i--) {
      const lineText = document.lineAt(i).text.trim();
      if (/^(?:Scenario|Escenario):/i.test(lineText)) {
        inBackground = false;
        // Search tag right above scenario
        if (i > 0) {
          const prevLine = document.lineAt(i - 1).text.trim();
          const matchTag = prevLine.match(/@([a-zA-Z0-9_-]+)/);
          if (matchTag) currentScenarioTag = matchTag[1];
        }
        break;
      }
      if (/^(?:Background|Antecedentes):/i.test(lineText)) {
        inBackground = true;
        break;
      }
    }

    // 4. Governance & scope enforcement:
    // Bug: attachments PROHIBITED in Background!
    if (scope === 'bug' && inBackground) {
      vscode.window.showErrorMessage(
        '[Testform DSL] Attachments are prohibited in Background for bug specifications. Defect attachments must be declared at Scenario level.'
      );
      return undefined;
    }

    // TestPlan: attachments only in Background!
    if (scope === 'testplan' && !inBackground) {
      vscode.window.showWarningMessage(
        '[Testform DSL] Test plan attachments must be declared in the Background (plan level).'
      );
    }

    // 5. Resolve storage directory and file path
    const configuredRelDir = resolveScaffoldAttachDir(projectRoot, scope);
    const absTargetDir = path.resolve(projectRoot, configuredRelDir);

    try {
      fs.mkdirSync(absTargetDir, { recursive: true });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to create attachment directory: ${err.message}`);
      return undefined;
    }

    const timestamp = Date.now();
    const tagPrefix = currentScenarioTag ? `${currentScenarioTag}_` : `${scope}_`;
    const imageExt = file.name ? path.extname(file.name) || '.png' : '.png';
    const targetFileName = `${tagPrefix}${timestamp}${imageExt}`;
    const absFilePath = path.join(absTargetDir, targetFileName);

    try {
      fs.writeFileSync(absFilePath, Buffer.from(data));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to save attachment file: ${err.message}`);
      return undefined;
    }

    const relPath = path.relative(projectRoot, absFilePath).replace(/\\/g, '/');

    // 6. Format insertion text
    const lineText = document.lineAt(cursorLine).text;
    let insertText: string;

    if (/\bset\s+(?:attach|evidence)\s*=\s*$/i.test(lineText)) {
      insertText = `"${relPath}"`;
    } else if (/^\s*$/.test(lineText)) {
      insertText = `    * set attach = "${relPath}"`;
    } else {
      insertText = `\n    * set attach = "${relPath}"`;
    }

    const edit = new vscode.DocumentPasteEdit(
      insertText,
      `Paste Image into ${configuredRelDir}/`,
      AttachmentPasteEditProvider.kind
    );

    return [edit];
  }
}
