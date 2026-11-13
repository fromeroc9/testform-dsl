import {
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  TextDocument,
  TextEdit,
} from 'vscode-languageserver';
import * as path from 'path';
import { WorkspaceScanner } from './workspace-scanner';
import { detectFeatureDocumentScope, ResourceScope } from '../shared/identity';

interface FieldContractInfo {
  name: string;
  source?: string;
  required?: boolean;
  default?: any;
  enum?: string[];
  scopes?: string[];
}

function detectDocumentScope(document: TextDocument, scanner: WorkspaceScanner): ResourceScope {
  return (
    detectFeatureDocumentScope(
      document.getText(),
      document.uri,
      scanner.featureFiles.values(),
      scanner.config.identities,
      scanner.config.scopes
    ) ?? 'testcase'
  );
}

function inferContextValues(docUri: string): { project: string; module: string } {
  const normUri = docUri.replace(/\\/g, '/');
  const parts = normUri.split('/');
  const fileName = parts.pop() || '';
  const folderName = parts.pop() || '';

  let project = 'ProjectName';
  let module = 'ModuleName';

  if (folderName && !['testcase', 'testruns', 'testplans', 'testcycle', 'tests', 'features'].includes(folderName.toLowerCase())) {
    project = folderName;
  }
  const cleanBase = fileName.replace(/(\.(case|run|plan|bug))?\.feature$/i, '');
  if (cleanBase && cleanBase !== 'test') {
    module = cleanBase.charAt(0).toUpperCase() + cleanBase.slice(1).replace(/_/g, ' ');
  }

  return { project, module };
}

function getFieldDefaultOrSample(f: FieldContractInfo, inferred: { project: string; module: string }): string {
  const lower = f.name.toLowerCase();
  if (f.default !== undefined) return String(f.default);
  if (f.enum && f.enum.length > 0) return f.enum[0];
  if (lower === 'project') return inferred.project;
  if (lower === 'module') return inferred.module;
  if (lower === 'component') return 'microservice-1';
  if (lower === 'startdate') return new Date().toISOString().slice(0, 10);
  if (lower === 'enddate') return new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  if (lower === 'severity') return 'major';
  if (lower === 'priority') return '@medium';
  return 'value';
}

