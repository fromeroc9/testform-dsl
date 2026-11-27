import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

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
  const executable = (config.get<string>('executablePath') || 'testform').trim() || 'testform';
  const quotedExe = /\s/.test(executable) && !/^["'].*["']$/.test(executable)
    ? `"${executable}"`
    : executable;

  term.show(true);
  term.sendText(`${quotedExe} ${commandArgs}`, true);
}

interface ResolvedTestformCli {
  command: string;
  baseArgs: string[];
  env?: NodeJS.ProcessEnv;
}

function resolveTestformExecution(cwd?: string): ResolvedTestformCli {
  const config = vscode.workspace.getConfiguration('testform');
  const executable = (config.get<string>('executablePath') || 'testform').trim() || 'testform';

  if (/\.(?:c|m)?js$/i.test(executable)) {
    return {
      command: process.execPath,
      baseArgs: [executable],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    };
  }

  if (executable !== 'testform') {
    return { command: executable, baseArgs: [] };
  }

  const candidates: string[] = [];
  if (cwd) {
    candidates.push(path.join(cwd, 'node_modules', '@fromeroc9', 'testform', 'dist', 'index.js'));
  }
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@fromeroc9', 'testform', 'dist', 'index.js'));
  }

  const pathEnv = process.env.PATH || process.env.Path || '';
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    candidates.push(
      path.join(dir, 'node_modules', '@fromeroc9', 'testform', 'dist', 'index.js'),
      path.join(dir, '..', 'lib', 'node_modules', '@fromeroc9', 'testform', 'dist', 'index.js')
    );
  }

  for (const entryPath of candidates) {
    if (fs.existsSync(entryPath)) {
      return {
        command: process.execPath,
        baseArgs: [entryPath],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      };
    }
  }

  return {
    command: executable,
    baseArgs: []
  };
}

export interface ExecTestformResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: Error;
}

export function execTestformCli(
  args: string[],
  options: {
    cwd: string;
    maxBuffer?: number;
    onOutput?: (chunk: string) => void;
    cancellationToken?: vscode.CancellationToken;
  }
): Promise<ExecTestformResult> {
  const resolved = resolveTestformExecution(options.cwd);
  return new Promise(resolvePromise => {
    const child = execFile(
      resolved.command,
      [...resolved.baseArgs, ...args],
      {
        cwd: options.cwd,
        env: resolved.env || process.env,
        maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
        windowsHide: true
      },
      (err, stdout, stderr) => {
        const out = stdout || '';
        const errOut = stderr || '';
        const rawCode = (err as any)?.code;
        const exitCode = typeof rawCode === 'number' ? rawCode : err ? 1 : 0;
        resolvePromise({
          exitCode,
          stdout: out,
          stderr: errOut,
          error: err || undefined
        });
      }
    );

    if (options.onOutput) {
      child.stdout?.on('data', chunk => options.onOutput!(String(chunk)));
      child.stderr?.on('data', chunk => options.onOutput!(String(chunk)));
    }

    if (options.cancellationToken) {
      const cancelSub = options.cancellationToken.onCancellationRequested(() => {
        try {
          child.kill();
        } catch {}
      });
      child.once('exit', () => cancelSub.dispose());
    }
  });
}
