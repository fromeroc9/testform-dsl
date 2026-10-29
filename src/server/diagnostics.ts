import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceScanner } from './workspace-scanner';

export function validateTextDocument(
  textDocument: TextDocument,
  scanner: WorkspaceScanner
): Diagnostic[] {
  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  // 1. Check for undeclared variables in ${var.name}
  const varRegex = /\$\{var\.([a-zA-Z0-9_]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = varRegex.exec(text)) !== null) {
    const varName = match[1];
    if (!scanner.config.variables.has(varName)) {
      const startPos = textDocument.positionAt(match.index);
      const endPos = textDocument.positionAt(match.index + match[0].length);

      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: { start: startPos, end: endPos },
        message: `Variable no declarada: 'var.${varName}'. Declárala en variable.yml o un manifiesto YAML del workspace.`,
        source: 'Testform'
      });
    }
  }

  // 2. Check for undeclared locals in ${local.name}
  const localRegex = /\$\{local\.([a-zA-Z0-9_]+)\}/g;
  while ((match = localRegex.exec(text)) !== null) {
    const localName = match[1];
    if (!scanner.config.locals.has(localName)) {
      const startPos = textDocument.positionAt(match.index);
      const endPos = textDocument.positionAt(match.index + match[0].length);

      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: { start: startPos, end: endPos },
        message: `Local no definido: 'local.${localName}'. Defínelo en un bloque 'locals:' en el workspace.`,
        source: 'Testform'
      });
    }
  }

  // 3. Check @depends_on("...")
  const dependsOnRegex = /@depends_on\s*\(\s*([^)]*)\s*\)/g;
  while ((match = dependsOnRegex.exec(text)) !== null) {
    const argsContent = match[1].trim();
    const matchOffset = match.index;

    // Check for empty dependency: @depends_on("") or @depends_on()
    if (!argsContent || argsContent === '""' || argsContent === "''") {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: textDocument.positionAt(matchOffset),
          end: textDocument.positionAt(matchOffset + match[0].length)
        },
        message: `Error en directiva: @depends_on no puede tener un destino vacío. Especifica una referencia como '@tc-1' o 'modulo/login.case.feature.@tc-1'.`,
        source: 'Testform'
      });
      continue;
    }

    const targetMatches = [...argsContent.matchAll(/["']([^"']*)["']/g)];
    for (const tm of targetMatches) {
      const targetAddress = tm[1].trim();

      if (!targetAddress) {
        const startOffset = matchOffset + (tm.index || 0);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: textDocument.positionAt(startOffset),
            end: textDocument.positionAt(startOffset + tm[0].length)
          },
          message: `Error en directiva: la referencia de dependencia no puede estar vacía.`,
          source: 'Testform'
        });
        continue;
      }

      // 3.1 Internal reference (starts with @, e.g. @tc-1) -> must exist in the same feature file
      if (targetAddress.startsWith('@')) {
        const tagRegex = new RegExp(`^\\s*${targetAddress.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm');
        if (!tagRegex.test(text)) {
          const startOffset = matchOffset + (tm.index || 0);
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: textDocument.positionAt(startOffset),
              end: textDocument.positionAt(startOffset + tm[0].length)
            },
            message: `Referencia interna no encontrada: el tag '${targetAddress}' no existe en este archivo feature.`,
            source: 'Testform'
          });
        }
      } else {
        // 3.2 External reference (contains path or .feature) -> check in workspace addresses
        const targetExists = scanner.config.scenarioAddresses.has(targetAddress);
        if (!targetExists) {
          const startOffset = matchOffset + (tm.index || 0);
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: textDocument.positionAt(startOffset),
              end: textDocument.positionAt(startOffset + tm[0].length)
            },
            message: `Referencia de dependencia no encontrada: '${targetAddress}' no existe en el workspace.`,
            source: 'Testform'
          });
        }
      }
    }
  }

  // 4. Check for duplicate identity tags WITHIN THIS SAME FEATURE FILE
  const lines = text.split(/\r?\n/);
  const seenTagsInFile = new Map<string, number>(); // tag -> first line 0-based

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip comments and @depends_on references so dependencies aren't treated as declared scenario IDs
    const lineWithoutDepends = line.replace(/#.*$/, '').replace(/@depends_on\s*\([^)]*\)/gi, '');
    const idMatches = [...lineWithoutDepends.matchAll(/@(tc|tr|tp)-([0-9]+)/gi)];
    for (const idMatch of idMatches) {
      const tag = idMatch[0].toLowerCase();
      if (seenTagsInFile.has(tag)) {
        const firstLine = seenTagsInFile.get(tag)!;
        const tagCol = line.indexOf(idMatch[0]);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: i, character: tagCol },
            end: { line: i, character: tagCol + idMatch[0].length }
          },
          message: `ID de escenario duplicado en este archivo: '${idMatch[0]}' ya fue declarado en la línea ${firstLine + 1}.`,
          source: 'Testform'
        });
      } else {
        seenTagsInFile.set(tag, i);
      }
    }
  }

  // 5. Validate Resource tags vs configured patterns in main.yml
  const uri = textDocument.uri.toLowerCase();
  const tcPattern = scanner.config.scopes.testcase || '*.case.feature';
  const trPattern = scanner.config.scopes.testrun || '*.run.feature';
  const tpPattern = scanner.config.scopes.testplan || '*.plan.feature';

  const matchesPattern = (pathStr: string, pattern: string) => {
    const cleanPattern = pattern.replace(/\*/g, '.*');
    return new RegExp(`${cleanPattern}$`, 'i').test(pathStr);
  };

  if (matchesPattern(uri, tcPattern)) {
    if (!text.includes('@testcase')) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: `Aviso de Resource: El archivo coincide con '${tcPattern}' pero no incluye la etiqueta de recurso '@testcase'.`,
        source: 'Testform'
      });
    }
  } else if (matchesPattern(uri, trPattern)) {
    if (!text.includes('@testrun')) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: `Aviso de Resource: El archivo coincide con '${trPattern}' pero no incluye la etiqueta de recurso '@testrun'.`,
        source: 'Testform'
      });
    }
  } else if (matchesPattern(uri, tpPattern)) {
    if (!text.includes('@testplan')) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: `Aviso de Resource: El archivo coincide con '${tpPattern}' pero no incluye la etiqueta de recurso '@testplan'.`,
        source: 'Testform'
      });
    }
  }

  // 6. Validate DSL Field & Tag Requirements across all resource types (.case., .run., .plan.)
  let resourceType: 'testcase' | 'testrun' | 'testplan' | 'other' = 'other';
  if (matchesPattern(uri, tcPattern) || text.includes('@testcase')) {
    resourceType = 'testcase';
  } else if (matchesPattern(uri, trPattern) || text.includes('@testrun')) {
    resourceType = 'testrun';
  } else if (matchesPattern(uri, tpPattern) || text.includes('@testplan')) {
    resourceType = 'testplan';
  }

  // Filter required fields that apply to this resource type
  const requiredFields = [...scanner.customFields.values()].filter(f => {
    if (!f.required) return false;
    if (!f.scopes || f.scopes.length === 0 || f.scopes.includes('global')) return true;
    if (resourceType !== 'other' && f.scopes.includes(resourceType)) return true;
    return false;
  });

  const featureTags = new Set<string>();
  const backgroundFields = new Map<string, string>();
  let featureLineIndex = -1;

  // Extract feature-level tags (all tags before the Feature: / Característica: header)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#')) continue;
    if (/^(?:Feature|Característica):/i.test(trimmed)) {
      featureLineIndex = i;
      break;
    }
    const tags = trimmed.match(/@[a-zA-Z0-9_.-]+/g);
    if (tags) {
      for (const t of tags) featureTags.add(t.toLowerCase());
    }
  }

  const isScenarioHeader = (str: string) =>
    /^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):/i.test(str);

  let hasScenarios = false;
  let currentScenarioLine = -1;
  let currentScenarioFields = new Map<string, string>();
  let currentScenarioTags = new Set<string>();
  let pendingTagsForScenario = new Set<string>();

  const checkRequiredFieldsForTarget = (targetLine: number, fields: Map<string, string>, tags: Set<string>) => {
    for (const rf of requiredFields) {
      const lowerName = rf.name.toLowerCase();

      if (rf.source === 'tag') {
        const hasTagDirect = tags.has(`@${lowerName}`);
        const hasEnumMatch = rf.enum && rf.enum.some(e => {
          const cleanE = e.toLowerCase().startsWith('@') ? e.toLowerCase() : `@${e.toLowerCase()}`;
          return tags.has(cleanE);
        });
        const hasStepFallback = fields.has(lowerName);

        if (!hasTagDirect && !hasEnumMatch && !hasStepFallback) {
          const sample = rf.enum && rf.enum.length > 0 ? rf.enum.join(' | ') : `@${rf.name}`;
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: targetLine, character: 0 },
              end: { line: targetLine, character: lines[targetLine]?.length || 10 }
            },
            message: `Campo requerido ausente: tag de '${rf.name}' (${sample}) es obligatorio según la configuración del workspace.`,
            source: 'Testform'
          });
        }
      } else {
        // Step-based field check (* field <name> = ...)
        if (!fields.has(lowerName)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: targetLine, character: 0 },
              end: { line: targetLine, character: lines[targetLine]?.length || 10 }
            },
            message: `Missing required field: '* field ${rf.name} = ...' is required by workspace configuration.`,
            source: 'Testform'
          });
        }
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('#')) continue;

    // Detect tags immediately preceding a Scenario
    const tagMatches = trimmed.match(/@[a-zA-Z0-9_.-]+/g);
    if (tagMatches && !isScenarioHeader(trimmed) && !/^(?:Feature|Característica|Background|Antecedentes|Rule|Regla):/i.test(trimmed)) {
      for (const t of tagMatches) pendingTagsForScenario.add(t.toLowerCase());
    }

    if (/^(?:Background|Antecedentes):/i.test(trimmed)) {
      pendingTagsForScenario.clear();
      continue;
    }

    if (isScenarioHeader(trimmed)) {
      hasScenarios = true;
      if (currentScenarioLine >= 0) {
        checkRequiredFieldsForTarget(currentScenarioLine, currentScenarioFields, currentScenarioTags);
      }
      currentScenarioLine = i;
      // Inherit all fields declared in Background / file-level!
      currentScenarioFields = new Map(backgroundFields);
      // Inherit Feature tags + local scenario tags
      currentScenarioTags = new Set([...featureTags, ...pendingTagsForScenario]);
      pendingTagsForScenario.clear();
      continue;
    }

    if (/^(?:Rule|Regla):/i.test(trimmed)) {
      pendingTagsForScenario.clear();
    }

    const fieldMatch = trimmed.match(/(?:^|\s+)field\s+([a-zA-Z0-9_.-]+)\s*=\s*(.+)$/i);
    if (fieldMatch) {
      const fieldName = fieldMatch[1].trim();
      const rawVal = fieldMatch[2].trim().replace(/^["']|["']$/g, '');
      const lowerField = fieldName.toLowerCase();

      if (currentScenarioLine >= 0) {
        currentScenarioFields.set(lowerField, rawVal);
      } else {
        // Defined in Background: or file header -> Global inheritance for all scenarios
        backgroundFields.set(lowerField, rawVal);
      }

      // Check allowed enum values if configured
      const customDef = scanner.customFields.get(lowerField);
      let allowedEnums: string[] | undefined = customDef?.enum;

      if (!allowedEnums) {
        if (lowerField === 'priority') {
          allowedEnums = ['Critical', 'High', 'Medium', 'Low', '@critical', '@high', '@medium', '@low'];
        } else if (lowerField === 'severity') {
          allowedEnums = ['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'];
        }
      }

      if (allowedEnums && allowedEnums.length > 0) {
        const isAllowed = allowedEnums.some(e => {
          const cleanE = e.toLowerCase().replace(/^@/, '');
          const cleanVal = rawVal.toLowerCase().replace(/^@/, '');
          return e.toLowerCase() === rawVal.toLowerCase() || cleanE === cleanVal;
        });
        if (!isAllowed) {
          const valStartChar = rawLine.lastIndexOf(fieldMatch[2].trim());
          const startChar = valStartChar >= 0 ? valStartChar : rawLine.indexOf('=') + 1;
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: i, character: startChar },
              end: { line: i, character: rawLine.length }
            },
            message: `Invalid value '${rawVal}' for field '${fieldName}'. Allowed values are: ${allowedEnums.map(e => `'${e}'`).join(', ')}.`,
            source: 'Testform'
          });
        }
      }
    }
  }

  // Check the last scenario in the file
  if (currentScenarioLine >= 0) {
    checkRequiredFieldsForTarget(currentScenarioLine, currentScenarioFields, currentScenarioTags);
  } else if (!hasScenarios && (resourceType === 'testplan' || resourceType === 'testrun' || resourceType === 'testcase')) {
    // If resource file has no explicit Scenario headers (e.g. Testplans with Rules), validate at file/feature level
    const targetLine = featureLineIndex >= 0 ? featureLineIndex : 0;
    checkRequiredFieldsForTarget(targetLine, backgroundFields, featureTags);
  }

  return diagnostics;
}
