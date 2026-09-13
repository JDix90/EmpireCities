import type { BuildingKindValue, UnitKindValue } from '@borderfall/warfront-sim';
import type { BuildOption, BuildingView, ColoniseView, TrainOption } from '../../warfront/economyView';

/**
 * The actions available to whatever is selected.
 *
 * Rule II is "villagers are assigned, never clicked", so there is no "gather" order here
 * and never will be: a villager is put on a building and stays there. What a villager CAN
 * do is raise a new building or plant a seat, and what a building can do is train — so
 * those are the two faces of this bar, plus the colonise action that is rule I.
 *
 * Every disabled control says why it is disabled. A greyed button with no reason is how a
 * player decides a rule is broken rather than that they cannot afford it.
 */

export interface WarfrontCommandBarProps {
  /** Villagers in the current selection — the ones that can build. */
  villagerCount: number;
  buildOptions: BuildOption[];
  /** Kind currently awaiting a placement click, or null. */
  placingKind: BuildingKindValue | null;
  onPickBuild: (kind: BuildingKindValue | null) => void;
  colonise: ColoniseView | null;
  onColonise: () => void;
  building: BuildingView | null;
  trainOptions: TrainOption[];
  onTrain: (kind: UnitKindValue) => void;
  onAssignSelected: () => void;
}

export default function WarfrontCommandBar({
  villagerCount,
  buildOptions,
  placingKind,
  onPickBuild,
  colonise,
  onColonise,
  building,
  trainOptions,
  onTrain,
  onAssignSelected,
}: WarfrontCommandBarProps) {
  const hasAnything = villagerCount > 0 || building !== null;
  if (!hasAnything) {
    return (
      <div className="border-t border-bf-border bg-cc-panel/40 px-4 py-2 text-[11px] text-bf-muted">
        Select villagers to build or colonise, or click one of your buildings to train and assign.
      </div>
    );
  }

  return (
    <div
      data-testid="warfront-commands"
      className="flex flex-wrap items-start gap-x-6 gap-y-2 border-t border-bf-border bg-cc-panel/40 px-4 py-2 text-[11px]"
    >
      {villagerCount > 0 ? (
        <div>
          <div className="mb-1 text-bf-muted">
            Build <span className="text-bf-text">({villagerCount} villager{villagerCount === 1 ? '' : 's'})</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {buildOptions.map((option) => {
              const disabled = !option.affordable;
              const active = placingKind === option.kind;
              return (
                <button
                  key={option.kind}
                  type="button"
                  disabled={disabled}
                  title={option.reason || `${option.timber} timber${option.silver ? `, ${option.silver} silver` : ''}`}
                  onClick={() => onPickBuild(active ? null : option.kind)}
                  className={[
                    'rounded border px-2 py-1 capitalize',
                    active
                      ? 'border-bf-gold bg-bf-gold/20 text-bf-gold'
                      : disabled
                        ? 'cursor-not-allowed border-bf-border/60 text-bf-muted/60'
                        : 'border-bf-border text-bf-text hover:border-bf-gold hover:text-bf-gold',
                  ].join(' ')}
                >
                  {option.name}
                  <span className="ml-1 font-mono text-[10px] text-bf-muted">
                    {option.timber}t{option.silver ? `/${option.silver}s` : ''}
                  </span>
                </button>
              );
            })}
          </div>
          {placingKind !== null ? (
            <div className="mt-1 text-bf-gold">Click the map to site it · Esc to cancel</div>
          ) : null}
        </div>
      ) : null}

      {villagerCount > 0 && colonise ? (
        <div>
          <div className="mb-1 text-bf-muted">Colonise</div>
          <button
            type="button"
            disabled={!colonise.ready}
            title={colonise.reason}
            onClick={onColonise}
            className={[
              'rounded border px-2 py-1',
              colonise.ready
                ? 'border-bf-gold bg-bf-gold/10 text-bf-gold hover:bg-bf-gold/20'
                : 'cursor-not-allowed border-bf-border/60 text-bf-muted/60',
            ].join(' ')}
          >
            Plant a seat
            <span className="ml-1 font-mono text-[10px]">{colonise.price} food</span>
          </button>
          {colonise.reason ? <div className="mt-1 max-w-[16rem] text-bf-muted">{colonise.reason}</div> : null}
        </div>
      ) : null}

      {building ? (
        <div>
          <div className="mb-1 capitalize text-bf-muted">
            {building.name}{' '}
            <span className="text-bf-text">
              {building.complete ? `${building.workersPresent}/${building.slots} working` : `${building.progressPercent}% built`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {trainOptions.length === 0 ? (
              <span className="text-bf-muted">Trains nothing.</span>
            ) : (
              trainOptions.map((option) => {
                const disabled = !building.complete || !option.affordable;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    disabled={disabled}
                    title={
                      !building.complete
                        ? 'Still under construction.'
                        : !option.affordable
                          ? 'Not enough resources.'
                          : option.popBlocked
                            ? 'Will wait at the gate until there is room to live.'
                            : `${option.food} food, ${option.silver} silver, ${option.seconds}s`
                    }
                    onClick={() => onTrain(option.kind)}
                    className={[
                      'rounded border px-2 py-1 capitalize',
                      disabled
                        ? 'cursor-not-allowed border-bf-border/60 text-bf-muted/60'
                        : option.popBlocked
                          ? 'border-bf-gold/50 text-bf-gold hover:bg-bf-gold/10'
                          : 'border-bf-border text-bf-text hover:border-bf-gold hover:text-bf-gold',
                    ].join(' ')}
                  >
                    {option.name}
                    <span className="ml-1 font-mono text-[10px] text-bf-muted">{option.food}f</span>
                  </button>
                );
              })
            )}
            {villagerCount > 0 && building.slots > 0 ? (
              <button
                type="button"
                onClick={onAssignSelected}
                className="rounded border border-bf-border px-2 py-1 text-bf-text hover:border-bf-gold hover:text-bf-gold"
              >
                Assign {villagerCount} here
              </button>
            ) : null}
          </div>
          {building.queue.length > 0 ? (
            <div className="mt-1 text-bf-muted">
              Training: <span className="text-bf-text">{building.queue.join(', ')}</span> ·{' '}
              {Math.ceil(building.queueRemaining / 15)}s
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
