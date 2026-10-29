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
                `*Declarado en:* \`${fileName}\` (${info.sourceFile})`
              ].filter(Boolean).join('\n\n')
            }
          };
        } else {
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: `⚠️ **Variable no declarada:** \`${varName}\`\n\nEsta variable está referenciada pero no ha sido declarada en ningún bloque \`variable:\` del workspace.`
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
                `*Declarado en:* \`${fileName}\` (${info.sourceFile})`
              ].join('\n\n')
            }
          };
        } else {
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: `⚠️ **Local no definido:** \`${localName}\`\n\nEste valor local está referenciado pero no ha sido definido en ningún bloque \`locals:\` del workspace.`
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
                `*Declarado en:* \`${fileName}\` (${info.sourceFile})`
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
                  `### 🔗 Dependencia Interna: \`${address}\``,
                  `**Escenario:** ${title}`,
                  `**Tipo:** Referencia interna en este mismo archivo feature`,
                  `---`,
                  `*Ubicación:* Línea ${i + 1}`
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
                `### 🔗 Dependencia Externa: \`${targetScenario.tag}\``,
                `**Escenario:** ${targetScenario.title}`,
                `**Resource Scope:** \`${targetScenario.scope}\``,
                `**Dirección en Ledger:** \`${targetScenario.address}\``,
                `---`,
                `*Definido en:* \`${fileName}\` (línea ${targetScenario.line + 1})`
              ].join('\n\n')
            }
          };
        }
      }
    }
  }

  // 3. Hover on Identity Tag: @tc-X, @tr-X, @tp-X
  const idTagMatch = lineText.match(/@(tc|tr|tp)-[0-9]+/i);
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
        : `### 🏷️ Identificador de Escenario: \`${scenario.tag}\``;
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: [
            headerTitle,
            `**Título:** ${scenario.title}`,
            `**Resource Scope:** \`${scenario.scope}\``,
            `**Dirección de Estado:** \`${scenario.address}\``,
            `---`,
            `*Archivo:* \`${fileName}\` (línea ${scenario.line + 1})`
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
        desc: 'El escenario se ejecutó con éxito y todas las aserciones fueron satisfechas.',
        ledger: 'Reconcilia el recurso en testform.state marcándolo como exitoso.'
      },
      failed: {
        badge: '❌ FAILED',
        desc: 'Fallo de aserción o error de ejecución detectado en el caso de prueba.',
        ledger: 'Registra el error en el ledger y detiene la cadena de dependencias subsiguiente.'
      },
      pending: {
        badge: '⏳ PENDING',
        desc: 'Escenario planificado pero pendiente de ejecución o en desarrollo.',
        ledger: 'Mantiene el recurso en estado pendiente sin romper quality gates de desarrollo.'
      },
      skipped: {
        badge: '⏭️ SKIPPED',
        desc: 'Ejecución omitida deliberadamente (por filtros de tags o condiciones previas).',
        ledger: 'Se preserva el registro sin alterar el resultado consolidado del suite.'
      },
      blocked: {
        badge: '🚫 BLOCKED',
        desc: 'Ejecución bloqueada debido al fallo de una dependencia declarada en @depends_on.',
        ledger: 'Impide la ejecución de este caso hasta que el prerrequisito sea subsanado.'
      },
      unexecuted: {
        badge: '⚪ UNEXECUTED',
        desc: 'Estado inicial previo a la reconciliación o ejecución del testrun.',
        ledger: 'Estado por defecto en planes especulativos sin ejecución.'
      }
    };

    const info = STATUS_INFO[status] || {
      badge: `🏷️ ${status.toUpperCase()}`,
      desc: `Estado de ejecución asignado a este escenario.`,
      ledger: `Actualiza el ledger de estado en testform.state.`
    };

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### ${info.badge} — Reconciliación de Estado Testform`,
          `**Significado:** ${info.desc}`,
          `**Efecto en el Ledger (\`testform.state\`):** ${info.ledger}`,
          `---`,
          `*Sintaxis DSL:* \`* mark status = ${status}\``
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
  const ruleMatch = lineText.match(/^(?:\s*Rule|\s*Regla):\s*([a-zA-Z0-9_./-]+\.(?:case|run|plan)\.feature)/i);
  if (ruleMatch) {
    const rawPath = ruleMatch[1].trim();
    const feat = scanner.featureFiles.get(rawPath) ||
      [...scanner.featureFiles.values()].find(f => f.relPath.endsWith(rawPath) || f.fullPath.endsWith(rawPath));
    if (feat) {
      const scopeLabel = feat.scope === 'testrun' ? 'Test Run Suite' : (feat.scope === 'testplan' ? 'Test Plan' : 'Test Case Feature');
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: [
            `### 🎯 ${scopeLabel}: \`${feat.title}\``,
            `**Scope:** \`${feat.scope}\``,
            `**Target Path:** \`${feat.relPath}\``,
            `---`,
            `*Presiona \`F12\` o \`Ctrl+Click\` para navegar a este archivo.*`
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
      priority: 'Nivel de prioridad de ejecución para la suite y orden de triaje.',
      severity: 'Impacto del defecto si este caso de prueba llega a fallar.',
      component: 'Componente o dominio arquitectónico asociado al caso.',
      assignee: 'Responsable o equipo asignado al mantenimiento de este escenario.'
    };

    const desc = customDef?.source
      ? `Definido en \`${customDef.source}\`${customDef.required ? ' *(Requerido)*' : ''}`
      : (fieldDescriptions[fieldName.toLowerCase()] || 'Metadato estructurado personalizado para el recurso en el ledger.');

    const enumInfo = customDef?.enum && customDef.enum.length > 0
      ? `**Valores permitidos:** ${customDef.enum.map(e => `\`${e}\``).join(', ')}`
      : '';

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### 🏷️ Testform Field: \`${fieldName}\``,
          `**Valor asignado:** \`${fieldValue}\``,
          `**Descripción:** ${desc}`,
          enumInfo,
          `---`,
          `*Efecto:* Se almacena en \`custom_fields.${fieldName}\` dentro de \`testform.state\` al ejecutar \`testform apply\`.*`
        ].filter(Boolean).join('\n\n')
      }
    };
  }

  return null;
}
