import React, { useMemo, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { AlertTriangle, ChevronDown, ChevronRight, Lightbulb, Scale, Swords } from 'lucide-react';
import { analyzeMapStructure, type StructureNote } from '@borderfall/shared';
import { api } from '../../services/api';
import { trackUiEvent } from '../../utils/uiEvents';
import type { EditorConnection, EditorRegion, EditorTerritory } from './editorGlobeData';

/** What the server's simulation returns (backend/src/modules/maps/mapBalanceSim.ts). */
export interface BalanceSimReport {
  gamesPlayed: number;
  gamesRequested: number;
  seats: number;
  maxRounds: number;
  difficulty: 'easy' | 'medium' | 'hard';
  era: string;
  seatWins: number[];
  firstMoverWins: number;
  unfinished: number;
  rounds: { mean: number; min: number; max: number };
  endings: Record<string, number>;
  regions: Array<{ region_id: string; name: string; heldShare: number; gamesHeld: number }>;
  neverCaptured: Array<{ territory_id: string; name: string }>;
  firstEliminationRound: number | null;
  durationMs: number;
}

interface BalancePanelProps {
  mapId: string | null;
  isDirty: boolean;
  /** Map health has no blockers: the engine can deal the map. */
  ready: boolean;
  territories: EditorTerritory[];
  connections: EditorConnection[];
  regions: EditorRegion[];
  onHoverTerritories: (ids: string[] | null) => void;
  onFocusTerritory: (id: string) => void;
}

const ENDING_LABELS: Record<string, string> = {
  domination: 'conquest',
  threshold: 'board share',
  round_cap: 'round cap',
  last_standing: 'last standing',
  capital: 'capitals',
  secret_mission: 'secret mission',
  other: 'other',
};

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '–');

/**
 * How the map plays: what its shape says at once (chokepoints, ways into
 * each region, rich bonuses), and what bots find when they play it.
 */
