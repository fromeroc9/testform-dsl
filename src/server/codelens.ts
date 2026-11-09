import {
  CodeLens,
  Range,
  TextDocument
} from 'vscode-languageserver';
import * as fs from 'fs';
import { WorkspaceScanner } from './workspace-scanner';

export interface CodeLensSettings {
  enable: boolean;
  testcase: boolean;
  testrun: boolean;
  testplan: boolean;
  bug: boolean;
}

function detectDocumentScope(document: TextDocument, scanner: WorkspaceScanner): 'testcase' | 'testrun' | 'testplan' | 'bug' {
  const docText = document.getText();
  if (/@testrun\b/i.test(docText)) return 'testrun';
  if (/@testplan\b/i.test(docText)) return 'testplan';
  if (/@testcase\b/i.test(docText)) return 'testcase';
  if (/@bug\b/i.test(docText)) return 'bug';

  if (/@tr-\d+\b/i.test(docText)) return 'testrun';
  if (/@tp-\d+\b/i.test(docText)) return 'testplan';
  if (/@tc-\d+\b/i.test(docText)) return 'testcase';
  if (/@bg-\d+\b/i.test(docText)) return 'bug';

  const uriPath = document.uri.replace(/\\/g, '/').toLowerCase();
  for (const [_, feat] of scanner.featureFiles.entries()) {
    const featPath = feat.fullPath.replace(/\\/g, '/').toLowerCase();
    if (uriPath === featPath || uriPath.endsWith(feat.relPath.toLowerCase())) {
      return feat.scope;
    }
  }

  if (uriPath.endsWith('.run.feature')) return 'testrun';
  if (uriPath.endsWith('.plan.feature')) return 'testplan';
  if (uriPath.endsWith('.bug.feature')) return 'bug';
  return 'testcase';
}

