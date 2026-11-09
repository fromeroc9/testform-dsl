# Changelog

All notable changes to the **Testform** Visual Studio Code extension (`fromeroc9.testform-dsl`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.3] - 2026-11-09

### Added

#### ⚡ Visual Plan Diff Webview (`testform.showPlanDiff`)
- **Interactive Visual Plan Inspector (`src/client/views/plan-diff-panel.ts`):**
  - Dedicated rich Webview panel rendering `testform plan -json` execution output.
  - Color-coded change visualization:
    - 🟢 **To Add (`+`)**: Green cards showing new resources to create.
    - 🟡 **To Change (`~`)**: Yellow cards highlighting modified attributes and hash drifts.
    - 🔴 **To Destroy (`-`)**: Red cards for resources pending deletion.
    - 🔵 **To Replace (`+/-`)**: Purple cards indicating destructive re-creations.
  - Live search bar and action filter pills (`All`, `Add`, `Change`, `Destroy`, `Replace`) for instant multi-factor inspection.
  - Expandable Gherkin step views with highlighted keywords (`Given`, `When`, `Then`, `* set`).
  - Clickable file location links opening the exact file and line in the active VS Code editor.
  - Integrated one-click actions:
    - **Apply Plan (`testform apply`)**: Directly trigger execution in the terminal.
    - **Apply (-auto-approve)**: Fast-track execution.
    - **Re-Plan**: Instant recalculation of speculative plan.

#### 🕰️ State Time Machine (`testform.views.history`)
- **Git-Powered State History Tree Provider (`src/client/views/time-machine-view.ts`):**
  - Dedicated sidebar tree view discovering all Git revisions that modified `testform.state`.
  - Serializes commit hashes, authors, relative timestamps, commit messages, and state serial badges (`[#serial]`).
  - Expandable node inspecting resource breakdowns per snapshot (Serial, Lineage, Provider, Test Cases, Runs, Plans, and Bugs count).
- **Virtual Document Diff Engine (`StateRevisionContentProvider`):**
  - Custom virtual URI scheme (`testform-state-revision://`) streaming historical states on-demand via `git show <commit>:testform.state`.
  - Seamless native VS Code Diff (`vscode.diff`) comparing any historical state revision against the current working state with zero disk clutter.
  - One-click **Restore State from Commit** action with modal confirmation dialog to safely roll back or revert `testform.state`.

---

## [1.0.2] - 2026-11-09

### Added

#### ⚡ Real-Time LSP Incremental Indexing
- **Live Content Change Processing (`server.ts`, `workspace-scanner.ts`):**
  - Switched document change pipeline to `documents.onDidChangeContent`, enabling live AST parsing, scenario indexing, and diagnostics without requiring manual file saves.
  - Scope detection prioritized by special root tags (`@testcase`, `@testrun`, `@testplan`, `@bug`), followed by file naming conventions and `main.yml` scope mapping.

#### 💡 Enriched `Rule:` Autocompletion
- **Interactive Markdown Documentation (`completions.ts`):**
  - `Rule:` step autocompletions now display detailed scenario count, full file namespace path, and formatted markdown documentation previews in the IntelliSense widget.

#### 🛡️ Homonym Collision Diagnostics & Quick Fix
- **Duplicate Basename Warning (`diagnostics.ts`, `codeactions.ts`):**
  - Warns developers when multiple `.feature` files share the same basename without namespace segregation across folders.
  - One-click Quick Fix code action (`Add @ns("${folder}") namespace tag`) to instantly prepend the namespace tag and disambiguate references.

#### 🔍 State Explorer Resource Filtering
- **Interactive State Search (`state-view.ts`, `extension.ts`):**
  - Added `testform.filterState` command and title bar search button to instantly filter the State Explorer tree by resource ID, scenario name, or tag.
  - Added `testform.clearStateFilter` command and reset button to quickly return to the full state view.

#### ⌨️ QA Fast Pass Keybindings
- **Ergonomic Testing Shortcuts (`package.json`, `extension.ts`):**
  - Wired direct command shortcuts: `Alt+P` for `testform.plan`, `Alt+F` for `testform.formatFile`, `Alt+B` for `testform.validate`.

