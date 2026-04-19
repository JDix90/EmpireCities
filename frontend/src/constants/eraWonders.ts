/** Static era wonder metadata — mirrors backend game-engine/eras/*.ts wonder exports. */

export interface EraWonderMeta {
  wonder_id: string;
  name: string;
  description: string;
  cost: number;
}

export const ERA_WONDERS: Record<string, EraWonderMeta> = {
  ancient:      { wonder_id: 'wonder_colosseum',    name: 'Colosseum',          description: 'All defenders gain +1 die globally',       cost: 18 },
  medieval:     { wonder_id: 'wonder_cathedral',    name: 'Notre-Dame',         description: '+2 units to draft each turn for owner',     cost: 20 },
  discovery:    { wonder_id: 'wonder_lighthouse',   name: 'Lighthouse of Alexandria', description: 'Sea attacks use 3 dice',                    cost: 18 },
  ww2:          { wonder_id: 'wonder_manhattan',    name: 'Manhattan Project',  description: '+2 flat reinforcement units per turn for the owner', cost: 25 },
  coldwar:      { wonder_id: 'wonder_sputnik',      name: 'Sputnik',            description: '+1 tech point per territory each turn',     cost: 20 },
  modern:       { wonder_id: 'wonder_cern',         name: 'CERN',               description: 'Tech upgrades cost half',                   cost: 22 },
  acw:          { wonder_id: 'wonder_arsenal',      name: 'The Great Arsenal',  description: '+3 flat units to reinforce per turn',       cost: 18 },
  risorgimento: { wonder_id: 'wonder_unification',  name: 'Unification Monument', description: 'Influence range +2',                    cost: 20 },
  space_age:    { wonder_id: 'wonder_space_elevator', name: 'Space Elevator',     description: 'Grants Moon access without a Space Station launch', cost: 25 },
};
