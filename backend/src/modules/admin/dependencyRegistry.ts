/**
 * Operational dependency registry — the external services, infrastructure, and
 * credentials Borderfall relies on, surfaced read-only in the Admin → Dependencies
 * tab so an operator can see at a glance what needs keys and what needs renewing.
 *
 * MAINTENANCE: this is a hand-curated list. When a dependency is added/removed or a
 * renewal date changes, update it here and ship it in a PR. Set `renewalDate` to the
 * real next expiry/renewal (ISO `YYYY-MM-DD`) — entries left `null` render as
 * "not tracked" in the UI so they're easy to spot and fill in. Keep `keyRef` pointing
 * at the actual env var / secret location so on-call knows where the credential lives.
 */

export type DependencyCategory =
  | 'domain'
  | 'infrastructure'
  | 'datastore'
  | 'secret'
  | 'third_party'
  | 'email';

export type DependencySeverity = 'critical' | 'high' | 'normal';

export interface DependencyItem {
  /** Stable slug. */
  id: string;
  name: string;
  category: DependencyCategory;
  /** Vendor / where it's managed (e.g. "DigitalOcean", "Let's Encrypt"). */
  provider: string;
  /** What it's for and what breaks without it. */
  purpose: string;
  /** Whether operating it requires a secret/key/credential. */
  requiresKey: boolean;
  /** Env var(s) or secret location, if any. */
  keyRef?: string;
  /** Next renewal/expiry as ISO `YYYY-MM-DD`, or null when not time-bound / not tracked. */
  renewalDate?: string | null;
  /** Human cadence label, e.g. "Annual", "Monthly", "~90 days". */
  cadence?: string;
  /** Outage blast radius if it lapses. */
  severity: DependencySeverity;
  /** True when renewal is automated (e.g. ACME cert) — surfaced so it isn't false-alarmed. */
  autoRenews?: boolean;
  /** Operator notes. */
  notes?: string;
  /** Dashboard / portal URL. */
  url?: string;
}

/** Days before a renewalDate at which the UI flags an item as "due soon". */
export const RENEWAL_WARNING_DAYS = 30;

/**
 * The registry. Renewal dates that only the operator knows (domain, host billing)
 * are intentionally left `null` until filled in — better an honest "not tracked"
 * than an invented date.
 */
