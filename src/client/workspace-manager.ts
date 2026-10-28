import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runTestformCommand } from './terminal';

export class TestformWorkspaceManager {
  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];
  private currentWorkspace: string = 'default';

  constructor(private onWorkspaceChanged?: (ws: string) => void) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
    this.statusBarItem.command = 'testform.workspace.select';
    this.disposables.push(this.statusBarItem);

    this.updateCurrentWorkspace();

    // Watch .testform/environment file
    const watcher = vscode.workspace.createFileSystemWatcher('**/.testform/environment');
    watcher.onDidCreate(() => this.updateCurrentWorkspace());
    watcher.onDidChange(() => this.updateCurrentWorkspace());
    watcher.onDidDelete(() => this.updateCurrentWorkspace());
    this.disposables.push(watcher);
  }

  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }

  public updateCurrentWorkspace(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.statusBarItem.hide();
      return;
    }

    const rootPath = folders[0].uri.fsPath;
    const envFile = path.join(rootPath, '.testform', 'environment');

    let ws = 'default';
    if (fs.existsSync(envFile)) {
      try {
        const content = fs.readFileSync(envFile, 'utf8').trim();
        if (content.length > 0) ws = content;
      } catch {}
    }

    this.currentWorkspace = ws;
    this.statusBarItem.text = `$(layers) Testform: ${ws}`;
    this.statusBarItem.tooltip = `Active Testform Workspace: ${ws}\nClick to switch, create, or manage isolated environments.`;
    this.statusBarItem.show();

    if (this.onWorkspaceChanged) {
      this.onWorkspaceChanged(ws);
    }
  }

  public async selectWorkspacePrompt(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }

    const rootPath = folders[0].uri.fsPath;
    const testformDir = path.join(rootPath, '.testform');

    // Discover existing workspaces
    const existingWorkspaces = new Set<string>(['default']);
    if (fs.existsSync(testformDir)) {
      const possibleDirs = ['testform.tfstate.d', 'workspaces'];
      for (const pd of possibleDirs) {
        const fullDir = path.join(testformDir, pd);
        if (fs.existsSync(fullDir)) {
          try {
            const entries = fs.readdirSync(fullDir, { withFileTypes: true });
            for (const e of entries) {
              if (e.isDirectory() && !e.name.startsWith('.')) {
                existingWorkspaces.add(e.name);
              }
            }
          } catch {}
        }
      }
    }

    // Always include current workspace
    existingWorkspaces.add(this.currentWorkspace);

    interface WorkspacePickItem extends vscode.QuickPickItem {
      action: 'select' | 'new' | 'delete';
      wsName?: string;
    }

    const items: WorkspacePickItem[] = [];

    // List existing workspaces
    for (const ws of Array.from(existingWorkspaces).sort()) {
      const isCurrent = ws === this.currentWorkspace;
      items.push({
        label: isCurrent ? `$(check) ${ws}` : `$(circle-outline) ${ws}`,
        description: isCurrent ? '(Active Workspace)' : '',
        action: 'select',
        wsName: ws
      });
    }

    items.push({
      label: '',
      kind: vscode.QuickPickItemKind.Separator
    } as any);

    items.push({
      label: '$(plus) New Workspace...',
      description: 'Create and switch to a new isolated workspace ledger',
      action: 'new'
    });

    if (existingWorkspaces.size > 1) {
      items.push({
        label: '$(trash) Delete Workspace...',
        description: 'Delete an existing workspace ledger',
        action: 'delete'
      });
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Current workspace: ${this.currentWorkspace} - Select workspace or action`
    });

    if (!selected) return;

    if (selected.action === 'select' && selected.wsName) {
      if (selected.wsName === this.currentWorkspace) return;
      runTestformCommand(`workspace select ${selected.wsName}`);
      this.currentWorkspace = selected.wsName;
      this.statusBarItem.text = `$(layers) Testform: ${selected.wsName}`;
    } else if (selected.action === 'new') {
      const newName = await vscode.window.showInputBox({
        prompt: 'Enter new workspace name (e.g. staging, prod, ci)',
        validateInput: val => {
          if (!val || !/^[a-zA-Z0-9_-]+$/.test(val)) {
            return 'Workspace name must be alphanumeric with dashes or underscores.';
          }
          if (existingWorkspaces.has(val)) {
            return `Workspace '${val}' already exists.`;
          }
          return null;
        }
      });

      if (newName) {
        runTestformCommand(`workspace new ${newName}`);
        this.currentWorkspace = newName;
        this.statusBarItem.text = `$(layers) Testform: ${newName}`;
      }
    } else if (selected.action === 'delete') {
      const deletable = Array.from(existingWorkspaces).filter(w => w !== 'default' && w !== this.currentWorkspace);
      if (deletable.length === 0) {
        vscode.window.showWarningMessage('Cannot delete the default or currently active workspace.');
        return;
      }

      const toDelete = await vscode.window.showQuickPick(deletable, {
        placeHolder: 'Select workspace to delete permanently'
      });

      if (toDelete) {
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to delete workspace '${toDelete}'? All its state will be permanently removed.`,
          { modal: true },
          'Delete Workspace'
        );
        if (confirm === 'Delete Workspace') {
          runTestformCommand(`workspace delete ${toDelete}`);
        }
      }
    }
  }
}
