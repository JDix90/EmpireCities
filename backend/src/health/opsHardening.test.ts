/**
 * Static guards for the operational settings that, when absent, took production
 * down for weeks.
 *
 * These assert on the repo's own ops files rather than on runtime behaviour —
 * the failure mode being defended against is "someone removes this line and
 * nobody notices for two months", which no unit test of application code would
 * catch. Requires no Docker and no databases.
 *
 * Incident summary: `deploy-production.sh` runs `up -d --build` on every
 * deploy, and nothing ever pruned the resulting dangling images or BuildKit
 * cache. Across ~12 deploys that reached 47GB of build cache plus 44GB of
 * images and filled a 116GB disk. A full disk makes Redis reject every write
 * (the API then 500s on every request, including /health) and stops sshd
 * accepting logins — so the box could not even be logged into to diagnose it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('deploy-production.sh', () => {
  const src = read('scripts/deploy-production.sh');

  it('reclaims unused images and build cache', () => {
    expect(src).toMatch(/docker image prune/);
    expect(src).toMatch(/docker builder prune/);
  });

  it('keeps recent images so a failed deploy can still roll back', () => {
    expect(src).toMatch(/--filter "until=/);
  });

  it('never prunes volumes — they hold the Postgres and Redis data', () => {
    expect(src).not.toMatch(/volume prune/);
    expect(src).not.toMatch(/prune[^\n]*--volumes/);
  });

  it('prunes only after the smoke test, so a broken deploy keeps its rollback image', () => {
    expect(src.indexOf('smoke-production.sh')).toBeLessThan(src.indexOf('docker image prune'));
  });
});

describe('backup-databases.sh', () => {
  const src = read('scripts/backup-databases.sh');

  it('refuses to run without free disk (0-byte dumps were written for weeks)', () => {
    expect(src).toMatch(/df -Pm/);
    expect(src).toMatch(/not enough free disk/i);
  });

  it('verifies the dump is non-empty and readable before publishing it', () => {
    expect(src).toMatch(/pg_restore -l/);
    expect(src).toMatch(/\[ ! -s "\$PARTIAL" \]/);
  });

  it('writes to a .part file so a truncated dump never takes a valid name', () => {
    expect(src).toMatch(/\.part/);
    expect(src).toMatch(/mv "\$PARTIAL" "\$TARGET"/);
  });

  it('prunes only after a verified dump exists', () => {
    expect(src.indexOf('mv "$PARTIAL" "$TARGET"')).toBeLessThan(src.indexOf('-delete'));
  });
});

describe('docker-compose.prod.yml', () => {
  const src = read('docker/docker-compose.prod.yml');

  it('bounds container log size on every service', () => {
    // Docker's default json-file driver has no size cap at all.
    const services = (src.match(/^ {4}container_name: borderfall_\w+\n/gm) ?? []).length;
    const logging = (src.match(/^ {4}logging:\n/gm) ?? []).length;
    expect(services).toBeGreaterThan(0);
    expect(logging).toBe(services);
    expect(src).toMatch(/max-size:/);
    expect(src).toMatch(/max-file:/);
  });

  it('exposes a Redis memory cap without silently imposing one', () => {
    // Opt-in on purpose: with noeviction, a cap set too low turns into a hard
    // outage, so the value has to be a deliberate, host-sized choice.
    expect(src).toMatch(/--maxmemory \$\{REDIS_MAXMEMORY:-0\}/);
    expect(src).toMatch(/--maxmemory-policy noeviction/);
  });
});