#### 🔄 DSL Keyword Modernization: `* set` (Replaced `* mark`)
- **IntelliSense & Language Server:**
  - Autocompletions now provide `set status = ...`, `set target = ...`, `set trace = ...`, and `set evidence = ...` snippets in `.run.feature` and `.bug.feature` documents.
  - Hover and go-to-definition providers upgraded to detect `* set target = ...` and `* set status = ...`.
- **QA Fast Pass Controller:**
  - Automated status shortcut insertions update and inject `* set status = <passed|failed|...>` lines cleanly.
- **Snippets:**
  - Updated Gherkin snippet prefix `tf-set` generating standard `* set status = ...` directives.

### Changed & Fixed

#### 🧹 Codebase Cleanup & Modernization
- Removed dead code, unused helper methods, and redundant variables across language server and extension client code.
- Clean compilation passing `tsc --noUnusedLocals --noUnusedParameters` with 0 warnings.

---

## [1.0.1] - 2026-11-06

### Added

- **Policies & Governance:**
  - Added built-in system policy `bug-target-integrity` (`warning`) ensuring bug scenarios declare either a `target =` mark, a `trace =` reference, or a traceability tag (`@tc-*` / `@tr-*`).
  - Added full support for `bug` scope in Policies & Governance tree view and diagnostic checks.
- **Language Server (LSP Diagnostics):**
  - Added real-time scenario-level validation in `diagnostics.ts` for `.bug.feature` files flagging bug scenarios lacking traceability targets.

#### Dynamic Custom Field Detection Engine
- **Workspace-wide Custom Field Scanner (`field-detector.ts`)**:
  - Automatically analyzes workspace YAML manifests (`main.yml`, `testform.yml`, `resource.yml`), the active state file (`testform.state` / `.testform/testform.state`), and all workspace `.feature` files.
  - Dynamically registers custom field names, exact occurrence counts, and provenance origins (`manifest`, `testform.state`, `*.feature`) while safely excluding native attributes (`status`, `target`, `trace`, `evidence`, etc.).
  - Serves as the central data source for field-aware reporting throughout the extension.

#### Interactive Reports Explorer (`ReportsTreeProvider`)
- **Granular Custom Field Selection**:
  - Reports in the Reports view now expand to reveal an interactive checklist of all detected project custom fields using native VS Code tree item checkboxes (`checkboxState`).
  - Users can toggle individual custom fields, select all (`testform.report.selectAllFields`), or deselect all (`testform.report.deselectAllFields`).
- **Inline Format Selector (`testform.report.selectFormat`)**:
  - Direct format picker toolbar and inline action supporting Excel (`xlsx`), Markdown (`md`), Word (`docx`), CSV (`csv`), and JSON (`json`).
- **Direct Report Execution (`testform.report.runWithSelection`)**:
  - One-click inline Play button to trigger `testform report <slug> -format=<fmt> --fields="all|none|field1,field2"` in the integrated terminal.
- **Custom Report Discovery**:
  - Dynamically scans `.testform/reports/*.ts` and `*.js` for user-defined custom reports and exposes them alongside core reports.

#### Specs Hub Export Drawer (`SpecsHubPanel`)
- **Slide-out Report Export Panel**:
  - Added an interactive collapsible Export Drawer inside the full-screen Specs Hub Webview.
  - Interactive controls including report type dropdown, format selection radio chips (Excel, Markdown, Word, CSV, JSON), and an active custom fields checklist with live count badges.
  - "Generar y Abrir Reporte" button delegates directly to `testform report` with selected filters and flags.

#### Unified Dual-Mode Explorer (`StateTreeProvider`)
- **Dual-Mode Switcher**:
  - Seamlessly toggles between **State Mode** (`testform.state`) and **Files Mode** (workspace `.feature` specification hierarchy) via top navigation bar actions (`testform.explorer.switchToFiles` and `testform.explorer.switchToState`).
- **Copy Canonical Address**:
  - Added `testform.state.copyAddress` command across tree nodes (resources, testcases, executed runs, and scenario items) to quickly copy addresses for CLI execution or suite references.

#### Language Server Protocol (LSP) Intelligence
- **Intelligent Document Scope Detection (`detectDocumentScope`)**:
  - Accurately classifies documents as `testcase`, `testrun`, `testplan`, or `bug` based on file tags, identity prefixes (`@tc-`, `@tr-`, `@tp-`, `@bg-`), path matching, and manifest `scopes:` configuration.
