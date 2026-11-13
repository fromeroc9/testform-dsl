import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import {
  applyResourceBlockToConfig,
  createDefaultIdentities,
  IdentityConfigMap,
  ResourceScope
} from './identity';

/**
 * Lightweight synchronous loader for workspace resource identity patterns,
 * intended for VS Code extension-host views/controllers without LSP state.
 */
export function loadWorkspaceIdentitiesSync(workspaceRoot: string): IdentityConfigMap {
  const identities = createDefaultIdentities();
  const explicit = new Set<ResourceScope>();

  const applyResource = (resBlock: any) => {
    applyResourceBlockToConfig(resBlock, explicit, { identities });
  };

  const candidates = ['main.yml', 'main.yaml', 'testform.yml', 'testform.yaml', 'testform.config.yml', 'testform.config.yaml'];
  let baseFile: string | null = null;
  for (const name of candidates) {
    const full = path.join(workspaceRoot, name);
    if (!fs.existsSync(full)) continue;
    baseFile = path.resolve(full);
    try {
      const parsed = YAML.parse(fs.readFileSync(full, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        applyResource(parsed.resource || parsed.scopes);
      }
    } catch {}
    break;
  }

  try {
    const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if ((!lower.endsWith('.yml') && !lower.endsWith('.yaml')) || lower.endsWith('.vars.yml') || lower.endsWith('.vars.yaml')) continue;
      const full = path.join(workspaceRoot, entry.name);
      if (baseFile && path.resolve(full) === baseFile) continue;
      try {
        const parsed = YAML.parse(fs.readFileSync(full, 'utf8'));
        if (!parsed || typeof parsed !== 'object') continue;
        const res = parsed.resource || parsed.scopes || (lower.startsWith('resource.') ? parsed : null);
        if (res) applyResource(res);
      } catch {}
    }
  } catch {}

  return identities;
}
