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

  it('caps the build cache by size too, with whichever flag this Docker has', () => {
    expect(src).toMatch(/PRUNE_CACHE_MAX="\$\{PRUNE_CACHE_MAX:-10GB\}"/);
    expect(src).toMatch(/--max-used-space/);
    expect(src).toMatch(/--keep-storage/);
    // Capped after the smoke test, like the age-based prune.
    expect(src.indexOf('smoke-production.sh')).toBeLessThan(src.indexOf('PRUNE_CACHE_MAX='));
  });

  it('says when the newest backup is stale (the nightly job once failed silently for 25 days)', () => {
    expect(src).toMatch(/newest backup is \$\{BACKUP_AGE_HOURS\}h old/);
    expect(src).toMatch(/-ge 48/);
    expect(src).toMatch(/no database backup in/);
  });
});

describe('Dockerfile.backend', () => {
  const src = read('docker/Dockerfile.backend');

  it('installs dependencies before copying database/, so a map change does not reinstall them', () => {
    // Above the install, every map or migration change invalidated the
    // dependency layer: ~0.9GB of image and build cache left behind per deploy.
    const install = src.indexOf('pnpm install');
    expect(install).toBeGreaterThan(-1);
    expect(src.indexOf('COPY database')).toBeGreaterThan(install);
    // Still before the build, which compiles against it.
    expect(src.indexOf('COPY database')).toBeLessThan(src.indexOf('pnpm run build'));
  });
});

describe('trim-game-snapshots.sh', () => {
  const src = read('scripts/trim-game-snapshots.sh');

  it('is a dry run unless --apply is given', () => {
    expect(src).toMatch(/^APPLY=false$/m);
    expect(src).toMatch(/Dry run: nothing was deleted/);
  });

  it('refuses to delete without a recent backup', () => {
    expect(src.indexOf('BACKUP_MAX_AGE_HOURS')).toBeLessThan(src.indexOf('delete_batches "expired"'));
    expect(src).toMatch(/ABORTED: no backup in/);
  });

  it('deletes only game_states rows, in bounded batches', () => {
    const deletes = src.match(/DELETE FROM \w+/g) ?? [];
    expect(deletes.length).toBeGreaterThan(0);
    expect(new Set(deletes)).toEqual(new Set(['DELETE FROM game_states']));
    expect(src).toMatch(/LIMIT \$\{BATCH\}/);
  });

  it('checks free disk before VACUUM FULL takes its lock', () => {
    expect(src.indexOf('df -Pm')).toBeLessThan(src.indexOf('VACUUM (FULL'));
    expect(src).toMatch(/not enough free disk for the rewrite/);
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

  it('prunes by count, not age — N days of ~29GB dumps filled the disk twice', () => {
    expect(src).toMatch(/RETENTION_COUNT/);
    expect(src).not.toMatch(/RETENTION_DAYS/);
    expect(src).not.toMatch(/-mtime/);
  });

  it('prunes only after the new dump is verified and published', () => {
    // The old dump must outlive its replacement's verification: publish (mv)
    // strictly precedes the prune loop.
    expect(src.indexOf('mv "$PARTIAL" "$TARGET"')).toBeLessThan(src.indexOf('RETENTION_COUNT='));
  });

  it('never prunes the newest dump, so a backup always survives', () => {
    // `ls -1t` newest-first, then delete only from RETENTION_COUNT+1 onward.
    expect(src).toMatch(/ls -1t .*postgres_\*\.dump.*\| tail -n \+\$\(\(RETENTION_COUNT \+ 1\)\)/);
  });
});

describe('setup-backup-cron.sh', () => {
  const src = read('scripts/setup-backup-cron.sh');

  it('schedules the backup at CRON_HOUR:00, not CRON_HOUR minutes past midnight', () => {
    // Cron reads the minute first. Written hour-first, the "3:00" job ran at 00:03.
    expect(src).toMatch(/CRON_LINE="0 \$\{CRON_HOUR\} \* \* \* /);
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