export function provideCodeLenses(
  document: TextDocument,
  scanner: WorkspaceScanner,
  settings: CodeLensSettings
): CodeLens[] {
  if (!settings.enable) return [];

  const docScope = detectDocumentScope(document, scanner);

  // Per-resource type toggle check
  if (docScope === 'testcase' && !settings.testcase) return [];
  if (docScope === 'testrun' && !settings.testrun) return [];
  if (docScope === 'testplan' && !settings.testplan) return [];
  if (docScope === 'bug' && !settings.bug) return [];

  const lenses: CodeLens[] = [];
  const text = document.getText();
  const lines = text.split(/\r?\n/);

  // 1. Collect required fields for this scope
  const requiredFields = [...scanner.customFields.values()].filter(f => {
    if (!f.required) return false;
    if (!f.scopes || f.scopes.length === 0 || f.scopes.includes('global') || f.scopes.includes(docScope)) return true;
    return false;
  });

  let featureLine = -1;
  let backgroundHeaderLine = -1;
  let inBackground = false;
  const backgroundFields = new Map<string, string>();
  const backgroundTags = new Set<string>();

  interface ScenarioInfo {
    line: number;
    title: string;
    rulePath: string | null;
    status: string | null;
    hasTarget: boolean;
    fields: Map<string, string>;
    tags: Set<string>;
  }

  const scenarios: ScenarioInfo[] = [];
  let currentRulePath: string | null = null;
  const ruleLines: { line: number; path: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.startsWith('#')) continue;

    if (/^(?:Feature|Característica):/i.test(trimmed)) {
      featureLine = i;
      continue;
    }

    if (/^(?:Background|Antecedentes):/i.test(trimmed)) {
      backgroundHeaderLine = i;
      inBackground = true;
      continue;
    }

    const ruleMatch = trimmed.match(/^(?:Rule|Regla):\s*(.*)$/i);
    if (ruleMatch) {
      inBackground = false;
      currentRulePath = ruleMatch[1].trim();
      ruleLines.push({ line: i, path: currentRulePath });
      continue;
    }

    const scMatch = trimmed.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.*)$/i);
    if (scMatch) {
      inBackground = false;
      scenarios.push({
        line: i,
        title: scMatch[1].trim(),
        rulePath: currentRulePath,
        status: null,
        hasTarget: false,
        fields: new Map(),
        tags: new Set()
      });
      continue;
    }

    // Inspect fields and marks in active scenario or background
    const activeScenario = scenarios[scenarios.length - 1];

    const fMatch = trimmed.match(/(?:^|\s+)field\s+([a-zA-Z0-9_.-]+)\s*=\s*(.+)$/i);
    if (fMatch) {
      const fName = fMatch[1].trim().toLowerCase();
      const fVal = fMatch[2].trim();
      if (activeScenario && !inBackground) {
        activeScenario.fields.set(fName, fVal);
      } else {
        backgroundFields.set(fName, fVal);
      }
    }

    const statusMatch = trimmed.match(/(?:^|\s+)mark\s+status\s*=\s*([a-zA-Z]+)/i);
    if (statusMatch && activeScenario) {
      activeScenario.status = statusMatch[1].trim().toLowerCase();
    }

    if (/\b(?:mark\s+)?target\s*=/i.test(trimmed) && activeScenario) {
      activeScenario.hasTarget = true;
    }

    const tagMatches = trimmed.match(/@[a-zA-Z0-9_.-]+/g);
    if (tagMatches) {
      for (const t of tagMatches) {
        if (activeScenario && !inBackground) activeScenario.tags.add(t.toLowerCase());
        else backgroundTags.add(t.toLowerCase());
      }
    }
  }

  // 2. Check missing required fields in Background
  const missingInBackground = requiredFields.filter(rf => {
    const lowerName = rf.name.toLowerCase();
    if (rf.source === 'tag') {
      const hasTag = backgroundTags.has(`@${lowerName}`);
      const hasEnum = rf.enum && rf.enum.some(e => backgroundTags.has(e.toLowerCase()));
      return !hasTag && !hasEnum && !backgroundFields.has(lowerName);
    }
    return !backgroundFields.has(lowerName);
  });

  // 3. Generate Resource-Specific CodeLenses

  // --- A. TESTRUN CODELENS ---
  if (docScope === 'testrun') {
    // 3.1 Feature-level metrics CodeLens
    if (scenarios.length > 0 && featureLine >= 0) {
      const passed = scenarios.filter(s => s.status === 'passed').length;
      const failed = scenarios.filter(s => s.status === 'failed').length;
      const pending = scenarios.filter(s => !s.status || s.status === 'pending').length;
      const skipped = scenarios.filter(s => s.status === 'skipped' || s.status === 'blocked').length;
      const total = scenarios.length;
      const pct = Math.round((passed / total) * 100);

      const parts: string[] = [];
      if (passed > 0) parts.push(`✓ ${passed} Passed`);
      if (failed > 0) parts.push(`✗ ${failed} Failed`);
      if (pending > 0) parts.push(`⏳ ${pending} Pending`);
      if (skipped > 0) parts.push(`⊘ ${skipped} Skipped`);

      const summary = `${parts.join(' · ')} (${pct}%)`;
      lenses.push({
        range: Range.create(featureLine, 0, featureLine, 0),
        command: {
          title: summary,
          command: ''
        }
      });
    }

    // 3.2 Rule-level metrics CodeLens
    for (const rl of ruleLines) {
      const ruleScenarios = scenarios.filter(s => s.rulePath === rl.path);
      if (ruleScenarios.length > 0) {
        const passed = ruleScenarios.filter(s => s.status === 'passed').length;
        const failed = ruleScenarios.filter(s => s.status === 'failed').length;
        const total = ruleScenarios.length;
        const pct = Math.round((passed / total) * 100);

        const summary = `✓ ${passed}/${total} Passed (${pct}%)${failed > 0 ? ` · ✗ ${failed} Failed` : ''}`;
        lenses.push({
          range: Range.create(rl.line, 0, rl.line, 0),
          command: {
            title: summary,
            command: ''
          }
        });
      }
    }

    // 3.3 Missing required fields in Background
    if (missingInBackground.length > 0) {
      const targetL = backgroundHeaderLine >= 0 ? backgroundHeaderLine : (featureLine >= 0 ? featureLine : 0);
      lenses.push({
        range: Range.create(targetL, 0, targetL, 0),
        command: {
          title: `💡 Implement missing required fields in Background: (${missingInBackground.map(f => f.name).join(', ')})`,
          command: 'testform.implementRequiredFields',
          arguments: [{ uri: document.uri, target: 'background' }]
        }
      });
    }
  }

  // --- B. TESTPLAN CODELENS ---
  if (docScope === 'testplan') {
    // 3.4 Inspect suites in Rule: lines of testplan
    for (const rl of ruleLines) {
      const normRule = rl.path.toLowerCase().replace(/\\/g, '/');
      const normRuleBase = normRule.split('/').pop() || normRule;

      // Find target testrun file
      let targetRunFeat = [...scanner.featureFiles.values()].find(f => {
        const p = f.relPath.toLowerCase().replace(/\\/g, '/');
        return p.endsWith(normRule) || p.endsWith(normRuleBase);
      });

      if (targetRunFeat) {
        // Read testrun file and compute pass/fail stats
        try {
          const runContent = fs.readFileSync(targetRunFeat.fullPath, 'utf8');
          const runScenarios = (runContent.match(/Scenario:\s*@tc-[0-9]+/gi) || []).length;
          const runPassed = (runContent.match(/mark\s+status\s*=\s*passed/gi) || []).length;
          const runFailed = (runContent.match(/mark\s+status\s*=\s*failed/gi) || []).length;

          if (runScenarios > 0) {
            const pct = Math.round((runPassed / runScenarios) * 100);
            const summary = `Suite Status: ✓ ${runPassed}/${runScenarios} Passed (${pct}%)${runFailed > 0 ? ` · ✗ ${runFailed} Failed` : ''}`;
            lenses.push({
              range: Range.create(rl.line, 0, rl.line, 0),
              command: {
                title: summary,
                command: ''
              }
            });
          }
        } catch {}
      }
    }

    // 3.5 Missing required fields in testplan
    if (missingInBackground.length > 0) {
      const targetL = backgroundHeaderLine >= 0 ? backgroundHeaderLine : (featureLine >= 0 ? featureLine : 0);
      lenses.push({
        range: Range.create(targetL, 0, targetL, 0),
        command: {
          title: `💡 Implement missing required fields in Background: (${missingInBackground.map(f => f.name).join(', ')})`,
          command: 'testform.implementRequiredFields',
          arguments: [{ uri: document.uri, target: 'background' }]
        }
      });
    }
  }

  // --- C. TESTCASE CODELENS ---
  if (docScope === 'testcase') {
    // 3.6 Global Background missing fields
    if (missingInBackground.length > 0) {
      const targetL = backgroundHeaderLine >= 0 ? backgroundHeaderLine : (featureLine >= 0 ? featureLine : 0);
      lenses.push({
        range: Range.create(targetL, 0, targetL, 0),
        command: {
          title: `💡 Implement missing required fields in Background: (${missingInBackground.map(f => f.name).join(', ')})`,
          command: 'testform.implementRequiredFields',
          arguments: [{ uri: document.uri, target: 'background' }]
        }
      });
    }

    // 3.7 Scenario-level missing required fields
    for (const sc of scenarios) {
      const missingInScenario = requiredFields.filter(rf => {
        const lowerName = rf.name.toLowerCase();
        // Satisfied in Background
        if (backgroundFields.has(lowerName)) return false;
        if (rf.source === 'tag') {
          const hasTag = sc.tags.has(`@${lowerName}`) || backgroundTags.has(`@${lowerName}`);
          const hasEnum = rf.enum && rf.enum.some(e => sc.tags.has(e.toLowerCase()) || backgroundTags.has(e.toLowerCase()));
          return !hasTag && !hasEnum && !sc.fields.has(lowerName);
        }
        return !sc.fields.has(lowerName);
      });

      if (missingInScenario.length > 0) {
        lenses.push({
          range: Range.create(sc.line, 0, sc.line, 0),
          command: {
            title: `💡 Implement required fields for this scenario (${missingInScenario.map(f => f.name).join(', ')})`,
            command: 'testform.implementRequiredFields',
            arguments: [{ uri: document.uri, target: 'scenario', line: sc.line }]
          }
        });
      }
    }
  }

  // --- D. BUG CODELENS ---
  if (docScope === 'bug') {
    for (const sc of scenarios) {
      if (!sc.hasTarget) {
        lenses.push({
          range: Range.create(sc.line, 0, sc.line, 0),
          command: {
            title: `💡 Set failing testcase target (* mark target = ...)`,
            command: 'testform.implementRequiredFields',
            arguments: [{ uri: document.uri, target: 'scenario', line: sc.line }]
          }
        });
      }
    }
  }

  return lenses;
}
