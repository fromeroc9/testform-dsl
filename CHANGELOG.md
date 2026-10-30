# Changelog

All notable changes to the **Testform** Visual Studio Code extension (`fromeroc9.testform`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
