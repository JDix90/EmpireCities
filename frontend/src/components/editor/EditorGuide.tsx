import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleDot, Lightbulb, X } from 'lucide-react';

export interface GuideStep {
  id: string;
  title: string;
  detail: string;
  done: boolean;
}

interface EditorGuideProps {
  steps: GuideStep[];
}

const DISMISSED_KEY = 'cc-map-editor-guide-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeDismissed(value: boolean): void {
  try {
    if (value) localStorage.setItem(DISMISSED_KEY, 'true');
    else localStorage.removeItem(DISMISSED_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The five things a map needs, ticked off as the author does them. It sits
 * over the globe's bottom-left corner, folds to a line, and once dismissed
 * stays away (a lightbulb brings it back). No modal, no step you must click
 * through: it reads the map and moves on its own.
 */
export default function EditorGuide({ steps }: EditorGuideProps) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [collapsed, setCollapsed] = useState(false);
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = steps.length > 0 && doneCount === steps.length;
  const next = steps.find((s) => !s.done);

  // Once everything is ticked, fold away without being asked.
  useEffect(() => {
    if (allDone) setCollapsed(true);
  }, [allDone]);

  if (dismissed) {
    return (
      <button
        type="button"
        onClick={() => {
          setDismissed(false);
          writeDismissed(false);
          setCollapsed(false);
        }}
        className="absolute bottom-4 left-4 z-10 w-9 h-9 rounded-full bg-bf-surface/90 backdrop-blur border border-bf-border text-bf-gold hover:bg-bf-border flex items-center justify-center"
        title="Show the guide"
        aria-label="Show the guide"
      >
        <Lightbulb className="w-4 h-4" aria-hidden />
      </button>
    );
  }

  return (
    <div className="absolute bottom-4 left-4 z-10 w-64 rounded-lg border border-bf-border bg-bf-surface/95 backdrop-blur shadow-xl text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-bf-text"
          aria-expanded={!collapsed}
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5 text-bf-muted shrink-0" aria-hidden />
            : <ChevronDown className="w-3.5 h-3.5 text-bf-muted shrink-0" aria-hidden />}
          <span className="font-medium text-xs uppercase tracking-wider text-bf-muted">Guide</span>
          <span className="ml-auto text-[11px] text-bf-muted">{doneCount}/{steps.length}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            writeDismissed(true);
          }}
          className="text-bf-muted hover:text-bf-text"
          title="Hide the guide"
          aria-label="Hide the guide"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>
      {!collapsed && (
        <ol className="px-3 pb-3 space-y-2">
          {steps.map((step) => (
            <li key={step.id} className="flex gap-2">
              {step.done
                ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" aria-hidden />
                : <CircleDot className={`w-4 h-4 shrink-0 mt-0.5 ${step === next ? 'text-bf-gold' : 'text-bf-border'}`} aria-hidden />}
              <div className="min-w-0">
                <p className={`text-xs ${step.done ? 'text-bf-muted line-through' : step === next ? 'text-bf-text' : 'text-bf-muted'}`}>
                  {step.title}
                </p>
                {step === next && <p className="text-[11px] text-bf-muted mt-0.5 leading-snug">{step.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {collapsed && next && (
        <p className="px-3 pb-2 text-[11px] text-bf-muted truncate">Next: {next.title}</p>
      )}
    </div>
  );
}
