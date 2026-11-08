import React from 'react';
import { AlertTriangle, CheckCircle2, Lightbulb, ListChecks } from 'lucide-react';
import type { MapHealthCode, MapHealthIssue, MapHealthReport } from '@borderfall/shared';

export interface MapHealthFix {
  code: MapHealthCode;
  label: string;
  run: (issue: MapHealthIssue) => void;
}

interface MapHealthPanelProps {
  report: MapHealthReport;
  /** Issues publish reports that the live rules do not (geometry the editor cannot see). */
  serverOnly?: string[];
  /** Hovering a row points the globe at its territories; leaving clears. */
  onHoverIssue: (issue: MapHealthIssue | null) => void;
  /** Clicking a row selects and flies to the first territory it names. */
  onClickIssue: (issue: MapHealthIssue) => void;
  fixes: MapHealthFix[];
}

const GROUPS: Array<{
  key: 'blockers' | 'warnings' | 'tips';
  title: string;
  icon: React.ReactNode;
  tone: string;
}> = [
  { key: 'blockers', title: 'Must fix before publishing', icon: <AlertTriangle className="w-3.5 h-3.5" aria-hidden />, tone: 'text-red-300' },
  { key: 'warnings', title: 'Worth a look', icon: <AlertTriangle className="w-3.5 h-3.5" aria-hidden />, tone: 'text-amber-300' },
  { key: 'tips', title: 'Tips', icon: <Lightbulb className="w-3.5 h-3.5" aria-hidden />, tone: 'text-bf-muted' },
];

/**
 * The live checklist. Every rule publish enforces, plus advice, each row
 * pointing at the territories it is about and offering the fix when there
 * is a one-click one.
 */
export default function MapHealthPanel({ report, serverOnly = [], onHoverIssue, onClickIssue, fixes }: MapHealthPanelProps) {
  const fixFor = (issue: MapHealthIssue) => fixes.find((f) => f.code === issue.code);
  const pointable = (issue: MapHealthIssue) => (issue.territoryIds?.length ?? 0) > 0 || (issue.regionIds?.length ?? 0) > 0;

  return (
    <div className="p-4 border-t border-bf-border" data-testid="map-health">
      <div className="flex items-center gap-2 mb-3">
        <ListChecks className="w-3.5 h-3.5 text-bf-muted shrink-0" aria-hidden />
        <h3 className="text-xs font-medium text-bf-muted uppercase tracking-wider">Map health</h3>
        {report.ready ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-green-300">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
            <span>Ready to publish</span>
          </span>
        ) : (
          <span className="ml-auto text-[11px] text-red-300">
            {report.blockers.length} to fix
          </span>
        )}
      </div>

      {report.issues.length === 0 && serverOnly.length === 0 && (
        <p className="text-xs text-bf-muted">Nothing to report. Save it, then submit for review.</p>
      )}

      {GROUPS.map((group) => {
        const issues = report[group.key];
        if (issues.length === 0) return null;
        return (
          <div key={group.key} className="mb-3 last:mb-0">
            <div className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wider mb-1.5 ${group.tone}`}>
              {group.icon}
              <span>{group.title}</span>
            </div>
            <ul className="space-y-1.5">
              {issues.map((issue, i) => {
                const fix = fixFor(issue);
                const canPoint = pointable(issue);
                return (
                  <li
                    key={`${issue.code}-${i}`}
                    onMouseEnter={() => onHoverIssue(issue)}
                    onMouseLeave={() => onHoverIssue(null)}
                    className="rounded-md border border-bf-border/70 bg-bf-dark/60 px-2 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => onClickIssue(issue)}
                      className={`text-left text-xs leading-snug w-full ${canPoint ? 'text-bf-text hover:text-bf-gold' : 'text-bf-text cursor-default'}`}
                      title={canPoint ? 'Show on the globe' : undefined}
                    >
                      {issue.message}
                    </button>
                    {fix && (
                      <button
                        type="button"
                        onClick={() => fix.run(issue)}
                        className="mt-1.5 text-[11px] px-2 py-0.5 rounded border border-bf-gold/40 text-bf-gold hover:bg-bf-gold/10 transition-colors"
                      >
                        {fix.label}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {serverOnly.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider mb-1.5 text-red-300">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
            <span>Also reported on save</span>
          </div>
          <ul className="space-y-1.5 text-xs text-bf-text list-disc pl-4">
            {serverOnly.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
