export type ResourceScope = 'testcase' | 'testrun' | 'testplan' | 'bug';

export type IdentityConfigMap = Record<ResourceScope, string>;

export const RESOURCE_SCOPES: readonly ResourceScope[] = ['testcase', 'testrun', 'testplan', 'bug'];

export const DEFAULT_IDENTITY_PATTERNS: IdentityConfigMap = {
  testcase: 'tc-*',
  testrun: 'tr-*',
  testplan: 'tp-*',
  bug: 'bg-*'
};

export interface ParsedIdentityPattern {
  prefix: string;
  suffix: string;
  cleanPattern: string;
}

export interface IdentityTagMatch {
  scope: ResourceScope;
  pattern: string;
  rawTag: string;
  idToken: string;
  idNumber?: number;
  normalizedTag: string;
  index: number;
  length: number;
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createDefaultIdentities(): IdentityConfigMap {
  return { ...DEFAULT_IDENTITY_PATTERNS };
}

export function applyResourceBlockToConfig(
  resBlock: any,
  explicitIdentityScopes: Set<ResourceScope>,
  target: {
    identities: IdentityConfigMap;
    scopes?: Record<ResourceScope, string>;
    scaffoldDirectories?: Partial<Record<ResourceScope, string>>;
  }
): void {
  if (!resBlock || typeof resBlock !== 'object') return;
  for (const scope of RESOURCE_SCOPES) {
    const scopeBlock = resBlock[scope];
    if (!scopeBlock || typeof scopeBlock !== 'object') continue;
    if (scopeBlock.match && target.scopes) {
      target.scopes[scope] = String(scopeBlock.match).trim();
    }
    if (typeof scopeBlock.identity === 'string' && scopeBlock.identity.trim()) {
      target.identities[scope] = resolveScopeIdentityPattern(scopeBlock.identity, scopeBlock.match, scope);
      explicitIdentityScopes.add(scope);
    } else if (typeof scopeBlock.match === 'string' && !explicitIdentityScopes.has(scope)) {
      target.identities[scope] = resolveScopeIdentityPattern(undefined, scopeBlock.match, scope);
    }
    if (scopeBlock.scaffold?.directory && target.scaffoldDirectories) {
      target.scaffoldDirectories[scope] = String(scopeBlock.scaffold.directory).trim();
    }
  }
}

/**
 * Mirrors Testform CLI Config.getIdentity():
 * 1. Explicit resource.<scope>.identity
 * 2. Legacy suffix in resource.<scope>.match after ".feature." (e.g. "*.case.feature.flaviotag-*")
 * 3. Default per-scope pattern (tc-*, tr-*, tp-*, bg-*)
 */
export function resolveScopeIdentityPattern(
  configuredIdentity: string | undefined,
  matchPattern: string | undefined,
  scope: ResourceScope
): string {
  if (configuredIdentity && typeof configuredIdentity === 'string' && configuredIdentity.trim()) {
    return configuredIdentity.trim();
  }
  if (matchPattern && typeof matchPattern === 'string') {
    const lower = matchPattern.toLowerCase();
    const idx = lower.indexOf('.feature.');
    if (idx >= 0) {
      const after = matchPattern.slice(idx + '.feature.'.length).trim().replace(/^@/, '');
      if (after) {
        return after;
      }
    }
  }
  return DEFAULT_IDENTITY_PATTERNS[scope];
}

export function parseIdentityPattern(pattern: string): ParsedIdentityPattern {
  const cleanPattern = (pattern || 'tc-*').trim().replace(/^@/, '');
  const starIdx = cleanPattern.indexOf('*');
  if (starIdx >= 0) {
    return {
      prefix: cleanPattern.slice(0, starIdx),
      suffix: cleanPattern.slice(starIdx + 1),
      cleanPattern
    };
  }
  const normalizedPrefix = cleanPattern.endsWith('-') || cleanPattern.endsWith('_')
    ? cleanPattern
    : `${cleanPattern}-`;
  return {
    prefix: normalizedPrefix,
    suffix: '',
    cleanPattern: `${normalizedPrefix}*`
  };
}

/**
 * Resolves configured + legacy/fallback identity patterns for a workspace.
 */
export function getScopeOrderedList(preferredScope?: ResourceScope | null): ResourceScope[] {
  if (!preferredScope) return [...RESOURCE_SCOPES];
  return [preferredScope, ...RESOURCE_SCOPES.filter(s => s !== preferredScope)];
}

export function buildIdentityRegexForPattern(
  pattern: string,
  options?: { flags?: string; numericOnly?: boolean }
): RegExp {
  const { prefix, suffix } = parseIdentityPattern(pattern);
  const escPrefix = escapeRegex(prefix);
  const escSuffix = escapeRegex(suffix);
  const numericOnly = options?.numericOnly ?? false;
  const flags = options?.flags ?? 'gi';

  const wildcardExpr = numericOnly
    ? '([0-9]+)'
    : suffix
      ? '([a-zA-Z0-9_-]*?\\d[a-zA-Z0-9_-]*?)'
      : '([a-zA-Z0-9_-]*\\d[a-zA-Z0-9_-]*)';

  // Ensure @ isn't preceded by identifier chars (avoids emails), yet matches after spaces, start, ".", "(", quotes
  return new RegExp(`(?<![a-zA-Z0-9_])(@${escPrefix}${wildcardExpr}${escSuffix})(?![a-zA-Z0-9_-])`, flags);
}

export function buildNormalizedTag(pattern: string, idToken: string): { normalizedTag: string; idNumber?: number } {
  const { prefix, suffix } = parseIdentityPattern(pattern);
  const lowerPrefix = prefix.toLowerCase();
  const lowerSuffix = suffix.toLowerCase();

  if (/^\d+$/.test(idToken)) {
    const idNumber = parseInt(idToken, 10);
    return {
      normalizedTag: `@${lowerPrefix}${idNumber}${lowerSuffix}`,
      idNumber
    };
  }

  return {
    normalizedTag: `@${lowerPrefix}${idToken.toLowerCase()}${lowerSuffix}`
  };
}

export function findAllIdentityMatchesInLine(
  text: string,
  identities?: Partial<IdentityConfigMap>,
  preferredScope?: ResourceScope | null
): IdentityTagMatch[] {
  const resolved: IdentityConfigMap = { ...DEFAULT_IDENTITY_PATTERNS, ...(identities || {}) };
  const matches: IdentityTagMatch[] = [];
  const seenSpans = new Set<string>();

  for (const scope of getScopeOrderedList(preferredScope)) {
    const pattern = resolved[scope];
    if (!pattern) continue;
    const regex = buildIdentityRegexForPattern(pattern, { flags: 'gi', numericOnly: false });
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const spanKey = `${m.index}:${m[1].length}`;
      if (seenSpans.has(spanKey)) continue;
      seenSpans.add(spanKey);

      const rawTag = m[1];
      const idToken = m[2];
      const { normalizedTag, idNumber } = buildNormalizedTag(pattern, idToken);
      matches.push({
        scope,
        pattern,
        rawTag,
        idToken,
        idNumber,
        normalizedTag,
        index: m.index,
        length: rawTag.length
      });
    }
  }