export function provideCodeActions(
  params: CodeActionParams,
  document: TextDocument,
  scanner: WorkspaceScanner
): CodeAction[] {
  const actions: CodeAction[] = [];

  
  const text = document.getText();
  const lines = text.split(/\r?\n/);
  const docScope = detectDocumentScope(document, scanner);
  const inferred = inferContextValues(document.uri);

  // Check for collision diagnostic or collision quick fix
  const collisionDiag = params.context.diagnostics?.find(
    d => d.code === 'testform-collision-namespace' || (typeof d.message === 'string' && d.message.includes('Collision Warning'))
  );

  const currentFeat = scanner.findFeatureByUri(document.uri);

  if (currentFeat && !currentFeat.namespace) {
    const currentBase = path.basename(currentFeat.relPath).toLowerCase();
    const colliding = Array.from(scanner.featureFiles.values()).filter(other =>
      other.scope === currentFeat.scope &&
      path.resolve(other.fullPath) !== path.resolve(currentFeat.fullPath) &&
      path.basename(other.relPath).toLowerCase() === currentBase &&
      !other.namespace
    );

    if (colliding.length > 0 || collisionDiag) {
      const parentDir = path.basename(path.dirname(currentFeat.fullPath));
      let suggestedNs = parentDir.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      if (['testcase', 'testruns', 'testplans', 'bugs', 'tests', 'features'].includes(suggestedNs)) {
        suggestedNs = inferred.project.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      }

      let targetLine = 0;
      for (let i = 0; i < lines.length; i++) {
        if (/^(?:Feature|Característica):/i.test(lines[i].trim())) {
          targetLine = i;
          break;
        }
      }

      const nsAction = CodeAction.create(
        `💡 Add '@ns(${suggestedNs})' to disambiguate feature address`,
        {
          changes: {
            [document.uri]: [
              TextEdit.insert(
                { line: targetLine, character: 0 },
                `@ns(${suggestedNs})\n`
              )
            ]
          }
        },
        CodeActionKind.QuickFix
      );
      nsAction.isPreferred = true;
      if (collisionDiag) {
        nsAction.diagnostics = [collisionDiag];
      }
      actions.push(nsAction);
    }
  }

  // 1. Collect applicable required fields for this resource type
  const requiredFields: FieldContractInfo[] = [];
  for (const info of scanner.customFields.values()) {
    if (!info.required) continue;
    if (!info.scopes || info.scopes.length === 0 || info.scopes.includes('global') || info.scopes.includes(docScope)) {
      requiredFields.push(info);
    }
  }

  if (requiredFields.length === 0) return actions;

  // 2. Parse document structure: Feature line, Background line and fields, Scenarios and their fields
  let featureLine = -1;
  let backgroundHeaderLine = -1;
  let backgroundEndLine = -1;
  const backgroundFields = new Map<string, string>();
  const backgroundTags = new Set<string>();

  interface ScenarioBlock {
    headerLine: number;
    endLine: number;
    title: string;
    fields: Map<string, string>;
    tags: Set<string>;
  }

  const scenarios: ScenarioBlock[] = [];
  let currentScenario: ScenarioBlock | null = null;
  let inBackground = false;

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

    if (/^(?:Rule|Regla):/i.test(trimmed)) {
      inBackground = false;
      if (currentScenario) {
        currentScenario.endLine = i - 1;
        scenarios.push(currentScenario);
        currentScenario = null;
      }
      continue;
    }

    const scMatch = trimmed.match(/^(?:Scenario|Scenario Outline|Escenario|Esquema del escenario):\s*(.*)$/i);
    if (scMatch) {
      if (inBackground) {
        backgroundEndLine = i - 1;
        inBackground = false;
      }
      if (currentScenario) {
        currentScenario.endLine = i - 1;
        scenarios.push(currentScenario);
      }
      currentScenario = {
        headerLine: i,
        endLine: i,
        title: scMatch[1].trim(),
        fields: new Map(),
        tags: new Set()
      };
      continue;
    }

    // Extract tags
    const tags = trimmed.match(/@[a-zA-Z0-9_.-]+/g);
    if (tags) {
      for (const t of tags) {
        const lowerT = t.toLowerCase();
        if (currentScenario) currentScenario.tags.add(lowerT);
        else if (inBackground) backgroundTags.add(lowerT);
      }
    }

    // Extract fields
    const fMatch = trimmed.match(/(?:^|\s+)field\s+([a-zA-Z0-9_.-]+)\s*=\s*(.+)$/i);
    if (fMatch) {
      const fName = fMatch[1].trim().toLowerCase();
      const fVal = fMatch[2].trim().replace(/^["']|["']$/g, '');
      if (currentScenario) {
        currentScenario.fields.set(fName, fVal);
      } else if (inBackground || backgroundHeaderLine >= 0) {
        backgroundFields.set(fName, fVal);
      }
    }
  }

  if (inBackground && backgroundEndLine === -1) {
    backgroundEndLine = lines.length - 1;
  }
  if (currentScenario) {
    currentScenario.endLine = lines.length - 1;
    scenarios.push(currentScenario);
  }

  const reqMissingInBackground = requiredFields.filter(rf => {
    const lowerName = rf.name.toLowerCase();
    if (rf.source === 'tag') {
      const hasTag = backgroundTags.has(`@${lowerName}`);
      const hasEnum = rf.enum && rf.enum.some(e => backgroundTags.has(e.toLowerCase()));
      return !hasTag && !hasEnum && !backgroundFields.has(lowerName);
    }
    return !backgroundFields.has(lowerName);
  });

  const cursorLine = params.range.start.line;
  const activeScenario = scenarios.find(s => cursorLine >= s.headerLine && cursorLine <= s.endLine);

  // Helper to build Background insertion TextEdit
  const buildBackgroundEdit = (): TextEdit => {
    const indent = '    ';
    const fieldLines = reqMissingInBackground.map(f => {
      const val = getFieldDefaultOrSample(f, inferred);
      if (f.source === 'tag') {
        return `${indent}# Required tag: ${val.startsWith('@') ? val : '@' + val}`;
      }
      return `${indent}* field ${f.name} = ${val}`;
    }).join('\n');

    if (backgroundHeaderLine >= 0) {
      // Background exists: insert at the end of Background block
      const insertAtLine = (backgroundEndLine >= backgroundHeaderLine ? backgroundEndLine : backgroundHeaderLine) + 1;
      return TextEdit.insert(
        { line: insertAtLine, character: 0 },
        `${fieldLines}\n`
      );
    } else {
      // Create Background under Feature:
      const insertAtLine = featureLine >= 0 ? featureLine + 1 : 0;
      const bgBlock = `\n  Background:\n${fieldLines}\n`;
      return TextEdit.insert(
        { line: insertAtLine, character: 0 },
        bgBlock
      );
    }
  };

  // 3. Quick Fix for Scenario in @testcase
  if (docScope === 'testcase' && activeScenario) {
    // Missing required fields for this specific scenario (considering Background inheritance)
    const reqMissingInScenario = requiredFields.filter(rf => {
      const lowerName = rf.name.toLowerCase();
      // If satisfied in Background, it is not missing!
      if (backgroundFields.has(lowerName)) return false;
      if (rf.source === 'tag') {
        const hasTag = activeScenario.tags.has(`@${lowerName}`) || backgroundTags.has(`@${lowerName}`);
        const hasEnum = rf.enum && rf.enum.some(e => activeScenario.tags.has(e.toLowerCase()) || backgroundTags.has(e.toLowerCase()));
        return !hasTag && !hasEnum && !activeScenario.fields.has(lowerName);
      }
      return !activeScenario.fields.has(lowerName);
    });

    if (reqMissingInScenario.length > 0) {
      const indent = '    ';
      const scenarioFieldLines = reqMissingInScenario.map(f => {
        const val = getFieldDefaultOrSample(f, inferred);
        return `${indent}* field ${f.name} = ${val}`;
      }).join('\n');

      // Action A: Implement missing required fields directly for this scenario (Recommended)
      const scenarioAction = CodeAction.create(
        `💡 Implement missing required fields for this scenario (${reqMissingInScenario.map(f => f.name).join(', ')})`,
        {
          changes: {
            [document.uri]: [
              TextEdit.insert(
                { line: activeScenario.headerLine + 1, character: 0 },
                `${scenarioFieldLines}\n`
              )
            ]
          }
        },
        CodeActionKind.QuickFix
      );
      scenarioAction.isPreferred = true;
      actions.push(scenarioAction);

      // Action B: Implement missing required fields globally in Background:
      if (reqMissingInBackground.length > 0) {
        const bgAction = CodeAction.create(
          `💡 Implement missing required fields globally in Background: (${reqMissingInBackground.map(f => f.name).join(', ')})`,
          {
            changes: {
              [document.uri]: [buildBackgroundEdit()]
            }
          },
          CodeActionKind.QuickFix
        );
        actions.push(bgAction);
      }
      return actions;
    }
  }

  // 4. Quick Fix for Background / Feature level (Testcase, Testrun, Testplan, Bug)
  if (reqMissingInBackground.length > 0) {
    const bgAction = CodeAction.create(
      `💡 Implement all missing required fields in Background: (${reqMissingInBackground.map(f => f.name).join(', ')})`,
      {
        changes: {
          [document.uri]: [buildBackgroundEdit()]
        }
      },
      CodeActionKind.QuickFix
    );
    bgAction.isPreferred = true;
    actions.push(bgAction);
  }

  return actions;
}
