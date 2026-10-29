import * as vscode from 'vscode';

let terminal: vscode.Terminal | null = null;

export function getTestformTerminal(): vscode.Terminal {
  if (terminal && terminal.exitStatus === undefined) {
    return terminal;
  }

  terminal = vscode.window.createTerminal({
    name: 'Testform',
    iconPath: new vscode.ThemeIcon('beaker')
  });

  return terminal;
}

export function runTestformCommand(commandArgs: string): void {
  const term = getTestformTerminal();
  const config = vscode.workspace.getConfiguration('testform');
  const executable = config.get<string>('executablePath') || 'testform';

  term.show(true);
  term.sendText(`${executable} ${commandArgs}`, true);
}
