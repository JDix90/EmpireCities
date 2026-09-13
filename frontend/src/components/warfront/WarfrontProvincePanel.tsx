import { Biome, Resource } from '@borderfall/warfront-sim';
import { biomeName, percent, type ProvinceStats } from '../../warfront/provinceStats';
import type { BuildingView, ProvinceHolding } from '../../warfront/economyView';

/**
 * The province panel: who holds this province, what stands in it, and what the terrain
 * under the cursor is made of.
 *
 * Rule III is "the seat is the province", so who holds it comes first and the claim timer
 * is impossible to miss — the brief wants that timer visible to everyone nearby, because
 * it is the window in which a counterattack is still possible. Rule IV is "terrain is the
 * rule set", so the terrain facts the build rules read from are here too, which also
 * makes the generated asset reviewable by eye.
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
  /** Who holds it, and any claim in progress. Null before the economy exists. */
  holding?: ProvinceHolding | null;
  /** Everything standing in this province, whoever owns it. */
  buildings?: readonly BuildingView[];
  /** The seat the viewing player is playing, for "yours" vs "theirs". */
  viewerOwner?: number;
  selectedBuildingId?: number | null;
  onSelectBuilding?: (id: number) => void;
  onJump?: (cell: number) => void;
}

const RESOURCE_LABEL: Record<number, string> = {
  [Resource.Food]: 'food',
  [Resource.Timber]: 'timber',
  [Resource.Silver]: 'silver',
};

/** Biomes worth a row, in the order they matter for the rules. */
const SHOWN_BIOMES = [Biome.Plains, Biome.Forest, Biome.Highland, Biome.Mountain, Biome.River, Biome.Desert];

export default function WarfrontProvincePanel({
  province,
  cell,
  unitsHere,
  holding = null,
  buildings = [],
  viewerOwner = 1,
  selectedBuildingId = null,
  onSelectBuilding,
  onJump,
}: WarfrontProvincePanelProps) {
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

      {holding ? (
        <div className="rounded border border-bf-border px-2 py-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-bf-muted">Held by</span>
            <span className={holding.owner === viewerOwner ? 'text-bf-gold' : 'text-bf-text'}>
              {holding.owner === 0 ? 'nobody' : holding.owner === viewerOwner ? 'you' : `seat ${holding.owner}`}
            </span>
          </div>
          {holding.owner === 0 ? (
            <div className="mt-1 text-bf-muted">
              {holding.everSettled
                ? 'Razed ground — claimed by standing here, never bought.'
                : 'Unsettled — a villager can plant a seat here.'}
            </div>
          ) : null}
          {holding.claimant !== 0 ? (
            <div className="mt-1">
              <div className="flex items-baseline justify-between">
                <span className={holding.claimant === viewerOwner ? 'text-bf-gold' : 'text-red-300'}>
                  {holding.claimant === viewerOwner ? 'You are claiming' : `Seat ${holding.claimant} is claiming`}
                </span>
                <span className="font-mono">{holding.claimPercent}%</span>
              </div>
              <div className="mt-1 h-1 w-full rounded bg-bf-border">
                <div
                  className={`h-1 rounded ${holding.claimant === viewerOwner ? 'bg-bf-gold' : 'bg-red-400'}`}
                  style={{ width: `${Math.min(100, holding.claimPercent)}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {buildings.length > 0 ? (
        <div>
          <div className="mb-1 font-semibold text-bf-text">Buildings</div>
          <ul className="space-y-0.5">
            {buildings.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onSelectBuilding?.(b.id)}
                  className={[
                    'flex w-full items-baseline justify-between rounded px-1 py-0.5 text-left',
                    selectedBuildingId === b.id ? 'bg-bf-gold/15 text-bf-gold' : 'hover:bg-bf-border/40',
                  ].join(' ')}
                >
                  <span className="capitalize">
                    {b.name}
                    {b.owner !== viewerOwner ? <span className="ml-1 text-red-300">·enemy</span> : null}
                  </span>
                  <span className="font-mono text-[10px] text-bf-muted">
                    {b.complete
                      ? b.slots > 0
                        ? `${b.workersPresent}/${b.slots}${b.yieldPerMinute > 0 ? ` · ${b.yieldPerMinute} ${RESOURCE_LABEL[b.produces] ?? ''}/min` : ''}`
                        : `${b.hp}/${b.maxHp} hp`
                      : `${b.progressPercent}%`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