  matches.sort((a, b) => a.index - b.index);
  return matches;
}

export function findFirstIdentityMatchInLine(
  text: string,
  identities?: Partial<IdentityConfigMap>,
  preferredScope?: ResourceScope | null
): IdentityTagMatch | null {
  const all = findAllIdentityMatchesInLine(text, identities, preferredScope);
  return all.length > 0 ? all[0] : null;
}

export function normalizeIdentityTagWithConfig(
  tag: string,
  identities?: Partial<IdentityConfigMap>,
  preferredScope?: ResourceScope | null
): string {
  const withAt = tag.startsWith('@') ? tag : `@${tag}`;
  const m = findFirstIdentityMatchInLine(withAt, identities, preferredScope);
  if (m && m.rawTag.length === withAt.length) {
    return m.normalizedTag;
  }
  return tag.toLowerCase();
}

export function findScenarioByIdentityTag<T>(
  scenarios: Map<string, T>,
  tag: string,
  identities?: Partial<IdentityConfigMap>,
  preferredScope?: ResourceScope | null
): T | undefined {
  const lower = (tag.startsWith('@') ? tag : `@${tag}`).toLowerCase();
  const direct = scenarios.get(lower);
  if (direct) return direct;

  const normalized = normalizeIdentityTagWithConfig(lower, identities, preferredScope);
  const byNorm = scenarios.get(normalized);
  if (byNorm) return byNorm;

  // Fallback check if stored with padding (e.g. stored "@flaviotag-01", queried "@flaviotag-1")
  for (const [k, v] of scenarios.entries()) {
    if (normalizeIdentityTagWithConfig(k, identities, preferredScope) === normalized) {
      return v;
    }
  }
  return undefined;
}

