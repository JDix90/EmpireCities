/**
 * Portal registry sync — keeps the three places that must agree about who may
 * embed the game in step, from one list.
 *
 * The three:
 *   1. nginx `frame-ancestors`   (docker/nginx.prod.conf)   — who may FRAME us
 *   2. EMBED_ORIGINS             (backend env, operator-set) — who gets the
 *                                 cross-site refresh cookie
 *   3. the client portal policy  (frontend/src/utils/portals.generated.ts)
 *
 * They drifted once already: the CSP carried `https://*.crazygames.com`, the
 * cookie allowlist could not express a wildcard, and a hand-expanded list
 * dropped `www.crazygames.com` — the one origin players arrive on. A portal
 * whose CSP entry exists but whose cookie entry does not fails in the worst
 * way: the frame renders, the game plays, and every reload starts a fresh
 * anonymous session.
 *
 * So `docker/portals.json` is the source of truth. This script rewrites (1)
 * and (3) and prints (2), and `portalRegistry.test.ts` fails when either
 * written artifact is stale. Origin syntax is shared: a leading `*.` is a
 * subdomain wildcard in both CSP and `parseEmbedOriginList`, and neither has a
 * TLD wildcard, so regional portal domains are enumerated.
 *
 * Lives in backend/scripts (ESM under tsx) because backend/src compiles to
 * CommonJS, where `import.meta` is a compile error — same reason as
 * generateFactionCodex.ts. Only writes when invoked directly; the drift test
 * imports the pure functions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const REGISTRY_PATH = resolve(REPO_ROOT, 'docker', 'portals.json');
export const NGINX_CONF_PATH = resolve(REPO_ROOT, 'docker', 'nginx.prod.conf');
export const GENERATED_TS_PATH = resolve(REPO_ROOT, 'frontend', 'src', 'utils', 'portals.generated.ts');
export const ENV_EXAMPLE_PATH = resolve(REPO_ROOT, '.env.production.example');

export interface Portal {
  id: string;
  name: string;
  origins: string[];
  ownAuthUi: boolean;
  notes?: string;
}
export interface PortalRegistry {
  portals: Portal[];
}

export function loadRegistry(path: string = REGISTRY_PATH): PortalRegistry {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { portals?: unknown };
  if (!Array.isArray(parsed.portals)) throw new Error(`${path}: expected a "portals" array`);
  return { portals: parsed.portals as Portal[] };
}

/** Every origin across every portal, registry order, first occurrence wins. */
export function allOrigins(reg: PortalRegistry): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of reg.portals) for (const o of p.origins) if (!seen.has(o)) { seen.add(o); out.push(o); }
  return out;
}

/** The value to set for EMBED_ORIGINS on the backend. */
export function embedOriginsValue(reg: PortalRegistry): string {
  return allOrigins(reg).join(',');
}

// ── nginx ────────────────────────────────────────────────────────────────────

export const NGINX_BEGIN = '# BEGIN portal frame-ancestors';
export const NGINX_END = '# END portal frame-ancestors';

/** The generated block, indented to match the server block it sits in. */
export function nginxBlock(reg: PortalRegistry, indent = '    '): string {
  const value = ["'self'", ...allOrigins(reg)].join(' ');
  return [
    `${indent}${NGINX_BEGIN} — GENERATED from docker/portals.json. Do not edit here:`,
    `${indent}# edit the registry and run \`pnpm -C backend exec tsx scripts/syncPortals.ts\`.`,
    `${indent}add_header Content-Security-Policy "frame-ancestors ${value};" always;`,
    `${indent}${NGINX_END}`,
  ].join('\n');
}

const ADD_HEADER_RE = /^([ \t]*)add_header Content-Security-Policy "frame-ancestors [^\n]*$/m;

/**
 * Return the conf with the generated block in place. First run wraps the
 * existing bare `add_header … frame-ancestors` line in markers; every later
 * run replaces what is between them. Idempotent.
 */
