import { Location, ReferenceParams } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { pathToFileURL } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceScanner } from './workspace-scanner';
import {
  buildSameNumberSearchRegex,
  extractFeatureAddressAtLine,
  findAllIdentityMatchesInLine
} from '../shared/identity';

/**
 * =========================================================================================
 * TESTFORM LSP REFERENCES PROVIDER (src/server/references.ts)
 * =========================================================================================
 * Provides Shift + F12 (Find All References) support across all feature files and manifests.
 *
 * Supported symbols:
 * - Scenario identity tags (@tc-XX, @tr-XX, @tp-XX, @bg-XX)
 * - 2-level canonical addresses (e.g. ParaBank/account_services.case.feature.@tc-01)
 * - Dot-notation namespace addresses (e.g. pix.boleto.case.feature.@tc-01)
 * - Basename addresses (e.g. account_services.case.feature.@tc-01)
 * - Feature file names in Rule: clauses (e.g. Rule: checkout.case.feature)
 * - Variables (var.xyz) across Gherkin files and main.yml
 */

export function provideReferences(
  params: ReferenceParams,
  document: TextDocument,
  scanner: WorkspaceScanner
): Location[] | null {
  const lineText = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line + 1, character: 0 }
  });

  const locations: Location[] = [];

  // 1. Detect Scenario Identity Tag (configured resource.<scope>.identity or @tc-X, @tr-X, @tp-X, @bg-X)
  const idMatches = findAllIdentityMatchesInLine(lineText, scanner.config.identities);
  const idMatch =
    idMatches.find(m => params.position.character >= m.index && params.position.character <= m.index + m.length) ||
    idMatches[0];
  const targetTag = idMatch ? idMatch.rawTag.toLowerCase() : null;

  // 2. Detect canonical or namespace address on current line
  const targetAddress = extractFeatureAddressAtLine(lineText);

  // 3. Detect Rule feature target (Rule: filename.feature)
  const ruleMatch = lineText.match(/^(?:\s*Rule|\s*Regla):\s*([a-zA-Z0-9_./-]+\.feature)/i);
  const targetRuleFile = ruleMatch ? path.basename(ruleMatch[1].trim()) : null;

  // 4. Detect variable reference (var.name)
  const varMatch = lineText.match(/\bvar\.([a-zA-Z0-9_]+)\b/);
  const targetVar = varMatch ? varMatch[1] : null;

  if (!targetTag && !targetAddress && !targetRuleFile && !targetVar) {
    return null;
  }

  // Collect search terms to match against all feature files
  const searchPatterns: RegExp[] = [];

  if (targetTag) {
    // Matches @flaviotag-1, @flaviotag-01, @flaviotag-001 with word boundaries
    const tagRegex = buildSameNumberSearchRegex(targetTag, scanner.config.identities);
    if (tagRegex) {
      searchPatterns.push(tagRegex);
    }
  }

  if (targetAddress) {
    const escapedAddr = targetAddress.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    searchPatterns.push(new RegExp(escapedAddr, 'i'));
    const baseAddr = path.basename(targetAddress);
    if (baseAddr !== targetAddress) {
      searchPatterns.push(new RegExp(baseAddr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  }

  if (targetRuleFile) {
    const escapedBase = targetRuleFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    searchPatterns.push(new RegExp(escapedBase, 'i'));
  }

  if (targetVar) {
    searchPatterns.push(new RegExp(`\\bvar\\.${targetVar}\\b`));
    searchPatterns.push(new RegExp(`\\$\{var\\.${targetVar}[^}]*\}`));
  }

  if (searchPatterns.length === 0) return null;

  // Search through all known feature files
  for (const [, feat] of scanner.featureFiles.entries()) {
    try {
      if (!fs.existsSync(feat.fullPath)) continue;
      const content = fs.readFileSync(feat.fullPath, 'utf8');
      const lines = content.split(/\r?\n/);
      const uri = pathToFileURL(feat.fullPath).href;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of searchPatterns) {
          const match = pattern.exec(line);
          if (match) {
            locations.push(
              Location.create(uri, {
                start: { line: i, character: match.index },
                end: { line: i, character: match.index + match[0].length }
              })
            );
            break; // Don't duplicate if multiple patterns match same line
          }
        }
      }
    } catch {}
  }

  return locations.length > 0 ? locations : null;
}