- **Context-Aware `Rule:` & `Scenario:` Autocompletions**:
  - `Rule:` step autocompletes `*.case.feature` within testruns, and `*.run.feature` within testplans.
  - `Scenario:` completion provides scenario target addresses within enclosing rules, respecting `testform.testrun.targetFormat` (`tag`, `tag-bare`, `canonical`, `file-tag`, `slug-tag`, `name`, `short`, `classic`).
- **Smart DSL Mark Step Snippets**:
  - Enhanced snippets and auto-replacements for `* mark status = ...`, `* mark target = ...`, `* mark trace = ...`, and `* mark evidence = ...`.

#### TestRun Architecture & Direct Canonical Addresses
- **Dual Support (Direct Addresses & Rule-based Suites)**:
  - Full support for the evolved testrun format with direct canonical targets (`Scenario: auth/login.case.feature.@tc-01`) or explicit target steps (`* mark target = ...`) without requiring an enclosing `Rule:` block.
  - Maintained 100% retrocompatibility with legacy `Rule: <path>` + `Scenario: <target>` suites.
  - Native Test Explorer and gutter play buttons automatically adapt whether scenarios are grouped under Rules or directly under the Feature.

#### Defect & Bug Tracking Resource (`.bug.feature`)
- **Native Support for Bugs & Defects**:
  - Full support for `.bug.feature` file extension, `@bug` resource tag, and `@bg-X` identity tags.
  - Automatic sequential ID suggestion (`@bg-01`, `@bg-02`) and duplicate ID detection diagnostics.
  - New `tf-bug` scaffolding snippet in empty `.feature` files.
  - Added `Bugs & Defects` category in State Explorer with `ThemeIcon('bug')`, displaying Target, Status, Custom Fields (`severity`, `priority`), Trace, and Evidence.

#### DSL Mark & Field System
- **Canonical Execution Marks**:
  - Added completions, hover documentation, and syntax highlighting for `* mark target = ...`, `* mark trace = ...`, and `* mark evidence = ...`.
  - Suggests workspace scenario addresses automatically when typing `* mark target = `.
- **Custom Fields Transparency**:
  - Clarified across hover tooltips and completions that `severity` and `priority` are user-configurable `custom_fields` stored in `custom_fields.*` in `testform.state`, declared via standard `* field <name> = <val>` steps or plain tags (`@critical`), strictly rejecting non-standard `@severity:...` syntax.

#### Configuration, Cache & Environment
- **Environment Variable Ingestion**:
  - LSP workspace scanner automatically ingests `TESTFORM_VAR_*` and `TF_VAR_*` environment variables into `scanner.config.variables`, eliminating false "Undeclared variable" diagnostics.
- **Cache Path Alignment**:
  - Backend detector in Modules view now resolves `.testform/cache/backend.json` with fallback to `.testform/backend.json`.
- **JSON Schema & Syntax Grammar**:
  - Added `bug` resource definition and allowed `additionalProperties` for custom providers and GitLab configuration in `testform.schema.json`.
  - Updated TextMate grammar for `@bug`, `@bg-`, and canonical marks.

### Changed
- **Default Report Output Format to Markdown (`md`):**
  - Updated `ReportsTreeProvider` default output format from `xlsx` to `md`, ensuring reports generated by default produce clean, lightweight Markdown documents directly viewable inside VS Code.
  - Prioritized `md` as the primary option in the `testform.report.selectFormat` QuickPick selector.

---

## [1.0.0] - 2026-10-29

### Added

#### Test Execution & State Reconciliation
- **Canonical TestRun Execution (`scenarioPlayTarget`)**:
  - Gutter play button on scenarios inside TestRun suites (`*.run.feature`) now automatically resolves and targets the parent TestRun suite identity (`testcycle\run.feature.@tr-X`) instead of the referenced testcase identity (`testcase\case.feature.@tc-Y`). This ensures Testform properly executes the run and reconciles execution status updates directly into `testform.state`.
  - Added setting `testform.testController.scenarioPlayTarget` (`testrun` | `testcase`) to configure whether playing a scenario targets the parent TestRun suite (default) or runs the individual testcase directly.
- **Execution Mutex Guard**:
  - Added concurrency lock (`isExecuting`) to prevent overlapping test executions, rapid double-clicks, and terminal command collision.
