<p align="center">
  <img src="assets/logo.png" alt="Testform Logo" width="80" height="80" />
</p>

<h1 align="center">Testform for Visual Studio Code</h1>

<p align="center">
  <strong>Declarative Test-as-Code orchestration for Git directly in your editor.</strong>
</p>

---

## 🚀 Features

- **⚡ Gherkin & Testform IntelliSense:** Syntax highlighting for Gherkin and `${var.*}`, `${local.*}`, `${data.*}`, `${env.*}` expressions, plus built-in functions (`lower`, `trim`, `split`, etc.).
- **🔄 Multi-Layer Variable Autoloading:** Instant autocompletion of variables and locals loaded across `main.yml`, `variables.yml`, domain YAMLs, and `*.vars.yml` autoloads.
- **🔍 Go-to-Definition & Hover:** `F12` / `Ctrl+Click` on any variable jumps directly to its declaration file and line. Hover over variables to see type, default, and autoload origin.
- **🧪 Native Test Explorer (Test Controller):** Seamless integration with VS Code's testing tab. Discover testcases, testruns, and testplans with Play buttons in the editor gutter.
- **📊 State Explorer & Drift:** Inspect resources in `testform.state`, monitor tainted statuses, and run speculative plans.
- **📦 .testform & Autoload Center:** Hot-discovery of custom reports in `.testform/reports/`, module management in `.testform/modules/`, and policy checks.
- **✨ Document Formatter:** Instant Gherkin formatting adhering strictly to Testform indentation standards.

---

## 🛠️ Commands

| Command | Description |
| :--- | :--- |
| `Testform: Initialize Workspace (init)` | Runs `testform init` to scaffold workspace and modules |
| `Testform: Validate Configuration` | Validates YAML manifests and Gherkin scopes |
| `Testform: Speculative Plan (plan)` | Computes execution plan and drift |
| `Testform: Apply Changes (apply)` | Applies test executions and reconciles state |
| `Testform: Show State Drift (diff)` | Inspects differences against the state ledger |
| `Testform: Generate Report` | Interactive picker to export reports (Markdown, Word, Excel, JSON, CSV) |
| `Testform: Refresh State Explorer` | Reloads `testform.state` in the sidebar |
| `Testform: Update Modules` | Runs `testform init -upgrade` to refresh `.testform/modules` |

---

## 💻 Development & Building

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the extension:**
   ```bash
   npm run build
   ```

3. **Debug & Test in VS Code:**
   Press `F5` in VS Code to launch an Extension Development Host.

4. **Package VSIX:**
   ```bash
   npm run package
   ```

---

## 📄 License

GPL-3.0-or-later © Flavio Romero