export function syncNginxConf(conf: string, reg: PortalRegistry): string {
  const begin = conf.indexOf(NGINX_BEGIN);
  const end = conf.indexOf(NGINX_END);
  if (begin !== -1 && end !== -1) {
    const lineStart = conf.lastIndexOf('\n', begin) + 1;
    const lineEnd = conf.indexOf('\n', end);
    const indent = conf.slice(lineStart, begin);
    return conf.slice(0, lineStart) + nginxBlock(reg, indent) + conf.slice(lineEnd === -1 ? conf.length : lineEnd);
  }
  if (begin !== -1 || end !== -1) throw new Error('nginx.prod.conf has one portal marker but not the other');
  const m = ADD_HEADER_RE.exec(conf);
  if (!m) throw new Error('nginx.prod.conf: no `add_header Content-Security-Policy "frame-ancestors …` line to wrap');
  return conf.slice(0, m.index) + nginxBlock(reg, m[1]) + conf.slice(m.index + m[0].length);
}

/** The block currently in the conf, or undefined when the markers are absent. */
export function currentNginxBlock(conf: string): string | undefined {
  const begin = conf.indexOf(NGINX_BEGIN);
  const end = conf.indexOf(NGINX_END);
  if (begin === -1 || end === -1) return undefined;
  const lineStart = conf.lastIndexOf('\n', begin) + 1;
  const lineEnd = conf.indexOf('\n', end);
  return conf.slice(lineStart, lineEnd === -1 ? conf.length : lineEnd);
}

// ── frontend ─────────────────────────────────────────────────────────────────

export function generatedTs(reg: PortalRegistry): string {
  const rows = reg.portals.map((p) => {
    const origins = p.origins.map((o) => `      ${JSON.stringify(o).replace(/"/g, "'")},`).join('\n');
    return [
      '  {',
      `    id: ${JSON.stringify(p.id).replace(/"/g, "'")},`,
      `    name: ${JSON.stringify(p.name).replace(/"/g, "'")},`,
      '    origins: [',
      origins,
      '    ],',
      `    ownAuthUi: ${p.ownAuthUi ? 'true' : 'false'},`,
      '  },',
    ].join('\n');
  });
  return [
    '// GENERATED FILE — do not edit. Source of truth: docker/portals.json.',
    '// Regenerate: pnpm -C backend exec tsx scripts/syncPortals.ts',
    '// A backend test (portalRegistry.test.ts) fails when this file is stale.',
    '',
    '/** A game portal that may embed us, and what it lets us show inside its frame. */',
    'export interface Portal {',
    '  readonly id: string;',
    '  readonly name: string;',
    '  /** Absolute origins; a leading `*.` matches subdomains only. Same syntax as EMBED_ORIGINS. */',
    '  readonly origins: readonly string[];',
    '  /** False when the portal forbids a game showing its own login/registration UI. */',
    '  readonly ownAuthUi: boolean;',
    '}',
    '',
    'export const PORTALS: readonly Portal[] = [',
    ...rows,
    '];',
    '',
  ].join('\n');
}

// ── env example ──────────────────────────────────────────────────────────────

const ENV_LINE_RE = /^# EMBED_ORIGINS=.*$/m;

export function envExampleLine(reg: PortalRegistry): string {
  return `# EMBED_ORIGINS=${embedOriginsValue(reg)}`;
}

export function syncEnvExample(text: string, reg: PortalRegistry): string {
  if (!ENV_LINE_RE.test(text)) throw new Error('.env.production.example: no `# EMBED_ORIGINS=` sample line');
  return text.replace(ENV_LINE_RE, envExampleLine(reg));
}

// ── run ──────────────────────────────────────────────────────────────────────

export function run(): void {
  const reg = loadRegistry();
  writeFileSync(NGINX_CONF_PATH, syncNginxConf(readFileSync(NGINX_CONF_PATH, 'utf8'), reg));
  writeFileSync(GENERATED_TS_PATH, generatedTs(reg));
  writeFileSync(ENV_EXAMPLE_PATH, syncEnvExample(readFileSync(ENV_EXAMPLE_PATH, 'utf8'), reg));
  console.log(`[portals] ${reg.portals.length} portals, ${allOrigins(reg).length} origins`);
  console.log(`[portals] wrote ${NGINX_CONF_PATH}`);
  console.log(`[portals] wrote ${GENERATED_TS_PATH}`);
  console.log(`[portals] wrote ${ENV_EXAMPLE_PATH}`);
  console.log('');
  console.log('Set this on the backend (runtime env, no rebuild needed):');
  console.log(`EMBED_ORIGINS=${embedOriginsValue(reg)}`);
}

// Only write when invoked directly — the drift test imports the pure functions.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run();
}
