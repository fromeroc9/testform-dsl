<p align="center">
  <img src="assets/logo.png" alt="Testform Logo" width="90" height="90" />
</p>

<h1 align="center">Testform for Visual Studio Code</h1>

<p align="center">
  <strong>Declarative Test-as-Code orchestration for Git directly inside your editor.</strong><br>
  Language Server Protocol (LSP), native Test Explorer, state management, variable autoloading, Gherkin formatting, and quality governance.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=fromeroc9.testform"><img src="https://img.shields.io/visual-studio-marketplace/v/fromeroc9.testform?color=blue&label=VS%20Marketplace" alt="Visual Studio Marketplace Version" /></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.1.0-blue.svg" alt="Extension Version v1.1.0" /></a>
  <a href="https://github.com/fromeroc9/testform-vscode/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-green.svg" alt="License: GPL-3.0-or-later" /></a>
  <a href="https://fromeroc9.github.io/testform-docs/"><img src="https://img.shields.io/badge/docs-testform-blue" alt="Documentation" /></a>
</p>

---

## 🌟 Overview

The **Testform** extension transforms Visual Studio Code into a full-featured Integrated Development Environment (IDE) for **Test-as-Code**. 

Whether you are writing declarative test cases, orchestrating test runs, managing enterprise test plans, or executing speculative plans against your test management provider (GitHub, Jira, Zephyr, Xray, or local offline storage), Testform for VS Code delivers real-time language intelligence, instant execution feedback, and deep lifecycle tooling.

---

## 🚀 What's New in v1.1.0

The **v1.1.0** release introduces major improvements to test execution accuracy, state reconciliation, autocompletion scoping, and UI ergonomics:

- **🎯 Canonical TestRun State Reconciliation (`scenarioPlayTarget`)**:
  - Gutter play buttons on scenarios inside TestRun suites (`*.run.feature`) now execute directly against the parent TestRun suite identity (`testcycle/run.feature.@tr-X`). This ensures execution results and status updates are persisted into `testform.state`.
  - Configurable via `testform.testController.scenarioPlayTarget` (`"testrun"` by default, or `"testcase"`).
- **🔒 Execution Mutex Guard**: Prevents terminal command collisions and accidental double-clicks during test execution.
- **🔍 Rule-Scoped Scenario Autocompletions**: When authoring TestRuns, scenario targets are strictly filtered to the test cases declared in the referenced `Rule:` feature file.
- **🏷️ Flexible Target Formatting (`testform.testrun.targetFormat`)**: Autocomplete targets using short identity tags (`@tc-1`) or classic addresses (`path.@tc-1`).
- **📊 State Explorer Relational Inspection**: Drill down into executed test cases inside each TestRun (`Executed Cases (<count>)`), and review TestRuns associated with TestPlans.
- **🎨 Visual & Gutter Polish**:
  - Removed redundant text status brackets (`[PASSED]`, `[PENDING]`, `[FAILED]`) in favor of intuitive native VS Code status icons and theme colors.
  - Restricted gutter play buttons strictly to `Scenario:` header lines, avoiding duplicate play icons on metadata rows.
  - Eliminated duplicate `"Testform: Testform: ..."` prefixes in the Command Palette.
  - Dynamically isolated starter snippets so they only suggest on empty files.

---

## 📚 Official Documentation

Comprehensive guides, API specifications, and interactive language references are available at the official documentation portal:

