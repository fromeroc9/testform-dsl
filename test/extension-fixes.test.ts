import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __mockState, Position, Range, Selection } from "./mocks/vscode";
import { CORE_REPORTS } from "../src/client/views/reports-view";
import { markCurrentScenarioStatus } from "../src/client/qa-fast-pass";
import { TestformWorkspaceManager } from "../src/client/workspace-manager";
import { execTestformCli } from "../src/client/terminal";

describe("VSCode extension phase 1 fixes & core contracts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "testform-vscode-test-"));
    __mockState.configMap.clear();
    __mockState.activeTextEditor = undefined;
    __mockState.workspaceFolders = [];
    __mockState.quickPickHandler = undefined;
    __mockState.statusBarMessages = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses canonical 'bidimensional' slug instead of 'two-dimensional'", () => {
    expect(CORE_REPORTS.some((r) => r.slug === "bidimensional")).toBe(true);
    expect(CORE_REPORTS.some((r) => r.slug === "two-dimensional")).toBe(false);
  });

  it("replaces both '* set status =' and legacy '* mark status =' in QA Fast Pass", async () => {
    const lines = [
      "Feature: Checkout",
      "  Scenario: Pay by card",
      "    * set status = pending",
      "    Given user is on cart",
    ];
    let replacedRange: Range | undefined;
    let replacedText = "";

    __mockState.activeTextEditor = {
      document: {
        languageId: "gherkin",
        fileName: "checkout.run.feature",
        get lineCount() {
          return lines.length;
        },
        lineAt: (i: number) => ({
          text: lines[i],
          range: new Range(new Position(i, 0), new Position(i, lines[i].length)),
        }),
      },
      selection: new Selection(new Position(1, 0), new Position(1, 0)),
      edit: async (cb: (builder: any) => void) => {
        cb({
          replace: (range: Range, text: string) => {
            replacedRange = range;
            replacedText = text;
          },
          insert: () => {
            throw new Error("Should replace existing set status line instead of inserting duplicate");
          },
        });
        return true;
      },
      revealRange: () => {},
    };

    await markCurrentScenarioStatus("passed");

    expect(replacedRange?.start.line).toBe(2);
    expect(replacedText).toBe("    * set status = passed");
  });

  it("discovers workspaces in root/testform.state.d", async () => {
    fs.mkdirSync(path.join(tmpDir, "testform.state.d", "staging"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "testform.state.d", "prod"), { recursive: true });

    __mockState.workspaceFolders = [{ uri: { fsPath: tmpDir } }];
    let pickedLabels: string[] = [];
    __mockState.quickPickHandler = (items: any[]) => {
      pickedLabels = items.map((i) => String(i.wsName || i.label));
      return undefined;
    };

    const mgr = new TestformWorkspaceManager();
    await mgr.selectWorkspacePrompt();
    mgr.dispose();

    expect(pickedLabels).toContain("staging");
    expect(pickedLabels).toContain("prod");
    expect(pickedLabels).toContain("default");
  });

  it("executes CLI via execFile safely without shell interpolation and returns real exit codes", async () => {
    const scriptPath = path.join(tmpDir, "mock-cli.js");
    fs.writeFileSync(
      scriptPath,
      `
      const args = process.argv.slice(2);
      console.log(JSON.stringify({ args }));
      process.exit(args.includes("fail") ? 3 : 0);
      `,
      "utf-8"
    );

    __mockState.configMap.set("testform.executablePath", scriptPath);

    const okRes = await execTestformCli(["plan", '-target=dir with spaces & $(echo evil)', "-json"], {
      cwd: tmpDir,
    });
    expect(okRes.exitCode).toBe(0);
    const parsed = JSON.parse(okRes.stdout);
    expect(parsed.args).toEqual(["plan", "-target=dir with spaces & $(echo evil)", "-json"]);

    const failRes = await execTestformCli(["fail"], { cwd: tmpDir });
    expect(failRes.exitCode).toBe(3);
  });
});
