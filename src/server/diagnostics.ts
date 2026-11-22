import * as path from 'path';
import { Diagnostic, DiagnosticSeverity, DiagnosticTag } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceScanner } from './workspace-scanner';
import {
  buildIdentityRegexForPattern,
  findAllIdentityMatchesInLine,
  parseIdentityPattern
} from '../shared/identity';

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
        message: `Undeclared variable: 'var.${varName}'. Declare it in variable.yml or a workspace YAML manifest.`,
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
        message: `Undefined local value: 'local.${localName}'. Define it in a 'locals:' block in the workspace.`,
        source: 'Testform'
      });
    }
  }

  // 3. Check @depends_on(...)
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
        message: `Directive error: @depends_on cannot have an empty target. Specify a reference like '@tc-1' or 'module/login.case.feature.@tc-1'.`,
        source: 'Testform'
      });
      continue;
    }

    // Match quoted strings OR unquoted tokens separated by commas
    const tokenRegex = /(?:["']([^"']*)["']|([^\s,()[\]"']+))/g;
    const targetMatches = [...argsContent.matchAll(tokenRegex)];
    for (const tm of targetMatches) {
      const targetAddress = (tm[1] ?? tm[2] ?? '').trim();

      if (!targetAddress) {
        const startOffset = matchOffset + (tm.index || 0);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: textDocument.positionAt(startOffset),
            end: textDocument.positionAt(startOffset + tm[0].length)
          },
          message: `Directive error: dependency reference cannot be empty.`,
          source: 'Testform'
        });
        continue;
      }

      const startOffset = matchOffset + (tm.index || 0);
      const matchLength = tm[0].length;

      // 3.1 Internal reference (starts with @, e.g. @tc-1)
      if (targetAddress.startsWith('@')) {
        let tagFound = false;
        // Check in current text
        const tagRegex = new RegExp(`^\\s*${targetAddress.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm');
        if (tagRegex.test(text)) {
          tagFound = true;
        } else {
          // Check if enclosing rule points to a feature file containing this tag
          const linesBeforeMatch = text.substring(0, startOffset).split(/\r?\n/);
          let ruleTarget = '';
          for (let li = linesBeforeMatch.length - 1; li >= 0; li--) {
            const rm = linesBeforeMatch[li].trim().match(/^(?:Rule|Regla):\s*(.+)$/i);
            if (rm) {
              ruleTarget = rm[1].trim();
              break;
            }
          }
          if (ruleTarget) {
            const normRule = ruleTarget.replace(/\\/g, '/').toLowerCase();
            const normBase = normRule.split('/').pop() || normRule;
            for (const [addr, info] of scanner.config.scenarioAddresses.entries()) {
              const normSource = info.sourceFile.replace(/\\/g, '/').toLowerCase();
              if ((normSource.endsWith(normRule) || normSource.endsWith(normBase)) && info.tag === targetAddress) {
                tagFound = true;
                break;
              }
            }
          }
          // Also check across workspace scenarios
          if (!tagFound) {
            for (const [_, info] of scanner.config.scenarioAddresses.entries()) {
              if (info.tag === targetAddress) {
                tagFound = true;
                break;
              }
            }
          }
        }

        if (!tagFound) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: textDocument.positionAt(startOffset),
              end: textDocument.positionAt(startOffset + matchLength)
            },
            message: `Target reference not found: tag '${targetAddress}' does not exist in this scope or workspace.`,
            source: 'Testform'
          });
        }
      } else {
        // 3.2 External reference (contains path or .feature) -> check in workspace addresses
        const targetExists = scanner.config.scenarioAddresses.has(targetAddress);
        if (!targetExists) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: textDocument.positionAt(startOffset),
              end: textDocument.positionAt(startOffset + matchLength)
            },
            message: `Dependency reference not found: '${targetAddress}' does not exist in the workspace.`,
            source: 'Testform'
          });
        }
      }
    }
  }

  // 4. Precompute Resource Scope and Patterns
  const uri = textDocument.uri.toLowerCase();
  const tcPattern = scanner.config.scopes.testcase || '*.case.feature';
  const trPattern = scanner.config.scopes.testrun || '*.run.feature';
  const tpPattern = scanner.config.scopes.testplan || '*.plan.feature';
  const bgPattern = scanner.config.scopes.bug || '*.bug.feature';

  const matchesPattern = (pathStr: string, pattern: string) => {
    const cleanPattern = pattern.replace(/\*/g, '.*');
    return new RegExp(`${cleanPattern}$`, 'i').test(pathStr);
  };

  let fileResourceScope: 'testcase' | 'testrun' | 'testplan' | 'bug' | null = null;
  if (matchesPattern(uri, bgPattern) || /@bug\b/i.test(text)) {
    fileResourceScope = 'bug';
  } else if (matchesPattern(uri, trPattern) || /@(?:testrun|testcycle)\b/i.test(text)) {
    fileResourceScope = 'testrun';
  } else if (matchesPattern(uri, tpPattern) || /@testplan\b/i.test(text)) {
    fileResourceScope = 'testplan';
  } else if (matchesPattern(uri, tcPattern) || /@testcase\b/i.test(text)) {
    fileResourceScope = 'testcase';
  }

  // 5. Check for duplicate identity tags (scoped per Rule or file)
  const lines = text.split(/\r?\n/);
  const seenTagsInScope = new Map<string, number>(); // tag -> first line 0-based
  let currentRuleName: string | null = null;
  let inFeatureHeader = true;
  let inBackground = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Feature header boundary
    if (/^(?:Feature|Característica):/i.test(trimmed)) {
      inFeatureHeader = false;
      continue;
    }

    // Background boundary
    if (/^(?:Background|Antecedentes):/i.test(trimmed)) {
      inBackground = true;
      continue;
    }

    // In files with Rules (like testruns), each Rule scopes its own testcases independently
    const ruleMatch = trimmed.match(/^(?:Rule|Regla):\s*(.*)$/i);
    if (ruleMatch) {
      currentRuleName = ruleMatch[1].trim();
      seenTagsInScope.clear(); // Clear scope for the new Rule!
      inBackground = false;
      continue;
    }

    const isScenarioHeader = /^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):/i.test(trimmed);
    if (isScenarioHeader) {
      inBackground = false;
    }

    // Step lines, table rows, docstrings are steps/content, never scenario identity declarations
    const isStep = /^(?:\*|Given|When|Then|And|But|Dado|Cuando|Entonces|Y|Pero)\b/i.test(trimmed)
      || trimmed.startsWith('|')
      || trimmed.startsWith('"""')
      || trimmed.startsWith("'''");

    // Strip comments and @depends_on references so dependencies aren't treated as declared scenario IDs
    const lineWithoutDepends = line.replace(/#.*$/, '').replace(/@depends_on\s*\([^)]*\)/gi, '');

    // Check for stray / loose '@' tokens (orphan tag prefix with no tag name, e.g. "@testcase @" or standalone "@")
    const strayAtRegex = /(?:^|\s)(@)(?=\s|$|[^\w-])/g;
    let strayMatch: RegExpExecArray | null;
    while ((strayMatch = strayAtRegex.exec(lineWithoutDepends)) !== null) {
      const atCol = strayMatch.index + strayMatch[0].indexOf('@');
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: i, character: atCol },
          end: { line: i, character: atCol + 1 }
        },
        message: "Incomplete or orphan tag: '@' has no tag identifier.",
        source: 'Testform'
      });
    }

    // Step lines, background lines, feature headers are never scenario declarations.
    // Specifically, in @bug files, multiple bug scenarios can target the exact same testcase (* set target = ...@tc-02).
    if (inFeatureHeader || inBackground || isStep) {
      continue;
    }

    // A scenario declaration must be on a tag line (starting with '@') or on the Scenario header itself
    const isTagLine = trimmed.startsWith('@');
    if (!isTagLine && !isScenarioHeader) {
      continue;
    }

    const idMatches = findAllIdentityMatchesInLine(lineWithoutDepends, scanner.config.identities);
    for (const idMatch of idMatches) {
      // In @bug files, only @bg-* tags are declared scenario IDs for the bug file.
      // In @testcase files, only @tc-* tags are declared scenario IDs, etc.
      if (fileResourceScope && fileResourceScope !== 'testrun' && idMatch.scope !== fileResourceScope) {
        continue;
      }

      let tag = idMatch.normalizedTag;
      if (fileResourceScope === 'testrun' && !currentRuleName && isScenarioHeader) {
        const fullScenarioTarget = trimmed.replace(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*/i, '').trim();
        if (fullScenarioTarget.includes('.feature') || fullScenarioTarget.includes('/')) {
          tag = fullScenarioTarget.toLowerCase().replace(/\\/g, '/');
        }
      }
      if (seenTagsInScope.has(tag)) {
        const firstLine = seenTagsInScope.get(tag)!;
        const tagCol = idMatch.index;
        const scopeDesc = currentRuleName ? `in Rule '${currentRuleName}'` : `in this file`;
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: i, character: tagCol },
            end: { line: i, character: tagCol + idMatch.length }
          },
          message: `Duplicate scenario ID ${scopeDesc}: '${idMatch.rawTag}' was already declared on line ${firstLine + 1}.`,
          source: 'Testform'
        });
      } else {
        seenTagsInScope.set(tag, i);
      }
    }
  }

  // 6. Validate Resource tags vs configured patterns in main.yml
  const hasSpecialRootTag =
    /@testcase\b/i.test(text) ||
    /@(?:testrun|testcycle)\b/i.test(text) ||
    /@testplan\b/i.test(text) ||
    /@bug\b/i.test(text);

  if (!hasSpecialRootTag) {
    if (matchesPattern(uri, tcPattern)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: `Resource Notice: File matches '${tcPattern}'. Add '@testcase' to prioritize root scope.`,
        source: 'Testform'
      });
    } else if (matchesPattern(uri, trPattern)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: `Resource Notice: File matches '${trPattern}'. Add '@testrun' to prioritize root scope.`,
        source: 'Testform'
      });
    } else if (matchesPattern(uri, tpPattern)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: `Resource Notice: File matches '${tpPattern}'. Add '@testplan' to prioritize root scope.`,
        source: 'Testform'
      });
    } else if (matchesPattern(uri, bgPattern)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: `Resource Notice: File matches '${bgPattern}'. Add '@bug' to prioritize root scope.`,
        source: 'Testform'
      });
    }
  }

  // 6. Validate DSL Field & Tag Requirements across all resource types (.case., .run., .plan., .bug.)
  let resourceType: 'testcase' | 'testrun' | 'testplan' | 'bug' | 'other' = 'other';
  if (matchesPattern(uri, tcPattern) || text.includes('@testcase')) {
    resourceType = 'testcase';
  } else if (matchesPattern(uri, trPattern) || /@(?:testrun|testcycle)\b/i.test(text)) {
    resourceType = 'testrun';
  } else if (matchesPattern(uri, tpPattern) || text.includes('@testplan')) {
    resourceType = 'testplan';
  } else if (matchesPattern(uri, bgPattern) || text.includes('@bug')) {
    resourceType = 'bug';
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
  let backgroundLineIndex = -1;

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
        if (!hasTagDirect && !hasEnumMatch) {
          const sample = rf.enum && rf.enum.length > 0 ? rf.enum.join(' | ') : `@${rf.name}`;
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: targetLine, character: 0 },
              end: { line: targetLine, character: lines[targetLine]?.length || 10 }
            },
            message: `Missing required field: tag for '${rf.name}' (${sample}) is required by workspace configuration.`,
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

  let currentScenarioHasTarget = false;
  let currentScenarioHasTrace = false;

  const checkBugIntegrity = (line: number, hasTarget: boolean, hasTrace: boolean, tags: Set<string>) => {
    if (resourceType !== 'bug') return;
    const tcTagRegex = buildIdentityRegexForPattern(scanner.config.identities.testcase, { flags: 'i', numericOnly: false });
    const trTagRegex = buildIdentityRegexForPattern(scanner.config.identities.testrun, { flags: 'i', numericOnly: false });
    const hasTargetTag = Array.from(tags).some(t => tcTagRegex.test(t) || trTagRegex.test(t));
    if (!hasTarget && !hasTrace && !hasTargetTag) {
      const tcSample = `@${parseIdentityPattern(scanner.config.identities.testcase).cleanPattern}`;
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: {
          start: { line, character: 0 },
          end: { line, character: lines[line]?.length || 10 }
        },
        message: `Integrity Warning (bug-target-integrity): Bug scenario lacks origin traceability. Add a step '* set target = <testcase.identity>' or a tag '${tcSample}'.`,
        source: 'Testform'
      });
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
      backgroundLineIndex = i;
      pendingTagsForScenario.clear();
      continue;
    }

    if (isScenarioHeader(trimmed)) {
      hasScenarios = true;
      if (currentScenarioLine >= 0) {
        if (resourceType === 'testcase' || resourceType === 'bug') {
          checkRequiredFieldsForTarget(currentScenarioLine, currentScenarioFields, currentScenarioTags);
        }
        checkBugIntegrity(currentScenarioLine, currentScenarioHasTarget, currentScenarioHasTrace, currentScenarioTags);
      }
      currentScenarioLine = i;
      currentScenarioHasTarget = false;
      currentScenarioHasTrace = false;
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

    if (currentScenarioLine >= 0) {
      if (/\btarget\s*=/i.test(trimmed)) currentScenarioHasTarget = true;
      if (/\btrace\s*=/i.test(trimmed)) currentScenarioHasTrace = true;
    }

    // Attachment validation by resource scope
    const attachMatch = trimmed.match(/(?:^|\s+)\*?\s*set\s+attach\s*=\s*(.+)$/i);
    if (attachMatch) {
      if (currentScenarioLine < 0 && backgroundLineIndex >= 0) {
        if (resourceType === 'bug') {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: i, character: rawLine.indexOf(trimmed) >= 0 ? rawLine.indexOf(trimmed) : 0 },
              end: { line: i, character: rawLine.length }
            },
            message: `Attachments are prohibited in Background for bug specifications. Defect attachments must be declared at Scenario level.`,
            source: 'Testform'
          });
        }
      } else if (currentScenarioLine >= 0) {
        if (resourceType === 'testplan') {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: i, character: rawLine.indexOf(trimmed) >= 0 ? rawLine.indexOf(trimmed) : 0 },
              end: { line: i, character: rawLine.length }
            },
            message: `Test plan attachments must be declared in Background (plan level).`,
            source: 'Testform'
          });
        }
      }
    }

    // Deprecation check for '* mark'
    const markMatch = trimmed.match(/(?:^|\s+)\*?\s*mark\s+([a-zA-Z0-9_.-]+)\s*=\s*(.+)$/i);
    if (markMatch) {
      const markKey = markMatch[1].trim();
      const markVal = markMatch[2].trim();
      const markIdx = rawLine.toLowerCase().indexOf('mark');
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        tags: [DiagnosticTag.Deprecated],
        range: {
          start: { line: i, character: markIdx >= 0 ? markIdx : 0 },
          end: { line: i, character: markIdx >= 0 ? markIdx + 4 : rawLine.length }
        },
        message: `'mark' is deprecated in favor of 'set'. Use '* set ${markKey} = ${markVal}' instead.`,
        source: 'Testform'
      });
    }

    // Validate execution mark names for '* set <mark>'
    const setMatch = trimmed.match(/(?:^|\s+)\*?\s*set\s+([a-zA-Z0-9_.-]+)\s*=\s*(.+)$/i);
    if (setMatch) {
      const setKey = setMatch[1].trim();
      const setVal = setMatch[2].trim();
      const lowerSetKey = setKey.toLowerCase();
      let allowedMarks: string[] = [];
      let scopeNotice = '';

      const isScenario = currentScenarioLine >= 0;
      const isBackground = currentScenarioLine < 0 && backgroundLineIndex >= 0;

      if (lowerSetKey === 'evidence') {
        scopeNotice = `'evidence' is deprecated and has been removed in favor of 'attach'. Use '* set attach = ...' instead.`;
      } else if (resourceType === 'testcase') {
        allowedMarks = [];
        scopeNotice = `'set' cannot be used in testcase specifications. Use standard Gherkin steps or '* field ...' for metadata.`;
      } else if (resourceType === 'testrun') {
        if (isBackground) {
          allowedMarks = ['duration', 'attach', 'trace'];
          if (lowerSetKey === 'status') {
            scopeNotice = `Suite status in testruns is autocalculated from scenarios. Do not set status manually in Background.`;
          }
        } else {
          allowedMarks = ['status'];
          if (['duration', 'trace', 'attach'].includes(lowerSetKey)) {
            scopeNotice = `'set ${setKey}' in testruns belongs at suite level (in Background:). Testrun scenarios only declare '* set status = <veredicto>'.`;
          }
        }
      } else if (resourceType === 'bug') {
        if (isBackground) {
          allowedMarks = ['run'];
          if (lowerSetKey === 'attach') {
            scopeNotice = `Attachments are prohibited in Background for bug specifications. Defect attachments must be declared at Scenario level.`;
          }
        } else {
          allowedMarks = ['status', 'trace', 'attach', 'target'];
          if (lowerSetKey === 'duration') {
            scopeNotice = `'set duration' is only valid in testrun execution specifications.`;
          }
        }
      } else if (resourceType === 'testplan') {
        if (isBackground) {
          allowedMarks = ['attach'];
        } else {
          allowedMarks = [];
        }
        if (['status', 'target', 'duration', 'trace'].includes(lowerSetKey)) {
          scopeNotice = `'set ${setKey}' is not valid in testplan specifications.`;
        }
      } else {
        allowedMarks = ['target', 'status', 'trace', 'attach', 'duration', 'run'];
      }

      if (!allowedMarks.includes(lowerSetKey)) {
        const startChar = rawLine.indexOf(setKey);
        const msg = scopeNotice || `Invalid DSL mark 'set ${setKey}'. 'set' is reserved for execution marks (${allowedMarks.join(', ') || 'none'}). Did you mean '* field ${setKey} = ...'?`;
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: i, character: startChar >= 0 ? startChar : 0 },
            end: { line: i, character: startChar >= 0 ? startChar + setKey.length : rawLine.length }
          },
          message: msg,
          source: 'Testform'
        });
      } else if (lowerSetKey === 'status') {
        const cleanVal = setVal.toLowerCase().replace(/^["']|["']$/g, '');
        if (resourceType === 'testrun') {
          const validRunStatuses = ['passed', 'failed', 'pending', 'skipped', 'blocked'];
          if (!validRunStatuses.includes(cleanVal)) {
            const startChar = rawLine.indexOf(setVal);
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range: {
                start: { line: i, character: startChar >= 0 ? startChar : 0 },
                end: { line: i, character: startChar >= 0 ? startChar + setVal.length : rawLine.length }
              },
              message: `Unknown status '${setVal}' for testrun. Expected one of: ${validRunStatuses.join(', ')}.`,
              source: 'Testform'
            });
          }
        } else if (resourceType === 'bug') {
          const validBugStatuses = ['open', 'in_progress', 'resolved', 'reopened', 'discarded', 'duplicate', 'failed', 'passed', 'pending'];
          if (!validBugStatuses.includes(cleanVal)) {
            const startChar = rawLine.indexOf(setVal);
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range: {
                start: { line: i, character: startChar >= 0 ? startChar : 0 },
                end: { line: i, character: startChar >= 0 ? startChar + setVal.length : rawLine.length }
              },
              message: `Unknown status '${setVal}' for bug. Expected one of: open, in_progress, resolved, reopened, discarded, duplicate.`,
              source: 'Testform'
            });
          }
        }
      }
    }

    const fieldMatch = trimmed.match(/(?:^|\s+)field\s+([a-zA-Z0-9_.-]+)\s*=\s*(.+)$/i);
    if (fieldMatch) {
      const fieldName = fieldMatch[1].trim();
      const rawVal = fieldMatch[2].trim().replace(/^["']|["']$/g, '');
      const lowerField = fieldName.toLowerCase();

      // Check whether field is declared as tag vs step
      const customDef = scanner.customFields.get(lowerField);
      if (customDef && customDef.source === 'tag') {
        const startChar = rawLine.indexOf(fieldName);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: i, character: startChar >= 0 ? startChar : 0 },
            end: { line: i, character: startChar >= 0 ? startChar + fieldName.length : rawLine.length }
          },
          message: `Field '${fieldName}' is declared with source: "tag" in main.yml. It cannot be defined as a step ('* field ${fieldName}'). Use a tag (e.g. '@${customDef.enum?.[0]?.replace(/^@/, '') || fieldName}') instead.`,
          source: 'Testform'
        });
      } else if (!customDef && scanner.customFields.size > 0) {
        const startChar = rawLine.indexOf(fieldName);
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: { line: i, character: startChar >= 0 ? startChar : 0 },
            end: { line: i, character: startChar >= 0 ? startChar + fieldName.length : rawLine.length }
          },
          message: `Field '${fieldName}' is not declared in workspace configuration (main.yml). Add a 'fields' entry under resource in main.yml.`,
          source: 'Testform'
        });
      }

      if (currentScenarioLine >= 0) {
        currentScenarioFields.set(lowerField, rawVal);
      } else {
        // Defined in Background: or file header -> Global inheritance for all scenarios
        backgroundFields.set(lowerField, rawVal);
      }

      // Check allowed enum values if configured
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
    if (resourceType === 'testcase' || resourceType === 'bug') {
      checkRequiredFieldsForTarget(currentScenarioLine, currentScenarioFields, currentScenarioTags);
    }
    checkBugIntegrity(currentScenarioLine, currentScenarioHasTarget, currentScenarioHasTrace, currentScenarioTags);
  }

  // In testrun, testplan, or testcases with no scenarios, validate required fields at Background / Feature level
  if (resourceType === 'testrun' || resourceType === 'testplan' || (!hasScenarios && resourceType === 'testcase')) {
    const targetLine = backgroundLineIndex >= 0 ? backgroundLineIndex : (featureLineIndex >= 0 ? featureLineIndex : 0);
    checkRequiredFieldsForTarget(targetLine, backgroundFields, featureTags);
  } else if (!hasScenarios && resourceType === 'bug') {
    const targetLine = featureLineIndex >= 0 ? featureLineIndex : 0;
    checkBugIntegrity(targetLine, currentScenarioHasTarget, currentScenarioHasTrace, featureTags);
  }

  
  // 7. Check for homonymous basename collision without @ns (or duplicate @ns on shared basename)
  const currentFeat = scanner.findFeatureByUri(textDocument.uri);

  if (currentFeat) {
    const currentBase = path.basename(currentFeat.relPath).toLowerCase();
    const targetLine = featureLineIndex >= 0 ? featureLineIndex : 0;

    if (!currentFeat.namespace) {
      const colliding = Array.from(scanner.featureFiles.values()).filter(other =>
        other.scope === currentFeat.scope &&
        path.resolve(other.fullPath) !== path.resolve(currentFeat.fullPath) &&
        path.basename(other.relPath).toLowerCase() === currentBase &&
        !other.namespace
      );

      if (colliding.length > 0) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          code: 'testform-collision-namespace',
          range: {
            start: { line: targetLine, character: 0 },
            end: { line: targetLine, character: lines[targetLine]?.length || 10 }
          },
          message: `Collision Warning: Basename '${path.basename(currentFeat.relPath)}' is shared with '${colliding[0].relPath}' without @ns. Add '@ns(...)' to disambiguate its logical address.`,
          source: 'Testform'
        });
      }
    } else {
      const duplicateNs = Array.from(scanner.featureFiles.values()).filter(other =>
        other.scope === currentFeat.scope &&
        path.resolve(other.fullPath) !== path.resolve(currentFeat.fullPath) &&
        path.basename(other.relPath).toLowerCase() === currentBase &&
        other.namespace?.toLowerCase() === currentFeat.namespace!.toLowerCase()
      );

      if (duplicateNs.length > 0) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          code: 'testform-collision-namespace',
          range: {
            start: { line: targetLine, character: 0 },
            end: { line: targetLine, character: lines[targetLine]?.length || 10 }
          },
          message: `Collision Warning: Namespace '@ns(${currentFeat.namespace})' on basename '${path.basename(currentFeat.relPath)}' duplicates '${duplicateNs[0].relPath}'. Use a distinct '@ns(...)' value.`,
          source: 'Testform'
        });
      }
    }
  }

  return diagnostics;
}

