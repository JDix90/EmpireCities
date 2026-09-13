import { Biome } from '@borderfall/warfront-sim';
import { biomeName, percent, type ProvinceStats } from '../../warfront/provinceStats';

/**
 * The province panel: what the terrain under the cursor is made of.
 *
 * Rule IV of the design is "terrain is the rule set" — high ground extends range, forests
 * slow cavalry, rivers cross at fords, mountains at passes. None of those rules exist
 * yet, so the panel shows the terrain facts they will read from, which is also what makes
 * the generated asset reviewable by eye.
 */

export interface HoverCellInfo {
  col: number;
  row: number;
  biome: string;
  tier: 0 | 1;
  passable: boolean;
  flags: string[];
}

export interface WarfrontProvincePanelProps {
  province: ProvinceStats | null;
  cell: HoverCellInfo | null;
  /** Selected units standing in this province. */
  unitsHere: number;
  onJump?: (cell: number) => void;
}

/** Biomes worth a row, in the order they matter for the rules. */
const SHOWN_BIOMES = [Biome.Plains, Biome.Forest, Biome.Highland, Biome.Mountain, Biome.River, Biome.Desert];

export default function WarfrontProvincePanel({ province, cell, unitsHere, onJump }: WarfrontProvincePanelProps) {
  if (!province) {
    return (
      <div className="w-64 shrink-0 border-l border-bf-border bg-cc-panel/40 p-3 text-[11px] text-bf-muted">
        Hover the map for province and terrain detail.
      </div>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l border-bf-border bg-cc-panel/40 p-3 text-[11px]">
      <div>
        <div className="text-sm font-semibold text-bf-text">{province.name}</div>
        <div className="font-mono text-[10px] text-bf-muted">{province.territoryId}</div>
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-bf-muted">
        <span>Cells</span>
        <span className="text-right text-bf-text">{province.cells.toLocaleString()}</span>
        <span>Walkable</span>
        <span className="text-right text-bf-text">{percent(province.passable, province.cells)}%</span>
        <span>High ground</span>
        <span className="text-right text-bf-text">{percent(province.highland, province.cells)}%</span>
      </div>

      <div>
        <div className="mb-1 font-semibold text-bf-text">Terrain</div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-bf-muted">
          {SHOWN_BIOMES.filter((b) => province.biomes[b] > 0).map((b) => (
            <span key={b} className="contents">
              <span>{biomeName(b)}</span>
              <span className="text-right text-bf-text">{percent(province.biomes[b], province.cells)}%</span>
            </span>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 font-semibold text-bf-text">Crossings</div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-bf-muted">
          <span>Fords</span>
          <span className="text-right text-bf-text">{province.fords}</span>
          <span>Pass cells</span>
          <span className="text-right text-bf-text">{province.passes}</span>
          <span>Beaches</span>
          <span className="text-right text-bf-text">{province.beaches}</span>
        </div>
      </div>

      <div>
        <div className="mb-1 font-semibold text-bf-text">Sea lanes</div>
        {province.lanes.length === 0 ? (
          <div className="text-bf-muted">Landlocked by lane — no sea link.</div>
        ) : (
          <ul className="space-y-0.5 font-mono text-[10px] text-bf-muted">
            {province.lanes.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </div>

      {unitsHere > 0 ? (
        <div className="rounded border border-bf-gold/40 bg-bf-gold/10 px-2 py-1 text-bf-gold">
          {unitsHere} selected unit{unitsHere === 1 ? '' : 's'} here
        </div>
      ) : null}

      {cell ? (
        <div className="border-t border-bf-border pt-2 text-bf-muted">
          <div className="mb-1 font-semibold text-bf-text">Cell under cursor</div>
          <div>
            {cell.col},{cell.row} · {cell.biome}
          </div>
          <div>
            tier {cell.tier} · {cell.passable ? 'passable' : 'blocked'}
          </div>
          {cell.flags.length > 0 ? <div className="text-bf-gold">{cell.flags.join(' · ')}</div> : null}
        </div>
      ) : null}

      {onJump && province.centerCell >= 0 ? (
        <button
          type="button"
          onClick={() => onJump(province.centerCell)}
          className="mt-auto rounded border border-bf-border px-2 py-1 text-bf-text hover:border-bf-gold hover:text-bf-gold"
        >
          Centre on {province.name}
        </button>
      ) : null}
    </aside>
  );
}
