import { describe, it, expect } from 'vitest';
import {
  DEPENDENCY_REGISTRY,
  RENEWAL_WARNING_DAYS,
  buildDependencyReport,
  computeDependencyStatus,
  type DependencyItem,
} from './dependencyRegistry';

// Midnight UTC so day-count assertions are exact whole days.
const NOW = new Date('2026-06-19T00:00:00Z');

function item(overrides: Partial<DependencyItem>): DependencyItem {
  return {
    id: 'x',
    name: 'X',
    category: 'third_party',
    provider: 'Acme',
    purpose: 'test',
    requiresKey: false,
    severity: 'normal',
    ...overrides,
  };
}

describe('computeDependencyStatus', () => {
  it('flags a past date as expired with a negative day count', () => {
    const r = computeDependencyStatus(item({ renewalDate: '2026-06-09' }), NOW);
    expect(r.status).toBe('expired');
    expect(r.daysUntilRenewal).toBe(-10);
  });

  it('flags a date inside the warning window as due_soon', () => {
    const r = computeDependencyStatus(item({ renewalDate: '2026-07-01' }), NOW);
    expect(r.status).toBe('due_soon');
    expect(r.daysUntilRenewal).toBe(12);
  });

  it('treats the warning-window boundary as due_soon', () => {
    const due = new Date(NOW.getTime() + RENEWAL_WARNING_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(computeDependencyStatus(item({ renewalDate: due }), NOW).status).toBe('due_soon');
  });

  it('is ok well beyond the warning window', () => {
    const r = computeDependencyStatus(item({ renewalDate: '2026-12-31' }), NOW);
    expect(r.status).toBe('ok');
  });

  it('reports untracked when no date is set', () => {
    const r = computeDependencyStatus(item({ renewalDate: null }), NOW);
    expect(r).toEqual({ daysUntilRenewal: null, status: 'untracked' });
  });

  it('reports auto for auto-renewing items regardless of date', () => {
    expect(computeDependencyStatus(item({ autoRenews: true }), NOW).status).toBe('auto');
    expect(
      computeDependencyStatus(item({ autoRenews: true, renewalDate: '2026-06-09' }), NOW).status,
    ).toBe('auto');
  });
});

describe('buildDependencyReport', () => {
  it('summary counts match the computed item statuses', () => {
    const report = buildDependencyReport(NOW);
    expect(report.items.length).toBe(DEPENDENCY_REGISTRY.length);
    expect(report.summary.total).toBe(report.items.length);
    expect(report.summary.requires_key).toBe(report.items.filter((i) => i.requiresKey).length);
    expect(report.summary.expired).toBe(report.items.filter((i) => i.status === 'expired').length);
    expect(report.summary.due_soon).toBe(report.items.filter((i) => i.status === 'due_soon').length);
    expect(report.summary.untracked).toBe(report.items.filter((i) => i.status === 'untracked').length);
    expect(report.warning_window_days).toBe(RENEWAL_WARNING_DAYS);
  });
});

describe('DEPENDENCY_REGISTRY integrity', () => {
  it('has unique ids', () => {
    const ids = DEPENDENCY_REGISTRY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every item that requires a key names where the key lives', () => {
    for (const d of DEPENDENCY_REGISTRY) {
      if (d.requiresKey) expect(d.keyRef, `${d.id} requiresKey but has no keyRef`).toBeTruthy();
    }
  });
});