- **State Explorer Relational Inspection**:
  - Added support in State Explorer for expanding executed test cases under each TestRun (`Executed Cases (<count>)`), displaying scenario titles, identities, and live statuses.
  - Added support for inspecting TestRuns associated with TestPlans.

#### Language Server & Autocompletion
- **Rule-Scoped Scenario Targets**:
  - Scenario autocompletion inside `Rule: <path>` in a `*.run.feature` file is now strictly delimited to test cases declared within that referenced feature file.
- **Configurable Scenario Target Formats (`testform.testrun.targetFormat`)**:
  - Added support for autocompleting scenario targets using short tag identity (`@tc-1`), scenario title (`tc-1: Title`), or classic address (`path.@tc-1`), configurable via `testform.testrun.targetFormat`.
- **Field & Enum Autocompletion Enhancements**:
  - Enhanced autocompletion for `* field <name> = <value>` with automatic space formatting and enum value suggestions.
  - Tag suggestions grouped by field name with clear semantic category labels (`field`, `resource`, `identity`).
- **Orphan `@` Diagnostic Validator**:
  - Added real-time diagnostic reporting for stray or malformed `@` characters not attached to valid tag identifiers.

#### Documentation & Links
- **Official Documentation Portal**:
  - Added direct link to the official Testform documentation portal (`https://fromeroc9.github.io/testform-docs/`) in `README.md`.

---

### Fixed

#### Test Explorer & Gutter Controls
- **Duplicate Test Items in Test Controller**:
  - Resolved duplicate node keys when registering scenarios and rules in the native VS Code Test Explorer tree.
- **Gutter Play Button Range Collision**:
  - Restricted gutter run icons strictly to the `Scenario:` declaration line range, preventing execution buttons from appearing on metadata lines like `* mark status`.
- **Orphan Zombie Scenario Nodes**:
  - Fixed issue where scenario nodes from previous runs or malformed files appeared as root-level orphans in the Test Explorer tree by enforcing strict parent-child hierarchy under their declaring `Rule:`.
- **CLI Flag Redundancy**:
  - Removed redundant `-chdir="${rootPath}"` argument from `applyCurrent` and `planCurrent` terminal commands.

#### Autocompletions & Snippets
- **Snippet Pollution in Active Files**:
  - Removed static `tf-*` snippet contributions from `package.json` that cluttered scenario and rule completion lists during regular editing.
  - Template scaffolding snippets are now dynamically provided exclusively when opening or editing completely empty `.feature` files.

### Added

#### Specification Management & Specs Hub
- **Full-Screen Specs Hub (`SpecsHubPanel`)**:
  - Implemented an interactive, full-screen Editor Tab Webview for specification and execution management.
  - **KPI Metrics Dashboard**: Instant overview of total Test Cases (files and scenario counts), Test Run execution suites, and Test Plan release milestones.
  - **Live Filter & Search**: Instant client-side filtering across features, scenarios, and metadata tags (`@smoke`, `@auth`, `@tc-*`, etc.).
  - **Multi-Tab Organization**: Dedicated views for Test Cases (`*.case.feature`), Test Runs (`*.run.feature`), and Test Plans (`*.plan.feature`).
  - **Direct Jump Navigation**: One-click jump directly to the target file and exact line number in the code editor.
  - **Integrated Execution Actions**: Trigger speculative planning (`testform.plan`) and reconciliation (`testform.apply`) directly from the hub.
  - **Reactive Synchronization**: Automatically re-scans and updates when `.feature` files are created, modified, or deleted.

