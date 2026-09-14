import { Biome, Resource, type BiomeValue } from '@borderfall/warfront-sim';
import { biomeName, percent, type ProvinceStats } from '../../warfront/provinceStats';
import { BIOME_COLORS, type Rgb } from '../../warfront/terrainImage';
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
 *
 * The terrain composition is drawn as a bar in the MAP'S OWN COLOURS rather than listed as
 * percentages. Six numbers in a column are six numbers; a bar is a shape, and one painted
 * out of `BIOME_COLORS` is the same shape the player is looking at on the plane — so the
 * panel and the map teach each other instead of having to be read separately.
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
const SHOWN_BIOMES: readonly BiomeValue[] = [
  Biome.Plains,
  Biome.Forest,
  Biome.Highland,
  Biome.Mountain,
  Biome.River,
  Biome.Desert,
];

function css(rgb: Rgb): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-wider text-bf-muted">{title}</div>
      {children}
    </div>
  );
}

/** A number that is worth finding without reading its neighbours. */
function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-bf-border/60 bg-bf-dark/40 px-1.5 py-1">
      <div className="text-[9px] uppercase tracking-wide text-bf-muted">{label}</div>
      <div className={`font-mono text-[12px] ${tone ?? 'text-bf-text'}`}>{value}</div>
    </div>
  );
}

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

  const present = SHOWN_BIOMES.filter((b) => province.biomes[b] > 0);
  const woodedShare = percent(province.wooded, province.cells);

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l border-bf-border bg-cc-panel/40 p-3 text-[11px]">
      <div>
        <div className="text-sm font-semibold leading-tight text-bf-text">{province.name}</div>
        <div className="font-mono text-[10px] text-bf-muted">{province.territoryId}</div>
      </div>

      {holding ? (
        <div className="rounded border border-bf-border px-2 py-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[9px] uppercase tracking-wider text-bf-muted">Held by</span>
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
        <Section title="Buildings">
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
        </Section>
      ) : null}

      <div className="grid grid-cols-3 gap-1">
        <Figure label="Cells" value={province.cells.toLocaleString()} />
        <Figure label="Walkable" value={`${percent(province.passable, province.cells)}%`} />
        <Figure label="High" value={`${percent(province.highland, province.cells)}%`} />
      </div>

      <Section title="Terrain">
        <div className="flex h-2.5 w-full overflow-hidden rounded-sm border border-bf-border/60">
          {present.map((b) => (
            <div
              key={b}
              title={`${biomeName(b)} ${percent(province.biomes[b], province.cells)}%`}
              style={{ width: `${percent(province.biomes[b], province.cells)}%`, backgroundColor: css(BIOME_COLORS[b]) }}
            />
          ))}
        </div>
        <ul className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
          {present.map((b) => (
            <li key={b} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: css(BIOME_COLORS[b]) }}
                aria-hidden
              />
              <span className="text-bf-muted">{biomeName(b)}</span>
              <span className="ml-auto font-mono text-[10px] text-bf-text">
                {percent(province.biomes[b], province.cells)}%
              </span>
            </li>
          ))}
        </ul>
        {/*
          Its own line, below the bar, because woodland is not one of the biomes and cannot
          be a slice of them. A wooded hill counts as highland above and is still the only
          ground a lumber camp can stand on — so a panel showing biomes alone would tell a
          player there is no timber in a province full of it.
        */}
        {province.wooded > 0 ? (
          <div className="mt-1.5 flex items-center gap-1.5 border-t border-bf-border/50 pt-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: css(BIOME_COLORS[Biome.Forest]) }}
              aria-hidden
            />
            <span className="text-bf-muted">wooded</span>
            <span className="ml-auto font-mono text-[10px] text-bf-text">{woodedShare}%</span>
          </div>
        ) : null}
      </Section>

      <Section title="Crossings">
        <div className="grid grid-cols-3 gap-1">
          <Figure label="Fords" value={String(province.fords)} />
          <Figure label="Passes" value={String(province.passes)} />
          <Figure label="Beaches" value={String(province.beaches)} />
        </div>
      </Section>

      <Section title="Sea lanes">
        {province.lanes.length === 0 ? (
          <div className="text-bf-muted">Landlocked by lane — no sea link.</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {province.lanes.map((l) => (
              <span key={l} className="rounded border border-bf-border/70 bg-bf-dark/40 px-1.5 py-0.5 font-mono text-[10px] text-bf-muted">
                {l}
              </span>
            ))}
          </div>
        )}
      </Section>

      {unitsHere > 0 ? (
        <div className="rounded border border-bf-gold/40 bg-bf-gold/10 px-2 py-1 text-bf-gold">
          {unitsHere} selected unit{unitsHere === 1 ? '' : 's'} here
        </div>
      ) : null}

      {cell ? (
        <div className="border-t border-bf-border pt-2">
          <div className="mb-1 text-[9px] uppercase tracking-wider text-bf-muted">Cell under cursor</div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[11px] text-bf-text">
              {cell.col},{cell.row}
            </span>
            <span className="text-bf-muted">
              {cell.biome} · tier {cell.tier}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                cell.passable ? 'bg-bf-border/50 text-bf-text' : 'bg-red-500/15 text-red-300'
              }`}
            >
              {cell.passable ? 'passable' : 'blocked'}
            </span>
            {cell.flags.map((flag) => (
              <span key={flag} className="rounded bg-bf-gold/15 px-1.5 py-0.5 text-[10px] text-bf-gold">
                {flag}
              </span>
            ))}
          </div>
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
