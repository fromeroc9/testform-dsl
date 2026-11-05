import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

export interface DetectedField {
  name: string;
  count: number;
  origin: string; // e.g. 'main.yml', 'testform.state', '*.feature'
}

/**
 * Scans the workspace configuration (main.yml/testform.yml), state ledger,
 * and feature files to discover all defined and active custom fields.
 */
export function detectProjectCustomFields(rootPath: string): DetectedField[] {
  const fieldCounts = new Map<string, number>();
  const fieldOrigins = new Map<string, string>();

  // Helper to register a field
  const registerField = (fieldName: string, origin: string, countDelta: number = 0) => {
    if (!fieldName) return;
    const lower = fieldName.toLowerCase().trim();
    if (['status', 'target', 'trace', 'evidence', 'title', 'labels', 'assignees', 'milestone', 'issuenumber', 'remoteid', 'createdat', 'updatedat', 'testcases', 'testcasestatuses', 'testruns'].includes(lower)) {
      return;
    }
    const current = fieldCounts.get(lower) || 0;
    fieldCounts.set(lower, current + countDelta);
    if (!fieldOrigins.has(lower)) {
      fieldOrigins.set(lower, origin);
    }
  };

  // 1. Scan Manifest YAML files (main.yml, main.yaml, testform.yml, testform.yaml, resource.yml, resource.yaml)
  const manifestNames = [
    'main.yml',
    'main.yaml',
    'testform.yml',
    'testform.yaml',
    'resource.yml',
    'resource.yaml'
  ];

  for (const name of manifestNames) {
    const filePath = path.join(rootPath, name);
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = YAML.parse(raw);
        if (parsed && typeof parsed === 'object') {
          // Check resource.testcase.fields, resource.global.fields, etc.
          const resObj = parsed.resource || parsed.scopes || {};
          const scopeKeys = ['global', 'testcase', 'testrun', 'testplan', 'bug'];
          for (const sKey of scopeKeys) {
            const scopeDef = resObj[sKey];
            if (scopeDef && typeof scopeDef === 'object') {
              const rawFields = scopeDef.fields;
              if (Array.isArray(rawFields)) {
                for (const fItem of rawFields) {
                  if (typeof fItem === 'string') {
                    registerField(fItem, name, 0);
                  } else if (fItem && typeof fItem === 'object' && fItem.name) {
                    registerField(String(fItem.name), name, 0);
                  }
                }
              } else if (rawFields && typeof rawFields === 'object') {
                for (const fKey of Object.keys(rawFields)) {
                  registerField(fKey, name, 0);
                }
              }
            }
          }

          // Direct fields declared under root fields
          if (Array.isArray(parsed.fields)) {
            for (const fItem of parsed.fields) {
              const fName = typeof fItem === 'string' ? fItem : fItem?.name;
              if (fName) registerField(String(fName), name, 0);
            }
          }
        }
      } catch {}
    }
  }

  // 2. Scan State File (testform.state / .testform/testform.state)
  const stateCandidates = [
    path.join(rootPath, 'testform.state'),
    path.join(rootPath, '.testform', 'testform.state')
  ];

  for (const sp of stateCandidates) {
    if (fs.existsSync(sp)) {
      try {
        const raw = fs.readFileSync(sp, 'utf8');
        const parsed = JSON.parse(raw);
        for (const r of parsed.resources || []) {
          const attrs = r.attributes || {};
          const custom = attrs.custom_fields || attrs.fields || {};
          if (typeof custom === 'object') {
            for (const [k, v] of Object.entries(custom)) {
              if (k && v !== undefined && v !== null && v !== '') {
                registerField(k, 'testform.state', 1);
              }
            }
          }
          // Direct scalar attributes on testcases / bugs
          for (const [k, v] of Object.entries(attrs)) {
            if (['title', 'status', 'labels', 'assignees', 'milestone', 'issueNumber', 'remoteId', 'createdAt', 'updatedAt', 'testcases', 'testcaseStatuses', 'testruns', 'custom_fields', 'fields'].includes(k)) continue;
            if (v !== undefined && v !== null && typeof v !== 'object') {
              registerField(k, 'testform.state', 1);
            }
          }
        }
        break;
      } catch {}
    }
  }

  // 3. Scan .feature files in workspace
  try {
    const scanDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === '.testform' || e.name === 'dist') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          scanDir(full);
        } else if (e.isFile() && e.name.endsWith('.feature')) {
          const content = fs.readFileSync(full, 'utf8');
          const lines = content.split(/\r?\n/);
          for (const l of lines) {
            const trimmed = l.trim();
            if (trimmed.startsWith('#')) continue;
            const fieldMatch = trimmed.match(/^(?:\*\s*)?(?:field|mark)\s+([a-zA-Z0-9_-]+)\s*=/i);
            if (fieldMatch) {
              const k = fieldMatch[1].toLowerCase().trim();
              registerField(k, '*.feature', 1);
            }
            if (trimmed.startsWith('@')) {
              const tags = trimmed.split(/\s+/);
              for (const t of tags) {
                const eqIdx = t.indexOf('=');
                if (eqIdx > 1) {
                  const k = t.slice(1, eqIdx).toLowerCase().trim();
                  registerField(k, '*.feature', 1);
                }
              }
            }
          }
        }
      }
    };
    scanDir(rootPath);
  } catch {}

  const result: DetectedField[] = [];
  for (const [name, count] of fieldCounts.entries()) {
    result.push({
      name,
      count,
      origin: fieldOrigins.get(name) || 'manifest'
    });
  }

  result.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return result;
}