export function detectScopeByIdentityTag(
  text: string,
  identities?: Partial<IdentityConfigMap>
): ResourceScope | null {
  // Check non-testcase scopes first so testrun/testplan/bug files referencing @tc-1 under Scenarios resolve to their own file scope
  const order: ResourceScope[] = ['testrun', 'testplan', 'bug', 'testcase'];
  const resolved: IdentityConfigMap = { ...DEFAULT_IDENTITY_PATTERNS, ...(identities || {}) };

  for (const scope of order) {
    const regex = buildIdentityRegexForPattern(resolved[scope], { flags: 'i', numericOnly: false });
    if (regex.test(text)) {
      return scope;
    }
  }
  return null;
}

export function matchesGlobMatchPattern(filePath: string, matchPattern?: string): boolean {
  if (!matchPattern) return false;
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const baseName = normalizedPath.split('/').pop() || normalizedPath;
  const cleanGlob = matchPattern.split('.feature.')[0] + (matchPattern.toLowerCase().includes('.feature.') ? '.feature' : '');
  const regexStr = escapeRegex(cleanGlob.toLowerCase()).replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
  const target = cleanGlob.includes('/') ? normalizedPath : baseName;
  return new RegExp(`^${regexStr}$`, 'i').test(target);
}

export function formatNextIdentityForDocument(
  docText: string,
  pattern: string,
  scope: ResourceScope,
  fallbackMax: number,
  includeAt: boolean = false
): string {
  const { prefix, suffix } = parseIdentityPattern(pattern);
  const regex = buildIdentityRegexForPattern(pattern, { flags: 'gi', numericOnly: true });

  let maxNum = 0;
  let padLength = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(docText)) !== null) {
    const digits = match[2];
    const num = parseInt(digits, 10);
    if (!isNaN(num) && num > maxNum) {
      maxNum = num;
      padLength = digits.length;
    }
  }

  let nextToken: string;
  if (maxNum === 0) {
    nextToken = (scope === 'testcase' || scope === 'bug') ? '01' : String((fallbackMax || 0) + 1);
  } else {
    const nextNum = maxNum + 1;
    nextToken = padLength > 1 ? String(nextNum).padStart(padLength, '0') : String(nextNum);
  }

  const body = `${prefix}${nextToken}${suffix}`;
  return includeAt ? `@${body}` : body;
}

export function formatSampleIdentityTag(
  pattern: string,
  sampleNum: number = 1,
  padTwo: boolean = true,
  includeAt: boolean = true
): string {
  const { prefix, suffix } = parseIdentityPattern(pattern);
  const numStr = padTwo ? String(sampleNum).padStart(2, '0') : String(sampleNum);
  return `${includeAt ? '@' : ''}${prefix}${numStr}${suffix}`;
}

export function extractFeatureAddressAtLine(lineText: string): string | null {
  const m = lineText.match(/([a-zA-Z0-9_./-]+\.feature(?:\.@[a-zA-Z0-9_-]+)?)/i);
  return m ? m[1] : null;
}

export function buildSameNumberSearchRegex(
  tag: string,
  identities?: Partial<IdentityConfigMap>
): RegExp | null {
  const m = findFirstIdentityMatchInLine(tag, identities);
  if (!m) return null;
  const { prefix, suffix } = parseIdentityPattern(m.pattern);
  const escPrefix = escapeRegex(prefix);
  const escSuffix = escapeRegex(suffix);
  if (m.idNumber !== undefined) {
    return new RegExp(`@${escPrefix}0*${m.idNumber}${escSuffix}(?![a-zA-Z0-9_-])`, 'i');
  }
  return new RegExp(`${escapeRegex(m.rawTag)}(?![a-zA-Z0-9_-])`, 'i');
}

