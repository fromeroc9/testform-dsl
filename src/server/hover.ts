import { Hover, MarkupKind, Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceScanner } from './workspace-scanner';

export function provideHover(
  document: TextDocument,
  position: Position,
  scanner: WorkspaceScanner
): Hover | null {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Match expressions: ${...}
  const exprRegex = /\$\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = exprRegex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (offset >= start && offset <= end) {
      const exprContent = match[1].trim();

      // Check var.<name>
      const varMatch = exprContent.match(/\bvar\.([a-zA-Z0-9_]+)\b/);
      if (varMatch) {
        const varName = varMatch[1];
        const info = scanner.config.variables.get(varName);

        if (info) {
          const fileName = info.sourceFile.split(/[/\\]/).pop();
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: [
                `### Testform Variable: \`${varName}\``,
                `**Type:** \`${info.type || 'string'}\``,
                `**Default:** \`${JSON.stringify(info.defaultValue ?? null)}\``,
                info.description ? `**Description:** ${info.description}` : '',
                `---`,
                `*Declared in:* \`${fileName}\` (${info.sourceFile})`
              ].filter(Boolean).join('\n\n')
            }
          };
        } else {
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: `⚠️ **Undeclared variable:** \`${varName}\`\n\nThis variable is referenced but has not been declared in any \`variable:\` block in the workspace.`
            }
          };
        }
      }

      // Check local.<name>
      const localMatch = exprContent.match(/\blocal\.([a-zA-Z0-9_]+)\b/);
      if (localMatch) {
        const localName = localMatch[1];
        const info = scanner.config.locals.get(localName);

        if (info) {
          const fileName = info.sourceFile.split(/[/\\]/).pop();
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: [
                `### Testform Local: \`${localName}\``,
                `**Expression:** \`${info.expression}\``,
                `---`,
                `*Declared in:* \`${fileName}\` (${info.sourceFile})`
              ].join('\n\n')
            }
          };
        } else {
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: `⚠️ **Undefined local:** \`${localName}\`\n\nThis local value is referenced but has not been defined in any \`locals:\` block in the workspace.`
            }
          };
        }
      }

      // Check module.<name>.<output>
      const modMatch = exprContent.match(/\bmodule\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\b/);
      if (modMatch) {
        const modName = modMatch[1];
        const outName = modMatch[2];
        const modInfo = scanner.declaredModules.get(modName);
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: [
              `### Testform Module Output: \`${modName}.${outName}\``,
              modInfo ? `**Module Source:** \`${modInfo.source}\`` : `*Custom declared module*`,
              `---`,
              `*Exported output attribute from module*`
            ].join('\n\n')
          }
        };
      }

      // Check data.<name> or data.<type>.<name>
      const dataMatch = exprContent.match(/\bdata\.([a-zA-Z0-9_.]+)\b/);
      if (dataMatch) {
        const dataKey = dataMatch[1];
        const info = scanner.config.dataSources.get(dataKey);

        if (info) {
          const fileName = info.sourceFile.split(/[/\\]/).pop();
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: [
                `### Testform Data Source: \`${dataKey}\``,
                `**Type:** \`${info.type}\``,
                `**Instance:** \`${info.name}\``,
                `---`,
                `*Declared in:* \`${fileName}\` (${info.sourceFile})`
              ].join('\n\n')
            }
          };
        }
      }
    }
  }

  // Line context hover
  const lineText = document.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 }
  });

  // 2. Hover on @depends_on("...")
  const dependsOnMatch = lineText.match(/@depends_on\s*\(\s*([^)]+)\s*\)/);
  if (dependsOnMatch) {
    const targetMatches = [...dependsOnMatch[1].matchAll(/["']([^"']+)["']/g)];
    for (const tm of targetMatches) {
      const address = tm[1].trim();
      if (!address) continue;

      if (address.startsWith('@')) {
        // Internal dependency within current feature file
        const lines = document.getText().split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (new RegExp(`^\\s*${address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lines[i])) {
            let title = address;
            for (let j = i; j < Math.min(lines.length, i + 5); j++) {
              const tmTitle = lines[j].match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario)\s*:\s*(.*)$/i);
              if (tmTitle) {
                title = tmTitle[1].trim();
                break;
              }
            }
            return {
              contents: {
                kind: MarkupKind.Markdown,
                value: [
                  `### 🔗 Internal Dependency: \`${address}\``,
                  `**Scenario:** ${title}`,
                  `**Type:** Internal reference within this feature file`,
                  `---`,
                  `*Location:* Line ${i + 1}`
                ].join('\n\n')
              }
            };
          }
        }
      } else {
        const targetScenario = scanner.config.scenarioAddresses.get(address) || scanner.config.scenarios.get(address);
        if (targetScenario) {
          const fileName = targetScenario.sourceFile.split(/[/\\]/).pop();
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: [
                `### 🔗 External Dependency: \`${targetScenario.tag}\``,
                `**Scenario:** ${targetScenario.title}`,
                `**Resource Scope:** \`${targetScenario.scope}\``,
                `**Ledger Address:** \`${targetScenario.address}\``,
                `---`,
                `*Defined in:* \`${fileName}\` (line ${targetScenario.line + 1})`
              ].join('\n\n')
            }
          };
        }
      }
    }
  }

  // 3. Hover on Scenario Target under Rule in testrun
  const scenarioHeaderMatch = lineText.match(/^(?:\s*Scenario|\s*Escenario|\s*Scenario Outline|\s*Esquema del escenario):\s*(.*)$/i);
  if (scenarioHeaderMatch) {
    const rawTarget = scenarioHeaderMatch[1].trim();
    let ruleFileName = '';
    const docLines = document.getText().split(/\r?\n/);
    for (let j = position.line - 1; j >= 0; j--) {
      const rm = docLines[j].trim().match(/^(?:Rule|Regla):\s*(.*)$/i);
      if (rm) {
        ruleFileName = rm[1].trim();
        break;
      }
    }

    if (ruleFileName) {
      if (rawTarget === '*') {
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: [
              `### 🌐 Wildcard Target (\`*\`)`,
              `**Scope:** Applies to **all** scenarios in Rule \`${ruleFileName}\`.`,
              `---`,
              `*Rule File:* \`${ruleFileName}\``
            ].join('\n\n')
          }
        };
      }

      const normRule = ruleFileName.replace(/\\/g, '/').toLowerCase();
      const normBase = normRule.split('/').pop() || normRule;
      const cleanTarget = rawTarget.toLowerCase().replace(/^@/, '');

      for (const [addr, info] of scanner.config.scenarioAddresses.entries()) {
        const normAddr = addr.replace(/\\/g, '/').toLowerCase();
        const normSource = info.sourceFile.replace(/\\/g, '/').toLowerCase();
        const matchesRule = normAddr.includes(normBase) || normSource.includes(normBase);
        if (!matchesRule) continue;

        const cleanTag = info.tag.replace(/^@/, '').toLowerCase();
        const cleanTitle = info.title.toLowerCase();

        if (
          cleanTarget === cleanTag ||
          rawTarget.toLowerCase() === info.tag.toLowerCase() ||
          cleanTarget === cleanTitle ||
          rawTarget.toLowerCase() === cleanTitle ||
          normAddr === rawTarget.toLowerCase().replace(/\\/g, '/') ||
          normAddr.endsWith(cleanTarget)
        ) {
          const fileName = info.sourceFile.split(/[/\\]/).pop();
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: [
                `### 🧪 Test Case Target: \`${info.tag}\``,
                `**Title:** ${info.title}`,
                `**Resource Scope:** \`${info.scope}\``,
                `**State Address:** \`${info.address}\``,
                `---`,
                `*Rule File:* \`${ruleFileName}\` -> \`${fileName}\` (line ${info.line + 1})`
              ].join('\n\n')
            }
          };
        }
      }
    } else {
      // Direct scenario target lookup without Rule:
      const targetScenario = scanner.config.scenarioAddresses.get(rawTarget) || scanner.config.scenarios.get(rawTarget);
      if (targetScenario) {
        const fileName = targetScenario.sourceFile.split(/[/\\]/).pop();
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: [
              `### 🧪 Referenced Target: \`${targetScenario.tag}\``,
              `**Title:** ${targetScenario.title}`,
              `**Resource Scope:** \`${targetScenario.scope}\``,
              `**Ledger Address:** \`${targetScenario.address}\``,
              `---`,
              `*File:* \`${fileName}\` (line ${targetScenario.line + 1})`
            ].join('\n\n')
          }
        };
      }
    }
  }

  // 3.01 Hover on mark target = ...
  const markTargetHoverMatch = lineText.match(/^\s*\*\s*mark\s+target\s*=\s*(.+)$/i);
  if (markTargetHoverMatch) {
    const rawTarget = markTargetHoverMatch[1].trim().replace(/^["']|["']$/g, '');
    const targetScenario = scanner.config.scenarioAddresses.get(rawTarget) || scanner.config.scenarios.get(rawTarget);
    if (targetScenario) {
      const fileName = targetScenario.sourceFile.split(/[/\\]/).pop();
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: [
            `### 🎯 Canonical Target: \`${targetScenario.tag}\``,
            `**Title:** ${targetScenario.title}`,
            `**Resource Scope:** \`${targetScenario.scope}\``,
            `**Ledger Address:** \`${targetScenario.address}\``,
            `---`,
            `*File:* \`${fileName}\` (line ${targetScenario.line + 1})`
          ].join('\n\n')
        }
      };
    }
  }

  // 3.1 Hover on Identity Tag: @tc-X, @tr-X, @tp-X, @bg-X
  const idTagMatch = lineText.match(/@(tc|tr|tp|bg)-[0-9]+/i);
  if (idTagMatch) {
    const tag = idTagMatch[0].toLowerCase();

    // Check if within an enclosing Rule: in a testrun file
    let scenario = null;
    let ruleFileName = '';
    const docLines = document.getText().split(/\r?\n/);
    for (let j = position.line - 1; j >= 0; j--) {
      const rm = docLines[j].trim().match(/^(?:Rule|Regla):\s*(.*)$/i);
      if (rm) {
        ruleFileName = rm[1].trim();
        break;
      }
    }

    if (ruleFileName) {
      const normRule = ruleFileName.replace(/\\/g, '/').toLowerCase();
      const normBase = normRule.split('/').pop() || normRule;
      for (const [addr, info] of scanner.config.scenarioAddresses.entries()) {
        const normAddr = addr.replace(/\\/g, '/').toLowerCase();
        const normSource = info.sourceFile.replace(/\\/g, '/').toLowerCase();
        if ((normAddr.includes(normBase) || normSource.includes(normBase)) && normAddr.endsWith(tag)) {
          scenario = info;
          break;
        }
      }
    }

    if (!scenario) {
      scenario = scanner.config.scenarios.get(tag);
    }

    if (scenario) {
      const fileName = scenario.sourceFile.split(/[/\\]/).pop();
      const headerTitle = ruleFileName
        ? `### 🧪 Test Case Target: \`${scenario.tag}\``
        : `### 🏷️ Scenario Identifier: \`${scenario.tag}\``;
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: [
            headerTitle,
            `**Title:** ${scenario.title}`,
            `**Resource Scope:** \`${scenario.scope}\``,
            `**State Address:** \`${scenario.address}\``,
            `---`,
            `*File:* \`${fileName}\` (line ${scenario.line + 1})`
          ].join('\n\n')
        }
      };
    }
  }

  // 4. Hover on DSL Status: * mark status = [status]
  const statusMatch = lineText.match(/mark\s+status\s*=\s*([a-zA-Z]+)/i);
  if (statusMatch) {
    const status = statusMatch[1].toLowerCase();
    const STATUS_INFO: Record<string, { badge: string; desc: string; ledger: string }> = {
      passed: {
        badge: '✅ PASSED',
        desc: 'The scenario executed successfully and all assertions were satisfied.',
        ledger: 'Reconciles the resource in testform.state marking it as passed.'
      },
      failed: {
        badge: '❌ FAILED',
        desc: 'Assertion failure or execution error detected in testcase.',
        ledger: 'Records the failure in the ledger and blocks downstream dependencies.'
      },
      pending: {
        badge: '⏳ PENDING',
        desc: 'Scenario planned but pending execution or under development.',
        ledger: 'Maintains the resource in pending state without breaking development quality gates.'
      },
      skipped: {
        badge: '⏭️ SKIPPED',
        desc: 'Execution deliberately skipped (via tag filters or preconditions).',
        ledger: 'Preserves the entry without altering the consolidated suite outcome.'
      },
      blocked: {
        badge: '🚫 BLOCKED',
        desc: 'Execution blocked due to failure of a declared dependency in @depends_on.',
        ledger: 'Prevents execution of this case until prerequisite is resolved.'
      },
      unexecuted: {
        badge: '⚪ UNEXECUTED',
        desc: 'Initial state prior to testrun reconciliation or execution.',
        ledger: 'Default state in speculative plans without execution.'
      }
    };

    const info = STATUS_INFO[status] || {
      badge: `🏷️ ${status.toUpperCase()}`,
      desc: `Execution status assigned to this scenario.`,
      ledger: `Updates the state ledger in testform.state.`
    };

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### ${info.badge} — Testform State Reconciliation`,
          `**Meaning:** ${info.desc}`,
          `**Effect on Ledger (\`testform.state\`):** ${info.ledger}`,
          `---`,
          `*DSL Syntax:* \`* mark status = ${status}\``
        ].join('\n\n')
      }
    };
  }

  // 4.1 Hover on mark trace = ...
  const traceMatch = lineText.match(/mark\s+trace\s*=\s*(.+)$/i);
  if (traceMatch) {
    const traceVal = traceMatch[1].trim().replace(/^["']|["']$/g, '');
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### 📝 Diagnostic Trace — Canonical Field`,
          `**Detail:** \`${traceVal}\``,
          `---`,
          `*Effect:* Records error trace or diagnostic message into \`execution.trace\` in \`testform.state\`.*`
        ].join('\n\n')
      }
    };
  }

  // 4.2 Hover on mark evidence = ...
  const evidenceMatch = lineText.match(/mark\s+evidence\s*=\s*(.+)$/i);
  if (evidenceMatch) {
    const evidenceVal = evidenceMatch[1].trim().replace(/^["']|["']$/g, '');
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### 📎 Execution Evidence — Canonical Field`,
          `**Reference:** \`${evidenceVal}\``,
          `---`,
          `*Effect:* Attaches screenshot, log file, or external link to scenario execution in \`testform.state\`.*`
        ].join('\n\n')
      }
    };
  }

  // 5. Match tags hover: @module(...)
  const moduleMatch = lineText.match(/@module\s*\(\s*(?:name\s*=\s*)?["']?([^"',\s)]+)["']?/);
  if (moduleMatch) {
    const modName = moduleMatch[1];
    const isInstalled = scanner.installedModules.includes(modName);
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### Testform Module: \`${modName}\``,
          isInstalled
            ? `✅ Installed in \`.testform/modules/${modName}\``
            : `⚠️ Not yet installed in \`.testform/modules/\`. Run \`testform init\` to download.`
        ].join('\n\n')
      }
    };
  }

  // 6. Match Rule path hover: Rule: auth/login.case.feature or Rule: suites/smoke.run.feature
  const ruleMatch = lineText.match(/^(?:\s*Rule|\s*Regla):\s*([a-zA-Z0-9_./-]+\.(?:case|run|plan|bug)\.feature)/i);
  if (ruleMatch) {
    const rawPath = ruleMatch[1].trim();
    const feat = scanner.featureFiles.get(rawPath) ||
      [...scanner.featureFiles.values()].find(f => f.relPath.endsWith(rawPath) || f.fullPath.endsWith(rawPath));
    if (feat) {
      const scopeLabel = feat.scope === 'testrun' ? 'Test Run Suite' : (feat.scope === 'testplan' ? 'Test Plan' : (feat.scope === 'bug' ? 'Defect / Bug Report' : 'Test Case Feature'));
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: [
            `### 🎯 ${scopeLabel}: \`${feat.title}\``,
            `**Scope:** \`${feat.scope}\``,
            `**Target Path:** \`${feat.relPath}\``,
            `---`,
            `*Press \`F12\` or \`Ctrl+Click\` to navigate to this file.*`
          ].join('\n\n')
        }
      };
    }
  }

  // 7. Match DSL Field: * field <name> = <value>
  const fieldMatch = lineText.match(/(?:^|\s+)field\s+([a-zA-Z0-9_.-]+)\s*=\s*(.+)$/i);
  if (fieldMatch) {
    const fieldName = fieldMatch[1].trim();
    const fieldValue = fieldMatch[2].trim().replace(/^["']|["']$/g, '');
    const customDef = scanner.customFields.get(fieldName.toLowerCase());

    const fieldDescriptions: Record<string, string> = {
      priority: 'Execution priority level for suite and triage ordering.',
      severity: 'Impact of the defect if this test case fails.',
      component: 'Component or architectural domain associated with the case.',
      assignee: 'Owner or team assigned to maintain this scenario.'
    };

    const desc = customDef?.source
      ? `Defined in \`${customDef.source}\`${customDef.required ? ' *(Required)*' : ''}`
      : (fieldDescriptions[fieldName.toLowerCase()] || 'Custom structured metadata for the resource in the ledger.');

    const enumInfo = customDef?.enum && customDef.enum.length > 0
      ? `**Allowed values:** ${customDef.enum.map(e => `\`${e}\``).join(', ')}`
      : '';

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### 🏷️ Testform Field: \`${fieldName}\``,
          `**Assigned value:** \`${fieldValue}\``,
          `**Description:** ${desc}`,
          enumInfo,
          `---`,
          `*Effect:* Stored in \`custom_fields.${fieldName}\` in \`testform.state\` upon running \`testform apply\`.*`
        ].filter(Boolean).join('\n\n')
      }
    };
  }

  return null;
}