export const DEPENDENCY_REGISTRY: readonly DependencyItem[] = [
  {
    id: 'domain-borderfall-gg',
    name: 'borderfall.gg',
    category: 'domain',
    provider: 'Domain registrar',
    purpose: 'Primary domain. If it lapses, the site and all email go dark.',
    requiresKey: false,
    renewalDate: null,
    cadence: 'Annual',
    severity: 'critical',
    notes: 'Set the real registrar expiry date here. Enable auto-renew at the registrar as a backstop.',
  },
  {
    id: 'host-digitalocean-droplet',
    name: 'DigitalOcean Droplet (SFO3)',
    category: 'infrastructure',
    provider: 'DigitalOcean',
    purpose: 'Production app host — runs the Docker Compose stack (backend, frontend, Caddy).',
    requiresKey: false,
    renewalDate: null,
    cadence: 'Monthly billing',
    severity: 'critical',
    notes: 'Billed monthly; no hard expiry, but a failed payment suspends the droplet. Keep a valid card on file.',
    url: 'https://cloud.digitalocean.com',
  },
  {
    id: 'tls-letsencrypt-caddy',
    name: 'TLS certificate (Let’s Encrypt)',
    category: 'infrastructure',
    provider: 'Let’s Encrypt via Caddy',
    purpose: 'HTTPS for the production domain. Issued and renewed automatically by Caddy.',
    requiresKey: false,
    renewalDate: null,
    cadence: '~90 days (auto)',
    severity: 'high',
    autoRenews: true,
    notes: 'Caddy auto-renews. Monitor Caddy logs; alert only if renewal is failing.',
  },
  {
    id: 'datastore-postgres',
    name: 'PostgreSQL',
    category: 'datastore',
    provider: 'Self-hosted (Docker)',
    purpose: 'Durable store — users, games, snapshots, maps (JSONB), achievements.',
    requiresKey: true,
    keyRef: 'POSTGRES_PASSWORD',
    renewalDate: null,
    severity: 'critical',
    notes: 'Back up before every deploy (scripts/backup-databases.sh). Rotate the password periodically.',
  },
  {
    id: 'datastore-redis',
    name: 'Redis',
    category: 'datastore',
    provider: 'Self-hosted (Docker)',
    purpose: 'Authoritative live game state, per-game locks, BullMQ queues, sessions, leaderboards.',
    requiresKey: true,
    keyRef: 'REDIS_PASSWORD',
    renewalDate: null,
    severity: 'critical',
    notes: 'Losing Redis drops in-flight games. Ensure AOF persistence is on (see SCALE-OUT-RUNBOOK).',
  },
  {
    id: 'secret-jwt',
    name: 'JWT signing secrets',
    category: 'secret',
    provider: 'Self-managed',
    purpose: 'Sign access & refresh tokens. Rotating these invalidates all active sessions.',
    requiresKey: true,
    keyRef: 'JWT_ACCESS_SECRET, JWT_REFRESH_SECRET',
    renewalDate: null,
    cadence: 'Rotate on suspected compromise',
    severity: 'critical',
    notes: 'Must be strong, non-default values — the backend refuses to boot on placeholder secrets.',
  },
  {
    id: 'secret-github-deploy-key',
    name: 'GitHub deploy key',
    category: 'secret',
    provider: 'GitHub',
    purpose: 'Read-only SSH key on the host so it can pull the private repo (JDix90/EmpireCities).',
    requiresKey: true,
    keyRef: '~/.ssh/borderfall_deploy (host)',
    renewalDate: null,
    severity: 'high',
    notes: 'Read-only, single-repo. Rotate if the host is ever compromised. See docs/RUNBOOK.md.',
  },
  {
    id: 'thirdparty-sentry',
    name: 'Sentry (error monitoring)',
    category: 'third_party',
    provider: 'Sentry',
    purpose: 'Backend + frontend error/exception reporting (@sentry/node, @sentry/react).',
    requiresKey: true,
    keyRef: 'SENTRY_DSN',
    renewalDate: null,
    severity: 'normal',
    notes: 'Watch monthly event quota; a noisy release can exhaust the free tier.',
    url: 'https://sentry.io',
  },
  {
    id: 'thirdparty-firebase-fcm',
    name: 'Firebase Cloud Messaging',
    category: 'third_party',
    provider: 'Google Firebase',
    purpose: 'Push notifications (firebase-admin). Requires a service-account JSON key.',
    requiresKey: true,
    keyRef: 'FCM_SERVICE_ACCOUNT_PATH',
    renewalDate: null,
    severity: 'normal',
    notes: 'Service-account keys do not expire by default but should be rotated; keep the JSON off the repo.',
    url: 'https://console.firebase.google.com',
  },
  {
    id: 'email-smtp',
    name: 'Transactional email (SMTP)',
    category: 'email',
    provider: 'SMTP provider',
    purpose: 'Outbound email via nodemailer — verification, password reset, support.',
    requiresKey: true,
    keyRef: 'SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM',
    renewalDate: null,
    severity: 'high',
    notes: 'Verify domain SPF/DKIM so mail isn’t spam-filtered. Some providers expire unused API credentials.',
  },
];

export type DependencyStatus = 'expired' | 'due_soon' | 'ok' | 'auto' | 'untracked';

export interface DependencyView extends DependencyItem {
  /** Whole days until `renewalDate` (negative = overdue), or null when not tracked. */
  daysUntilRenewal: number | null;
  status: DependencyStatus;
}

export interface DependencyReport {
  generated_at: string;
  warning_window_days: number;
  items: DependencyView[];
  summary: {
    total: number;
    requires_key: number;
    expired: number;
    due_soon: number;
    untracked: number;
  };
}

/** Pure status derivation for one item against a reference time. Exported for tests. */
export function computeDependencyStatus(
  item: DependencyItem,
  now: Date,
): { daysUntilRenewal: number | null; status: DependencyStatus } {
  if (!item.renewalDate) {
    return { daysUntilRenewal: null, status: item.autoRenews ? 'auto' : 'untracked' };
  }
  const due = new Date(`${item.renewalDate}T00:00:00Z`);
  const daysUntilRenewal = Math.floor((due.getTime() - now.getTime()) / 86_400_000);
  if (item.autoRenews) return { daysUntilRenewal, status: 'auto' };
  if (daysUntilRenewal < 0) return { daysUntilRenewal, status: 'expired' };
  if (daysUntilRenewal <= RENEWAL_WARNING_DAYS) return { daysUntilRenewal, status: 'due_soon' };
  return { daysUntilRenewal, status: 'ok' };
}

/** Build the full read-only report (registry + computed status + summary). */
export function buildDependencyReport(now: Date = new Date()): DependencyReport {
  const items: DependencyView[] = DEPENDENCY_REGISTRY.map((item) => ({
    ...item,
    ...computeDependencyStatus(item, now),
  }));
  return {
    generated_at: now.toISOString(),
    warning_window_days: RENEWAL_WARNING_DAYS,
    items,
    summary: {
      total: items.length,
      requires_key: items.filter((i) => i.requiresKey).length,
      expired: items.filter((i) => i.status === 'expired').length,
      due_soon: items.filter((i) => i.status === 'due_soon').length,
      untracked: items.filter((i) => i.status === 'untracked').length,
    },
  };
}