👉 **[Official Testform Documentation Portal](https://fromeroc9.github.io/testform-docs/)**

- **Getting Started:** [Quickstart & Installation Guide](https://fromeroc9.github.io/testform-docs/es/docs/getting-started/)
- **Configuration Language:** [DSL, Blocks, Providers & State Reference](https://fromeroc9.github.io/testform-docs/es/docs/language/)
- **CLI Reference:** [Testform CLI Commands & Flags](https://fromeroc9.github.io/testform-docs/es/cli/)
- **Documentation Repository:** [fromeroc9/testform-docs](https://github.com/fromeroc9/testform-docs)

---

## 🚀 Key Features

### 1. ⚡ Gherkin & Testform DSL IntelliSense
- **Expression Autocompletion:** Native autocompletion for `${var.*}`, `${local.*}`, `${data.*}`, `${module.*}`, and environment variables `${env.*}` directly inside `.feature` steps and docstrings.
- **Built-in Functions:** Full IntelliSense and argument snippet insertion for core functions:
  - **Strings:** `lower()`, `upper()`, `trim()`, `trimprefix()`, `trimsuffix()`, `startswith()`, `endswith()`, `replace()`, `split()`, `join()`, `format()`, `substr()`.
  - **Collections & Maps:** `contains()`, `coalesce()`, `lookup()`, `length()`, `element()`, `slice()`, `merge()`.
  - **System & Encoding:** `env()`, `uuid()`, `timestamp()`, `jsonencode()`, `jsondecode()`, `file()`.
- **Smart Tag Suggestions:** Context-aware completion for identity tags (`@tc-X`, `@tr-X`, `@tp-X`) automatically calculating the next available sequential ID.
- **Custom Field Tags:** Auto-suggests custom fields and their permitted enum values (e.g. `@priority:Critical`, `@component:Auth`, `@severity:Blocker`).

### 2. 🔄 Multi-Layer Variable & Manifest Autoload
- Testform continuously monitors your workspace, aggregating variables and local definitions across:
  1. Base manifests (`main.yml`, `testform.yml`).
  2. Domain modular manifests (`variable.yml`, `variables.yml`, `locals.yml`, `data.yml`, `resource.yml`, `output.yml`).
  3. Environment auto-load files (`*.vars.yml`, `*.vars.yaml`) loaded in strict alphabetical order.
- Immediate autocompletion with live type badges, defaults, and source file locations.

### 3. 🔍 Go to Definition & Hover Documentation
- **F12 / Ctrl+Click:** Jump directly from any `${var.endpoint}` or `${local.auth_token}` reference in a `.feature` file to its YAML definition line.
- **Rich Hover Cards:** Hover over any variable, local, or module output to inspect its evaluated expression, default value, type, description, and source manifest path.
- **Cross-File Dependency Navigation:** Navigate `@depends_on("path/to.case.feature.@tc-1")` references with instant jump-to-target.

### 4. 🛡️ Real-Time Diagnostics & Quality Gates
- **Undeclared Variables:** Highlights `${var.foo}` or `${local.bar}` references that do not exist in workspace manifests as editor warnings.
- **Dependency Directives (`@depends_on`):** Detects empty dependency targets, self-dependencies, non-existent internal tags, and missing target feature files.
- **Identity Uniqueness:** Flags duplicate identity tags (`@tc-X`, `@tr-X`, `@tp-X`) before you run `testform plan` or push to version control.
- **Schema Validation:** In-editor schema validation for `main.yml`, `variable.yml`, and `*.vars.yml`.

### 5. 🧪 Native Test Explorer (VS Code Test Controller)
- Deep integration with VS Code's native **Testing** sidebar.
- Automatically discovers executable test suites (`.run.feature`) and individual test scenarios.
- Run tests directly from gutter Play icons next to scenarios or feature titles.
- **Live State Synchronization:** Watches `testform.state` and updates test statuses (`Passed`, `Failed`, `Skipped`, `Unexecuted`) dynamically as executions complete.

### 6. 📊 Testform Sidebar Views
Located in the dedicated **Testform Activity Bar** tab:

1. **State Explorer (`testform.views.state`):**
   - Hierarchical inspection of managed resources (`testcase`, `testrun`, `testplan`, custom data sources, outputs).
   - Visual status badges (e.g., tainted resources, verification checkmarks).
   - **Inspect Resource:** Opens formatted resource state JSON in an editor tab.
   - **Taint / Untaint:** Mark resources for recreation on next apply without terminal typing.
   - **State Remove:** Remove an item from the state ledger (`testform state rm`).
   - **Force Unlock:** Release stale state locks with guided lock ID prompts.

2. **Modules & .testform View (`testform.views.modules`):**
   - **Declared Modules:** Modules specified in `main.yml` with their source URLs and declared outputs.
   - **Installed Modules:** Inspect frozen copies inside `.testform/modules/`.
   - **Local Policies:** Custom quality rules located under `.testform/policies/`.
   - **Cache & Environment:** Quick access to `.testform/environment`, `.testform/cache/backend.json`, and `.testform/cache/lock.json`.

3. **Reports & Analytics (`testform.views.reports`):**
   - One-click report triggers: Test Case Summary, Test Run Summary, Detailed Runs, Test Plan Summary, Coverage Matrix, Traceability Matrix, and Quality Audit.
   - Instant export picker for **Markdown**, **Microsoft Word (.docx)**, **Microsoft Excel (.xlsx)**, **JSON**, or **CSV**.

### 7. 📑 Specs & Execution Hub (Webview Dashboard)
- Open a full-screen, interactive dashboard via `Testform: Open Test Cases, Runs & Plans Hub`.
- Search, filter by tags, and visualize all specifications across your repository.
- Jump directly to any feature file line or execute targeted speculative plans (`testform plan -target=...`) directly from the UI.

### 8. 🌐 Isolated Workspace Switcher
- View and switch between active workspaces (`default`, `staging`, `production`) from the status bar item `$(layers) Testform: <workspace>`.
- Automatically tracks `.testform/environment`.
- Prompt-based creation (`testform workspace new <name>`) and deletion of isolated test environments.

### 9. ✨ Intelligent Gherkin Formatter
- Format `.feature` files instantly via `Shift+Alt+F` / `editor.action.formatDocument`.
- Automatically aligns Feature, Rule, Background, Scenario, steps (`Given`/`When`/`Then`), DocStrings, and Data Tables.
- Full bilingual keyword support (English and Spanish: `Característica`, `Regla`, `Antecedentes`, `Escenario`, `Dado`, `Cuando`, `Entonces`, `Y`, `Pero`, `Ejemplos`).

---

## ⌨️ Command Palette Catalog

Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) and type `Testform`:

| Command | Identifier | Description |
| :--- | :--- | :--- |
| **Testform: Open Control Center Menu** | `testform.menu` | QuickPick menu displaying all available core workflows and commands. |
| **Testform: Initialize Workspace (init)** | `testform.init` | Runs `testform init` to install providers and download modules. |
| **Testform: Validate Configuration** | `testform.validate` | Verifies YAML syntax, scope definitions, and variables without executing. |
| **Testform: Speculative Plan (plan)** | `testform.plan` | Generates a speculative execution diff against the state ledger. |
| **Testform: Apply Changes (apply)** | `testform.apply` | Reconciles state and triggers test execution across configured providers. |
| **Testform: Show State Drift (diff)** | `testform.diff` | Detects drift between `.feature` files on disk and the state ledger. |
| **Testform: Inspect State or Plan (show)** | `testform.show` | Human-readable inspection of resources and attributes in state. |
| **Testform: Select Workspace** | `testform.workspace.select` | Switch or create isolated workspace environments. |
| **Testform: Force Unlock State** | `testform.state.forceUnlock` | Unlocks a stuck state file (`testform force-unlock <ID> -force`). |
| **Testform: Generate Report** | `testform.report` | Generates exportable quality reports (.md, .docx, .xlsx, .json, .csv). |
| **Testform: Open Test Cases, Runs & Plans Hub** | `testform.specs.openHub` | Opens the full-screen Specs & Execution Webview Hub. |
| **Testform: Show Providers Tree** | `testform.providers` | Displays configured provider plugins and version constraints. |
| **Testform: List Declared Modules** | `testform.modules.list` | Lists declared and downloaded feature modules. |
| **Testform: Update Modules** | `testform.modules.update` | Re-initializes and updates remote Git modules. |
| **Testform: Refresh State Explorer** | `testform.state.refresh` | Reloads the state tree in the sidebar. |
| **Testform: Format Document** | `testform.format` | Formats current Gherkin `.feature` file. |

---

## ⚙️ Configuration Settings

Customize extension behavior in your `settings.json`:

```json
{
  // Path to the testform executable binary (default: "testform" from PATH)
  "testform.executablePath": "testform",

  // Enable the Testform Gherkin formatter as the default formatter for .feature files
  "testform.format.enable": true,

  // Enable real-time syntax, variable resolution, and dependency diagnostics
  "testform.diagnostics.enable": true,

  // Automatically insert a leading space when completing field values immediately following '='
  "testform.editor.autoSpaceAfterEquals": true,

  // Enable native VS Code Test Controller integration (Test Explorer tree & gutter run icons)
  "testform.testController.enable": true,

  // Target address passed to 'testform apply' when executing a scenario play action
  // "testrun" targets the parent TestRun suite (e.g. testcycle/run.feature.@tr-1) to reconcile state
  // "testcase" targets the specific referenced TestCase address directly
  "testform.testController.scenarioPlayTarget": "testrun",

  // Target insertion format for scenario targets inside TestRun rules
  // "short" inserts '@tc-01'
  // "classic" inserts 'Magento/cart.case.feature.@tc-01'
  "testform.testrun.targetFormat": "short",

  // Trace communication between VS Code and the Testform Language Server
  "testform.trace.server": "off" // "off" | "messages" | "verbose"
}
```

### Recommended `.vscode/settings.json` for Projects

```json
{
  "[gherkin]": {
    "editor.defaultFormatter": "fromeroc9.testform",
    "editor.formatOnSave": true
  },
  "[yaml]": {
    "editor.insertSpaces": true,
    "editor.tabSize": 2
  }
}
```

---

## 💡 Code Snippets

### Gherkin Snippets (`.feature`)

| Prefix | Description | Body |
| :--- | :--- | :--- |
| `tf-testcase` | Standard TestCase Feature template | `@testcase Feature: ... Scenario: ... Given/When/Then` |
| `tf-scenario` | Single Test Scenario | `Scenario: ... Given/When/Then` |
| `tf-scenario-outline` | Scenario Outline with Examples table | `Scenario Outline: ... Examples: \| ... \|` |
| `tf-testrun` | Complete TestRun Suite manifest | `@testrun @tr-1 Feature: ... Rule: ... * mark status = ...` |
| `tf-run-rule` | TestRun Rule linking feature | `Rule: path/to.case.feature Scenario: ...` |
| `tf-testplan` | Complete TestPlan manifest | `@testplan @tp-1 Feature: ... Rule: ...` |
| `tf-depends-on` | Dependency tag directive | `@depends_on("path/to.case.feature.@tc-1")` |

### YAML Snippets (`main.yml`, `variable.yml`)

| Prefix | Description |
| :--- | :--- |
| `tf-main` | Complete starter `main.yml` with provider, backend, and scopes |
| `tf-variable` | Input variable block with type, default, and description |
| `tf-local` | Computed local value block |
| `tf-module` | External module declaration block with Git source |
| `tf-data` | Data source block |
| `tf-output` | State output block |

---

## 📦 Installation & Setup

### Prerequisites
1. **Node.js** (v18.0.0 or higher).
2. **Testform CLI** installed globally:
   ```bash
   npm install -g @fromeroc9/testform
   ```
   Verify installation:
   ```bash
   testform --version
   ```

### Installing the Extension
- **From Visual Studio Code Marketplace:** Search for `Testform` by `fromeroc9` and click **Install**.
- **Manual VSIX Installation:**
  ```bash
  code --install-extension testform-dsl-1.1.0.vsix
  ```

---

## 🛠️ Contributing & Development

```bash
# 1. Clone repository
git clone https://github.com/fromeroc9/testform-vscode.git
cd testform-vscode

# 2. Install dependencies
npm install

# 3. Compile client and server bundles
npm run build

# 4. Launch debugging host in VS Code
# Press F5 in Visual Studio Code

# 5. Package as VSIX
npm run package
```

---

## 📋 Release Notes & Changelog

For a complete and detailed log of changes across versions, see [CHANGELOG.md](CHANGELOG.md):

- **[v1.1.0 (Latest)](CHANGELOG.md#110---2026-10-29)**: TestRun state reconciliation, rule-scoped autocompletion, configurable target formats, relational state explorer, and UI polish.
- **[v1.0.0](CHANGELOG.md#100---2026-10-28)**: Initial production release: Full-Screen Specs Hub, bilingual Gherkin LSP, native Test Explorer, state management, and YAML manifest autoload.

---

## 📄 License

This extension is licensed under the **GNU General Public License v3.0 or later (GPL-3.0-or-later)**.  
See [LICENSE](LICENSE) for details.

Developed with ❤️ by **Flavio Romero** (<flavio.arc9@gmail.com>).