const RESERVED_DIRECTIVES = ['testcase', 'testrun', 'testplan', 'bug', 'depends_on'];

export function matchTypingIdentityPrefix(
  lineTextBeforeCursor: string,
  identities?: Partial<IdentityConfigMap>,
  preferredScope?: ResourceScope | null
): { scope: ResourceScope; pattern: string; prefix: string } | null {
  const tokenMatch = lineTextBeforeCursor.match(/@([a-zA-Z0-9_-]+)$/);
  if (!tokenMatch) return null;

  const typed = tokenMatch[1].toLowerCase();
  const resolved: IdentityConfigMap = { ...DEFAULT_IDENTITY_PATTERNS, ...(identities || {}) };

  for (const scope of getScopeOrderedList(preferredScope)) {
    const pattern = resolved[scope];
    const { prefix } = parseIdentityPattern(pattern);
    if (!prefix) continue;
    const lowerPrefix = prefix.toLowerCase();

    if (typed.startsWith(lowerPrefix)) {
      const rest = typed.slice(lowerPrefix.length);
      if (rest === '' || /^[0-9]+$/.test(rest)) {
        return { scope, pattern, prefix };
      }
    }

    const prefixNoSep = lowerPrefix.replace(/[-_]+$/, '');
    if (
      prefixNoSep.length >= 2 &&
      typed === prefixNoSep &&
      !RESERVED_DIRECTIVES.some(dir => dir.startsWith(typed))
    ) {
      return { scope, pattern, prefix };
    }
  }

  return null;
}

export function buildScenarioTagHeaderRegex(pattern: string, flags: string = 'gi'): RegExp {
  const { prefix, suffix } = parseIdentityPattern(pattern);
  const escPrefix = escapeRegex(prefix);
  const escSuffix = escapeRegex(suffix);
  return new RegExp(
    `(?:Scenario|Scenario\\s+Outline|Escenario|Esquema\\s+del\\s+escenario):\\s*(?:[^\\s#]*\\.)?@${escPrefix}[a-zA-Z0-9_-]*\\d[a-zA-Z0-9_-]*${escSuffix}(?![a-zA-Z0-9_-])`,
    flags
  );
}

export function detectFeatureDocumentScope(
  docText: string,
  docUri: string,
  featureFiles?: Iterable<{ fullPath: string; relPath: string; scope: ResourceScope }>,
  identities?: Partial<IdentityConfigMap>,
  scopes?: Partial<Record<ResourceScope, string>>
): ResourceScope | null {
  if (/@testrun\b/i.test(docText)) return 'testrun';
  if (/@testplan\b/i.test(docText)) return 'testplan';
  if (/@testcase\b/i.test(docText)) return 'testcase';
  if (/@bug\b/i.test(docText)) return 'bug';

  const byTag = detectScopeByIdentityTag(docText, identities);
  if (byTag) return byTag;

  const uriPath = docUri.replace(/\\/g, '/').toLowerCase();
  if (featureFiles) {
    for (const feat of featureFiles) {
      const featPath = feat.fullPath.replace(/\\/g, '/').toLowerCase();
      if (uriPath === featPath || uriPath.endsWith(feat.relPath.toLowerCase())) {
        return feat.scope;
      }
    }
  }

  if (scopes) {
    if (matchesGlobMatchPattern(uriPath, scopes.testrun)) return 'testrun';
    if (matchesGlobMatchPattern(uriPath, scopes.testplan)) return 'testplan';
    if (matchesGlobMatchPattern(uriPath, scopes.bug)) return 'bug';
    if (matchesGlobMatchPattern(uriPath, scopes.testcase)) return 'testcase';
  }

  if (uriPath.endsWith('.run.feature')) return 'testrun';
  if (uriPath.endsWith('.plan.feature')) return 'testplan';
  if (uriPath.endsWith('.bug.feature')) return 'bug';
  if (uriPath.endsWith('.case.feature')) return 'testcase';

  return null;
}

