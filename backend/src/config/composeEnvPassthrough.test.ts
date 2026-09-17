/**
 * Every env var the backend reads must actually reach the container.
 *
 * `docker/docker-compose.prod.yml` enumerates its `environment:` keys, so it is
 * an ALLOWLIST, not a pass-through: a variable this config reads but that file
 * omits is silently empty in production no matter what the host exports. There
 * is no error, no warning — the feature simply behaves as if switched off.
 *
 * That is not hypothetical. `EMBED_ORIGINS` shipped read here and documented in
 * .env.production.example, but was never added to the compose file. The result
 * was that portal embedding could not be turned on at all: `frameAncestorsFor`
 * kept returning 'none' and the refresh cookie stayed SameSite=Lax, so sessions
 * died on every reload inside the itch iframe. It cost a deploy cycle to spot,
 * and the only outward symptom was helmet reporting `frame-ancestors 'none'`
 * on an /api response.
 *
 * Scoped to vars that are BOTH read here and documented as operator-settable.
 * A var that is read but undocumented is an internal default, not a knob.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/** Keys under any `environment:` block, e.g. `      EMBED_ORIGINS: ${...}`. */
function composeEnvKeys(yaml: string): Set<string> {
  return new Set([...yaml.matchAll(/^\s+([A-Z][A-Z0-9_]{2,}):/gm)].map((m) => m[1]));
}

/** `FOO=` or `# FOO=` in the operator example file. */
function documentedVars(env: string): Set<string> {
  return new Set([...env.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]{2,})=/gm)].map((m) => m[1]));
}

function envVarsRead(ts: string): Set<string> {
  return new Set([...ts.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]));
}

describe('docker-compose.prod.yml passes through what the backend reads', () => {
  const compose = composeEnvKeys(read('docker/docker-compose.prod.yml'));
  const documented = documentedVars(read('.env.production.example'));
  const consumed = envVarsRead(read('backend/src/config/index.ts'));

  it('parsed all three files into something usable', () => {
    // A regex that silently matched nothing would make every assertion below
    // vacuously pass, which is the same silent-failure shape being guarded.
    expect(compose.size).toBeGreaterThan(15);
    expect(documented.size).toBeGreaterThan(15);
    expect(consumed.size).toBeGreaterThan(15);
  });

  it('leaves no operator-settable var stranded outside the container', () => {
    const stranded = [...consumed].filter((v) => documented.has(v) && !compose.has(v)).sort();
    expect(stranded, `documented and read, but never passed to the container: ${stranded.join(', ')}`)
      .toEqual([]);
  });

  it('passes the two that were actually missing', () => {
    // Named explicitly so a future edit that drops them fails loudly here
    // rather than as an embedding feature that quietly refuses to switch on.
    expect(compose.has('EMBED_ORIGINS')).toBe(true);
    expect(compose.has('REFRESH_COOKIE_SECURE')).toBe(true);
  });
});
