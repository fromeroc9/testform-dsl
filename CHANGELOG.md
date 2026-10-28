# Changelog

All notable changes to the **Testform** Visual Studio Code extension (`fromeroc9.testform`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-10-28

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
- **Pure Standard Language Architecture**: Deprecated proprietary `testform-yaml` and `testform-gherkin` language IDs in favor of standard `yaml` and `gherkin`, eliminating conflicts with Red Hat YAML, Prettier, and third-party linters.
- **Single Dash CLI Standards**: Enforced single dash flags (`-target`, `-auto-approve`, `-format`, `-lock`) across all CLI terminal commands.
- **Clean Feature Views**: Removed redundant and noisy CodeLens buttons from scenario headers.
- **Specs View Relocation**: Migrated the test specification tree from the sidebar into the new full-width Specs Hub Editor Tab.