#### Gherkin & Testform DSL Syntax
- **Multilingual BDD Syntax Highlighting**:
  - Full native support for English and Spanish Gherkin keywords (`Feature` / `Característica`, `Scenario` / `Escenario`, `Rule` / `Regla`, `Given` / `Dado`, `When` / `Cuando`, `Then` / `Entonces`, `And` / `Y`, `But` / `Pero`, `Examples` / `Ejemplos`, `Background` / `Antecedentes`).
  - Highlighting for BDD strings, tables (`|`), comments (`#`), and triple-quote docstrings (`"""`, ` ``` `).
- **Testform DSL Engine**:
  - Template interpolations and variable resolution: `${var.*}`, `${local.*}`, `${data.*}`, `${module.*}`, `${env.*}`, and built-in functions (`lower`, `upper`, `trim`, `coalesce`, `jsonencode`, etc.).
  - Scenario and suite tags: `@testcase`, `@testrun`, `@testplan`, `@tc-*`, `@tr-*`, `@tp-*`, `@depends_on(...)`, `@module(...)`, `@target(...)`.
  - Reconciler DSL: `* mark status = [passed|failed|skipped|blocked|pending|unexecuted]`.
  - Metadata DSL: `* field <name> = <value>` with validation for declared enums and required fields.

#### Native Test Explorer (`vscode.TestController`)
- Visual Test Tree discovering all BDD test cases, run suites, and plans in the workspace.
- Gutter execution icons restricted cleanly to Feature definitions.
- Interactive status selection prompt (`passed`, `failed`, `blocked`, `skipped`, `pending`) before applying state changes.
- Automatic scenario reference resolution for Test Runs and Test Plans.

#### Language Server & Diagnostics
- Real-time diagnostics for unresolved variable paths, syntax errors, and missing required testcase fields.
- Enum value validation: Warns/errors immediately when assigning values outside declared schema enums.
- Context-aware autocompletion for variables, locals, data sources, modules, built-in functions, tags, and Outline parameter tables.
- Rich hover cards with documentation, resolved types, and default values.
- Go-to-Definition (`F12`) across features, module declarations, and variable files.

#### Sidebars & Explorers
- **State Explorer**:
  - Interactive tree view of resources recorded in `testform.state`.
  - Resource JSON inspector command (`testform.state.inspectResource`).
  - Taint (`testform state taint`) and Untaint (`testform state untaint`) actions.
  - Resource removal (`testform state rm`) and Force Unlock (`testform force-unlock`).
- **Modules & .testform Explorer**:
  - Inspection of declared modules, installed packages, environments, and governance policies.
- **Reports & Analytics**:
  - Quick generation of official reports: Test Case Summary, Test Run Detailed, Coverage Matrix, Traceability Matrix, and Quality Audit.

#### Visual Polish & Icon Integration
- **Double-Icon Folder for `.testform`**: Custom folder icon featuring the official Testform isometric logo overlaid on the folder corner, matching the design of `.vscode`.
- **Custom File Icons**: Integrated file icons for `main.yml`, `testform.yml`, `variable.yml`, `locals.yml`, `staging.yml`, `*.vars.yml`, and `testform.state`.
- **Non-Intrusive File Decorations**: Highlights Testform configuration files with the `TF` badge without altering default editor text colors.
- **Workspace Manager**: Status bar item showing the active Testform environment (`default`, `staging`, `dev`) with a quick environment switcher.

---

### Changed

#### Visual Polish & Clean Interface
- **Intuitive Status Icons in Views**:
  - Removed redundant text brackets (`[PASSED]`, `[PENDING]`, `[FAILED]`) from both State Explorer and Test Controller tree items, relying on native VS Code theme icons and status colors (green checkmark, yellow circle, red cross).
- **Cleaner Autocompletion Popups**:
  - Eliminated redundant detail header string in `Rule:` and `Scenario:` completion popups to prevent duplicate info blocks.
  - Restored rich, structured Markdown info cards for Test Case Feature Targets, Test Run Targets, and Test Case Scenarios.
- **Granular English Settings**:
  - Standardized all extension settings in `package.json` into clear, granular English descriptions and categories.
- **Command Palette Deduplication**:
  - Removed redundant `"Testform: "` prefix from command titles in `package.json`, preventing double prefix display (`Testform: Testform: ...`) in the VS Code Command Palette.
- **Authentic Branding Assets**:
  - Restored high-resolution isometric logo with full transparency, eliminating background borders and cleaning up redundant asset files.
- **Pure Standard Language Architecture**: Deprecated proprietary `testform-yaml` and `testform-gherkin` language IDs in favor of standard `yaml` and `gherkin`, eliminating conflicts with Red Hat YAML, Prettier, and third-party linters.
- **Single Dash CLI Standards**: Enforced single dash flags (`-target`, `-auto-approve`, `-format`, `-lock`) across all CLI terminal commands.
- **Clean Feature Views**: Removed redundant and noisy CodeLens buttons from scenario headers.
- **Specs View Relocation**: Migrated the test specification tree from the sidebar into the new full-width Specs Hub Editor Tab.
