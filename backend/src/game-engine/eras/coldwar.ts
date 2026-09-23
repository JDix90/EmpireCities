import type { Faction, TechNode, EraWonder } from './types';

// ── Factions ──────────────────────────────────────────────────────────────────
export const COLDWAR_FACTIONS: Faction[] = [
  {
    faction_id: 'usa_cw',
    lineage_id: 'mercantile',
    name: 'United States',
    // Neither half was real: there is no tech_point_income on this faction,
    // and `influence_range` is an ERA_DEFAULTS value of 1 for everyone in this
    // era, not something the United States extends.
    description: 'Global superpower — +1 reinforcement per turn, and the Marshall Plan lands a unit wherever the alliance needs one.',
    lore: 'Carrier groups, development aid, and alliance architecture let Washington project power without occupying every frontline directly.',
    flavor_quote: 'Influence the map before the battle begins.',
    home_region_ids: ['north_america_cw'],
    reinforce_bonus: 1,
    ability_id: 'marshall_plan',
    ability_description: 'Marshall Plan: once per turn during draft, place 1 free unit on any allied or newly captured territory.',
    color: '#3498db',
    stability_recovery_bonus: 3,
  },
  {
    faction_id: 'ussr',
    lineage_id: 'imperial',
    name: 'Soviet Union',
    description: 'Command economy and a hardened perimeter — +1 reinforcement per turn.',
    lore: 'The Soviet bloc hardens its perimeter through ideology, armor, and a security state built to absorb existential pressure.',
    flavor_quote: 'Depth, discipline, and doctrine hold the frontier.',
    home_region_ids: ['warsaw_pact'],
    reinforce_bonus: 1,
    color: '#c0392b',
  },
  {
    faction_id: 'china_cw',
    lineage_id: 'bastion',
    name: "People's Republic of China",
    // No faction may carry an innate defence die (factionDefense.test.ts), and
    // there is no region-scoped defence mechanic behind the "in Asia" clause.
    // One of the eight #397 recorded as still outstanding.
    description: 'Vast army — +2 reinforcements per turn, and once a game the whole country mobilises at once.',
    lore: 'Revolutionary legitimacy and mass mobilization give China resilience, especially when the fight becomes one of exhaustion.',
    flavor_quote: 'A long war favors the side that can renew itself.',
    home_region_ids: ['east_asia_cw'],
    reinforce_bonus: 2,
    ability_id: 'peoples_war',
    ability_description: "People's War: once per game, double your reinforcements for one turn.",
    color: '#e74c3c',
  },
  {
    faction_id: 'uk_cw',
    lineage_id: 'maritime',
    name: 'United Kingdom',
    // The old description and the ability disagreed with each other: this said
    // the attacker loses an extra unit, the ability cancels the attack outright.
    description: 'Nuclear deterrent and a fleet — +1 reinforcement per turn, an extra attack die, and one attack on the capital that simply does not happen.',
    lore: 'Postwar Britain holds disproportionate leverage through diplomacy, intelligence, and the menace of strategic reprisal.',
    flavor_quote: 'A smaller empire can still cast a long shadow.',
    // This faction shared `nato_europe` with the NATO Alliance, the only
    // shared homeland in the era and the same fault that made ww2's Germany
    // unplayable in #399: the dealer split the region between them and both
    // finished last, at 5% and 11% against a 17% fair share. uk_ireland is its
    // own region on the map now, so the Alliance gets the continent and the
    // United Kingdom gets the Isles and the West Indies — Jamaica, Trinidad
    // and the Bahamas were still British for most of this era.
    //
    // The Middle East was the more historically apt second home — Suez, the
    // Gulf, CENTO — and was measured at 6-7%, which is not a playable faction:
    // it is the most contested region on the board and the seat stayed
    // fragmented. Latin America reaches 13%.
    //
    // It also had NO numeric bonus of any kind and a once-per-GAME reaction,
    // the thinnest kit measured anywhere. Elimination alone fell from 53% to
    // 9% on the numbers below, but wins did not move until the seat changed
    // too — the same split between surviving and winning that parthia showed
    // in #399.
    home_region_ids: ['british_isles_cw', 'latin_america'],
    passive_attack_bonus: 1,
    reinforce_bonus: 1,
    ability_id: 'nuclear_deterrence',
    ability_description: 'Nuclear Deterrence: once per game, cancel an attack against your capital territory entirely.',
    color: '#e67e22',
  },
  {
    faction_id: 'decolonization_movement',
    lineage_id: 'insurgent',
    name: 'Non-Aligned Movement',
    // The immunity is real, but it described none of what makes this faction
    // strong: a reinforcement every turn and two free units wherever it was
    // hit last turn, which is why it was eliminated in 1-5% of games.
    description: 'Neither bloc\'s to command — +1 reinforcement per turn, two more wherever they were struck last turn, and no influence takes hold here.',
    lore: 'Newly independent states and insurgent movements refuse to become pawns, thriving in the gaps between the blocs.',
    flavor_quote: 'We are not another square on someone else\'s board.',
    // Two whole uncontested regions, nine territories, was the widest claim in
    // the era and it won 34% against a 17% fair share. South Asia becomes
    // neutral ground everyone can contest. Trimming alone moved it only three
    // points — the position was never the whole story, the survivability was —
    // but it is the half that should not have been free.
    home_region_ids: ['africa_cw'],
    reinforce_bonus: 1,
    ability_id: 'guerrilla_resistance',
    ability_description: 'Guerrilla Resistance: once per turn, place 2 free units on any border territory that was attacked last turn.',
    color: '#27ae60',
  },
  {
    faction_id: 'nato_proxy',
    lineage_id: 'expansionist',
    name: 'NATO Alliance',
    // "+1 defense die" on adjacent territories is not a mechanic that exists,
    // and no faction may carry an innate defence die at all
    // (factionDefense.test.ts). Article 5 is a defender reaction and always
    // was. The second of #397's outstanding eight in this era.
    description: 'Collective defense pact — an attack on any of its territories costs the attacker an extra unit.',
    lore: 'Interoperability, shared planning, and mutual guarantees make NATO strongest when it fights as a network instead of a nation.',
    flavor_quote: 'An attack on one border wakes every garrison.',
    home_region_ids: ['nato_europe'],
    ability_id: 'collective_defense',
    ability_description: 'Article 5: once per turn, an attack on any of your territories triggers +1 automatic defender loss on the attacker.',
    color: '#9b59b6',
  },
];