export default function BalancePanel({
  mapId,
  isDirty,
  ready,
  territories,
  connections,
  regions,
  onHoverTerritories,
  onFocusTerritory,
}: BalancePanelProps) {
  const [open, setOpen] = useState(true);
  const [seats, setSeats] = useState(4);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ report: BalanceSimReport; cached: boolean } | null>(null);

  const structure = useMemo(
    () => analyzeMapStructure({
      territories: territories.map((t) => ({ territory_id: t.territory_id, name: t.name, region_id: t.region_id })),
      connections,
      regions,
    }),
    [territories, connections, regions],
  );

  const nameOf = (id: string) => territories.find((t) => t.territory_id === id)?.name ?? id;
  const idsOfNote = (note: StructureNote): string[] => {
    if (note.territoryIds?.length) return note.territoryIds;
    if (note.regionIds?.length) {
      const set = new Set(note.regionIds);
      return territories.filter((t) => set.has(t.region_id)).map((t) => t.territory_id);
    }
    return [];
  };

  const blocked = !mapId
    ? 'Save the map first'
    : isDirty
      ? 'Save your changes first'
      : !ready
        ? 'Fix the Map health blockers first'
        : null;

  const run = async () => {
    if (!mapId || blocked || running) return;
    setRunning(true);
    try {
      const res = await api.post<{ report: BalanceSimReport; cached: boolean }>(`/maps/${mapId}/balance`, {
        seats,
        difficulty,
      });
      setResult(res.data);
      trackUiEvent('editor_balance_run', { map_id: mapId, seats, games: res.data.report.gamesPlayed });
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) toast.error(err.response?.data?.error || 'The simulation failed');
      else toast.error('The simulation failed');
    } finally {
      setRunning(false);
    }
  };

  const report = result?.report ?? null;
  const decided = report ? report.gamesPlayed - report.unfinished : 0;

  return (
    <div className="p-4 border-t border-bf-border" data-testid="balance-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-bf-muted" aria-hidden /> : <ChevronRight className="w-3.5 h-3.5 text-bf-muted" aria-hidden />}
        <Scale className="w-3.5 h-3.5 text-bf-muted shrink-0" aria-hidden />
        <h3 className="text-xs font-medium text-bf-muted uppercase tracking-wider">Balance</h3>
        {structure.chokepoints.length > 0 && (
          <span className="ml-auto text-[11px] text-bf-muted">{structure.chokepoints.length} chokepoint{structure.chokepoints.length === 1 ? '' : 's'}</span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {territories.length < 2 ? (
            <p className="text-xs text-bf-muted">Add a few territories and regions to see how the map plays.</p>
          ) : (
            <>
              {/* Regions */}
              {structure.regions.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-bf-muted mb-1.5">Regions</p>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-bf-muted">
                        <th className="text-left font-normal pb-1">Region</th>
                        <th className="text-right font-normal pb-1" title="Territories">Size</th>
                        <th className="text-right font-normal pb-1" title="Connections crossing into the region">Ways in</th>
                        <th className="text-right font-normal pb-1" title="Bonus, with the rule of thumb in brackets">Bonus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {structure.regions.map((r) => {
                        const rich = r.size >= 2 && r.payoutPerTerritory > 1;
                        const exposed = r.size >= 2 && r.entrances > r.size;
                        return (
                          <tr
                            key={r.region_id}
                            onMouseEnter={() => onHoverTerritories(territories.filter((t) => t.region_id === r.region_id).map((t) => t.territory_id))}
                            onMouseLeave={() => onHoverTerritories(null)}
                            className="text-bf-text"
                          >
                            <td className="py-0.5 truncate max-w-[90px]" title={r.name}>{r.name}</td>
                            <td className="py-0.5 text-right">{r.size}</td>
                            <td className={`py-0.5 text-right ${exposed ? 'text-amber-300' : ''}`}>{r.entrances}</td>
                            <td className={`py-0.5 text-right ${rich ? 'text-amber-300' : ''}`}>
                              {r.bonus}
                              {r.suggestedBonus > 0 && r.suggestedBonus !== r.bonus && (
                                <span className="text-bf-muted"> ({r.suggestedBonus})</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Shape */}
              <div className="text-[11px] text-bf-muted space-y-1">
                <p>
                  <span className="text-bf-text">{structure.degree.mean.toFixed(1)}</span> connections per territory
                  {structure.diameter !== null && (
                    <>
                      {' · '}
                      <span className="text-bf-text">{structure.diameter}</span> steps corner to corner
                    </>
                  )}
                </p>
                {structure.chokepoints.length > 0 && (
                  <p className="leading-snug">
                    Chokepoints:{' '}
                    {structure.chokepoints.map((id, i) => (
                      <React.Fragment key={id}>
                        {i > 0 ? ', ' : ''}
                        <button
                          type="button"
                          onClick={() => onFocusTerritory(id)}
                          onMouseEnter={() => onHoverTerritories([id])}
                          onMouseLeave={() => onHoverTerritories(null)}
                          className="text-bf-text hover:text-bf-gold"
                        >
                          {nameOf(id)}
                        </button>
                      </React.Fragment>
                    ))}
                  </p>
                )}
              </div>

              {/* Notes */}
              {structure.notes.length > 0 && (
                <ul className="space-y-1.5">
                  {structure.notes.map((note, i) => (
                    <li
                      key={`${note.code}-${i}`}
                      onMouseEnter={() => onHoverTerritories(idsOfNote(note))}
                      onMouseLeave={() => onHoverTerritories(null)}
                      className={`flex items-start gap-2 text-xs rounded-md border px-2 py-1.5 ${
                        note.severity === 'warning' ? 'border-amber-500/30 text-amber-100/90' : 'border-bf-border/70 text-bf-text'
                      }`}
                    >
                      {note.severity === 'warning'
                        ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-300" aria-hidden />
                        : <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0 text-bf-muted" aria-hidden />}
                      <span className="leading-snug">{note.message}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Simulation */}
              <div className="rounded-md border border-bf-border bg-bf-dark/60 p-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <Swords className="w-3.5 h-3.5 text-bf-gold shrink-0" aria-hidden />
                  <p className="text-xs text-bf-text">Let bots play it</p>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <label className="text-[11px] text-bf-muted" htmlFor="balance-seats">Seats</label>
                  <select id="balance-seats" className="input text-xs py-0.5 w-16" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
                    {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <label className="text-[11px] text-bf-muted" htmlFor="balance-difficulty">Bots</label>
                  <select id="balance-difficulty" className="input text-xs py-0.5 flex-1" value={difficulty} onChange={(e) => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => void run()}
                  disabled={!!blocked || running}
                  title={blocked ?? 'Eight short games, a few seconds'}
                  className="btn-secondary w-full text-xs py-1.5 disabled:opacity-50"
                >
                  {running ? 'Playing…' : report ? 'Run again' : 'Simulate'}
                </button>
                {blocked && <p className="text-[11px] text-bf-muted mt-1">{blocked}</p>}

                {report && (
                  <div className="mt-3 space-y-3 text-[11px]" data-testid="balance-report">
                    <p className="text-bf-muted">
                      {report.gamesPlayed} game{report.gamesPlayed === 1 ? '' : 's'}, {report.seats} {report.difficulty} bots, {report.rounds.mean.toFixed(0)} rounds on average
                      {report.unfinished > 0 ? `, ${report.unfinished} hit the round cap` : ''}
                      {result?.cached ? ' (from an earlier run)' : ''}
                    </p>

                    <div>
                      <p className="text-bf-muted mb-1">Wins by seat <span className="text-bf-muted/70">— the first move rotates, so a tall bar is the deal</span></p>
                      <div className="space-y-1">
                        {report.seatWins.map((wins, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="w-12 text-bf-muted">Seat {i + 1}</span>
                            <div className="flex-1 h-2 bg-bf-border rounded-full overflow-hidden">
                              <div className="h-full bg-bf-gold rounded-full" style={{ width: decided > 0 ? `${(wins / decided) * 100}%` : '0%' }} />
                            </div>
                            <span className="w-8 text-right text-bf-text">{pct(wins, decided)}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-bf-muted mt-1">First mover won {pct(report.firstMoverWins, decided)} (a fair share is {pct(1, report.seats)})</p>
                    </div>

                    <div>
                      <p className="text-bf-muted mb-1">Endings</p>
                      <p className="text-bf-text">
                        {Object.entries(report.endings).map(([k, n]) => `${n} by ${ENDING_LABELS[k] ?? k}`).join(', ')}
                        {report.firstEliminationRound !== null ? ` · first elimination around round ${report.firstEliminationRound.toFixed(0)}` : ''}
                      </p>
                    </div>

                    {report.regions.length > 0 && (
                      <div>
                        <p className="text-bf-muted mb-1">Regions held whole</p>
                        <ul className="space-y-0.5">
                          {report.regions.map((r) => (
                            <li key={r.region_id} className="flex items-center justify-between gap-2">
                              <span className="truncate text-bf-text">{r.name}</span>
                              <span className={r.gamesHeld === 0 ? 'text-amber-300' : 'text-bf-muted'}>
                                {r.gamesHeld === 0 ? 'never paid' : `${pct(r.heldShare, 1)} of the time · ${r.gamesHeld}/${report.gamesPlayed} games`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {report.neverCaptured.length > 0 && (
                      <div>
                        <p className="text-bf-muted mb-1">Never changed hands</p>
                        <p className="leading-snug">
                          {report.neverCaptured.slice(0, 8).map((t, i) => (
                            <React.Fragment key={t.territory_id}>
                              {i > 0 ? ', ' : ''}
                              <button
                                type="button"
                                onClick={() => onFocusTerritory(t.territory_id)}
                                onMouseEnter={() => onHoverTerritories([t.territory_id])}
                                onMouseLeave={() => onHoverTerritories(null)}
                                className="text-bf-text hover:text-bf-gold"
                              >
                                {t.name}
                              </button>
                            </React.Fragment>
                          ))}
                          {report.neverCaptured.length > 8 ? ` and ${report.neverCaptured.length - 8} more` : ''}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