// ── Tech Tree ─────────────────────────────────────────────────────────────────
export const COLDWAR_TECH_TREE: TechNode[] = [
  // Tier 1
  {
    tech_id: 'cw_intelligence',
    name: 'Intelligence Agency',
    description: 'CIA/KGB ops — once per turn see enemy unit counts in fog-of-war territories adjacent to yours.',
    tier: 1,
    cost: 4,
    unlocks_ability: 'spy_network',
  },
  {
    tech_id: 'cw_bunker',
    name: 'Hardened Bunkers',
    description: 'Underground command — unlocks defense_1 building.',
    tier: 1,
    cost: 4,
    unlocks_building: 'defense_1',
  },
  {
    tech_id: 'cw_industry',
    name: 'Heavy Industry',
    description: 'Steel and coal production — unlocks production_1 building.',
    tier: 1,
    cost: 4,
    unlocks_building: 'production_1',
  },
  {
    tech_id: 'cw_propaganda',
    name: 'Propaganda Machine',
    description: 'Influence operations — your influence ability can now target 1 extra hop away.',
    tier: 1,
    cost: 5,
    unlocks_ability: 'propaganda_extended',
  },
  // Tier 2
  {
    tech_id: 'cw_jets',
    name: 'Jet Fighter Program',
    description: 'Air superiority — +1 attack die when attacking territories adjacent to your air-base territories.',
    tier: 2,
    prerequisite: 'cw_intelligence',
    cost: 9,
    attack_bonus: 1,
  },
  {
    tech_id: 'cw_fortified_zone',
    name: 'Fortified Zone',
    description: 'Militarized borders — unlocks defense_2 building.',
    tier: 2,
    prerequisite: 'cw_bunker',
    cost: 8,
    unlocks_building: 'defense_2',
  },
  {
    tech_id: 'cw_space_race',
    name: 'Space Race',
    description: 'Prestige and technology — unlocks tech_gen_1 building and +3 tech per turn.',
    tier: 2,
    prerequisite: 'cw_industry',
    cost: 8,
    tech_point_income: 3,
    unlocks_building: 'tech_gen_1',
  },
  {
    tech_id: 'cw_proxy_wars',
    name: 'Proxy Wars',
    description: 'Fund regime changes — influence ability now costs 2 units instead of 3.',
    tier: 2,
    prerequisite: 'cw_propaganda',
    cost: 7,
    unlocks_ability: 'proxy_funding',
  },
  // Tier 3
  {
    tech_id: 'cw_icbm',
    name: 'ICBM Program',
    description: 'Nuclear missiles — once per turn, reduce any territory\'s unit count by 2 without attacking.',
    tier: 3,
    prerequisite: 'cw_jets',
    cost: 14,
    unlocks_ability: 'nuclear_strike',
  },
  {
    tech_id: 'cw_missile_shield',
    name: 'Missile Defense Shield',
    description: 'ABM systems — unlocks defense_3 building; first attack each turn against your capital has -1 attacker die.',
    tier: 3,
    prerequisite: 'cw_fortified_zone',
    cost: 13,
    defense_bonus: 1,
    unlocks_building: 'defense_3',
  },
  {
    tech_id: 'cw_satellite',
    name: 'Satellite Network',
    description: 'Spy satellites — unlocks tech_gen_2 building and reveal all territories once per turn.',
    tier: 3,
    prerequisite: 'cw_space_race',
    cost: 12,
    tech_point_income: 2,
    unlocks_building: 'tech_gen_2',
    unlocks_ability: 'satellite_reconnaissance',
  },
  // Tier 4
  {
    tech_id: 'cw_detente',
    name: 'Détente',
    description: 'Diplomatic thaw — truce turns count as 0 cost; you can auto-influence any neutral territory within range.',
    tier: 4,
    prerequisite: 'cw_icbm',
    cost: 18,
    reinforce_bonus: 2,
    unlocks_ability: 'detente_protocol',
  },
];

// ── Wonder ────────────────────────────────────────────────────────────────────
export const COLDWAR_WONDER: EraWonder = {
  wonder_id: 'wonder_sputnik',
  name: 'Sputnik',
  description: 'Eyes in the sky: +1 tech point per owned territory per turn.',
  cost: 20,
  passive_effect_type: 'tech_point_per_territory',
  passive_effect_value: 1,
};
