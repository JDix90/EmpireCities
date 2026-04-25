/**
 * In-universe framing for advanced game settings on curated custom / regional maps.
 * Used by Map Hub and lobby copy so toggles feel grounded in each theater’s lore.
 */

export type AdvancedFeatureKey =
  | 'territory_draft'
  | 'asymmetric_factions'
  | 'economy_buildings'
  | 'tech_trees'
  | 'historical_events'
  | 'naval_warfare'
  | 'population_stability'
  | 'fog_of_war';

export interface AdvancedFeatureImmersion {
  /** Why this mode fits the map’s story. */
  lore: string;
  /** How bonuses and pressure show up in play on this map (flavor, not new mechanics). */
  effectFlavor: string;
}

export interface CustomMapImmersionProfile {
  map_id: string;
  /** One–two sentences: the world premise. */
  backdrop: string;
  /** Suggested rules era id for LobbyPage (matches ERAS ids). */
  recommended_rules_era:
    | 'ancient'
    | 'medieval'
    | 'discovery'
    | 'ww2'
    | 'coldwar'
    | 'modern'
    | 'acw'
    | 'risorgimento'
    | 'space_age';
  /** Short hook for cards / headers. */
  tagline: string;
  advanced: Record<AdvancedFeatureKey, AdvancedFeatureImmersion>;
}

function af(
  lore: string,
  effectFlavor: string,
): AdvancedFeatureImmersion {
  return { lore, effectFlavor };
}

const BASE_KEYS: AdvancedFeatureKey[] = [
  'territory_draft',
  'asymmetric_factions',
  'economy_buildings',
  'tech_trees',
  'historical_events',
  'naval_warfare',
  'population_stability',
  'fog_of_war',
];

/** Ensures every key is present (defensive for future edits). */
function assertComplete(advanced: Record<AdvancedFeatureKey, AdvancedFeatureImmersion>): void {
  for (const k of BASE_KEYS) {
    if (!advanced[k]) throw new Error(`customMapImmersion: missing key ${k}`);
  }
}

const FLOODED_NA: CustomMapImmersionProfile = {
  map_id: 'community_flooded_north_america',
  tagline: 'Rise from drowned valleys — trade arcs, citadels, and exile fleets.',
  backdrop:
    'After the great inundation, North America is a lattice of inland seas and shattered ranges. Survivor states cling to high ground; whoever controls ports, narrows, and hydro-corridors controls the continent’s ghost economy.',
  recommended_rules_era: 'modern',
  advanced: {
    territory_draft: af(
      'Neutral high ground is the prize — powers carve spheres before the first shot.',
      'Draft favors coastal citadels and choke islands; early borders echo real geography under water.',
    ),
    asymmetric_factions: af(
      'Mountain republics, bay fleets, and desert enclaves each bring a distinct doctrine to the drowned world.',
      'Faction bonuses read as regional survival perks: logistics, defense in narrows, or rapid island hops.',
    ),
    economy_buildings: af(
      'Hydro-farms, desalination, and fortified ports are the spine of post-flood civilization.',
      'Production and wonders feel like reclaiming infrastructure — income spikes along restored trade spines.',
    ),
    tech_trees: af(
      'Salvaged engineering, climate tech, and hardened logistics define who thrives above the new sea level.',
      'Research gates coastal batteries, faster reinforcement along sea lanes, and crisis-response perks.',
    ),
    historical_events: af(
      'Storm surges, refugee waves, and relic dam failures keep every era unstable.',
      'Events hit as environmental and political shocks — production swings, stability shocks, sudden truce pressure.',
    ),
    naval_warfare: af(
      'The map is half ocean; fleets are how empires breathe between archipelagos.',
      'Naval income and amphibious pressure mirror island-hopping across drowned plains and sounds.',
    ),
    population_stability: af(
      'Crowded enclaves and salt-stressed cities riot or thrive on rationing and morale.',
      'Stability caps and recovery echo refugee logistics — coastal holds swing harder when contested.',
    ),
    fog_of_war: af(
      'Storms, sensor gaps, and smuggler smoke hide fleet movements between fractured coasts.',
      'Fog hides unit stacks beyond your archipelago rim — scouting archipelagos matters as much as brute force.',
    ),
  },
};

const BRITAIN_925: CustomMapImmersionProfile = {
  map_id: 'community_britain_925',
  tagline: 'Heptarchy blood-oaths — shield-walls, longships, and crown claims.',
  backdrop:
    'Britain in 925 is a patchwork of Anglo-Saxon kingdoms, Norse footholds, Welsh fastnesses, and Scottish raids. Every shire is a borderland; every coast hears oars before dawn.',
  recommended_rules_era: 'medieval',
  advanced: {
    territory_draft: af(
      'Jarls and ealdormen pick heartlands before the fyrd marches — the scramble for Mercia and Northumbria begins in ink, not iron.',
      'Draft lets you anchor in Welsh hills, Danelaw coasts, or the southern wheat belt before random warbands spread.',
    ),
    asymmetric_factions: af(
      'Wessex consolidation, Viking sea-kings, Welsh mountain princes — each crown fights differently.',
      'Faction passives feel like saga gifts: shield-wall defense, raid tempo, or hill-fort stubbornness.',
    ),
    economy_buildings: af(
      'Burhs, monastic granaries, and coastal salt-works fund the endless shield-tax.',
      'Buildings read as burh rings and monastic wealth — production rewards holding the fertile midlands and safe harbors.',
    ),
    tech_trees: af(
      'Iron rivets, longship upgrades, and royal charters drag Britain from raid economy to kingdom.',
      'Tech unlocks heavier fortification, better coastal muster, and faster recovery after Viking burns.',
    ),
    historical_events: af(
      'Famine winters, saintly omens, and sudden longship landings rewrite the year’s story.',
      'Events model harvest prayer, cattle plague, and oath-breaking — spikes of loss or windfall across shires.',
    ),
    naval_warfare: af(
      'The Irish Sea and Channel mouths are Viking highways; whoever owns the waves owns the harvest coast.',
      'Fleets and ports make Danelaw corridors lethal — sea connections are raids-in-waiting.',
    ),
    population_stability: af(
      'Peasants flee burning burhs; stability is the peace between harvest and reaving.',
      'Low stability is fyrd exhaustion; recovery is the king’s justice returning to the shire.',
    ),
    fog_of_war: af(
      'Mist moors and forest tracks hide warbands until the ravens rise.',
      'Fog hides muster sizes in the Welsh marches and Scottish edges — scouts earn their silver.',
    ),
  },
};

const HORN_AFRICA: CustomMapImmersionProfile = {
  map_id: 'community_horn_africa',
  tagline: 'Red Sea socialism — federated steel, coffee coasts, and desert frontiers.',
  backdrop:
    'A unified Horn and southern Yemen imagines a federated socialist state bridging highlands, nomad corridors, and the Bab el-Mandeb choke. Ideology, logistics, and clan loyalties pull in three directions at once.',
  recommended_rules_era: 'coldwar',
  advanced: {
    territory_draft: af(
      'Revolutionary committees parcel the federation before the first congress — who claims the Ogaden, the coast, the highlands?',
      'Draft reflects competing visions: coastal trade, highland defense, or Red Sea projection.',
    ),
    asymmetric_factions: af(
      'Highland defense cadres, coastal planners, and desert federators each embody a pillar of the union.',
      'Factions map to doctrine: stability-first, naval outreach, or rapid mobilization along porous borders.',
    ),
    economy_buildings: af(
      'Collective farms, ports, and industrial nodes are the five-year plan made concrete.',
      'Economy feels like planned development — bonuses cluster on choke ports and breadbasket highlands.',
    ),
    tech_trees: af(
      'Soviet-adjacent aid, local innovation, and Red Sea radar nets drag the union into modernity.',
      'Tech unlocks better logistics, influence projection, and crisis-response along long supply lines.',
    ),
    historical_events: af(
      'Drought diplomacy, Gulf crises, and solidarity congresses keep the federation on a knife edge.',
      'Events are coups of fortune: aid convoys, border incidents, and ideological purges that swing production.',
    ),
    naval_warfare: af(
      'The map is a hinge between seas — convoys, blockades, and gunboat politics are existential.',
      'Naval play mirrors Bab el-Mandeb reality — whoever parks fleets shapes Yemen and Somali coasts alike.',
    ),
    population_stability: af(
      'Multi-ethnic federation means loyalty is earned every harvest; stability is the union’s true currency.',
      'Stability swings echo pastoral stress and urban unrest — coastal cities recover faster with ports secured.',
    ),
    fog_of_war: af(
      'Sandstorms, smuggler dhows, and radio silence cloak troop movements along desert seams.',
      'Fog hides buildups on the Ogaden and Red Sea rims — intel wins before armor rolls.',
    ),
  },
};

const AUSTRALIA_1337: CustomMapImmersionProfile = {
  map_id: 'community_australia_1337',
  tagline: 'Karkiyapani crowns — songlines, trade winds, and island thrones.',
  backdrop:
    'An alternate 1337 where Indigenous Australian polities, Aotearoa, and Pacific neighbors appear as structured realms. The continent is a web of trade winds, fire-country, and reef gates — empire is kinship scaled to geography.',
  recommended_rules_era: 'discovery',
  advanced: {
    territory_draft: af(
      'Elders and voyaging captains choose ceremonial grounds before the great gatherings arm.',
      'Draft lets you anchor reef nations, desert trade hubs, or Aotearoa’s volcanic north before the map colors.',
    ),
    asymmetric_factions: af(
      'Each realm’s law and lore grant different blessings — sea mastery, desert endurance, or island unity.',
      'Factions read as cultural strengths: reef raiders, inland law-holders, or double-hulled navigators.',
    ),
    economy_buildings: af(
      'Ceremonial trade houses, fish weirs, and stone storehouses turn songlines into surplus.',
      'Buildings feel like sustainable extraction — bonuses along coasts and reliable river basins.',
    ),
    tech_trees: af(
      'Voyaging astronomy, hardened hulls, and seasonal calendars push fleets farther each generation.',
      'Tech unlocks longer sea reach, safer harvests, and faster recovery after fire-season or storm.',
    ),
    historical_events: af(
      'El Niño hunger, sacred site disputes, and voyaging omens rewrite the year’s luck.',
      'Events are natural and cultural — reef bleaching, trade wind shifts, or alliance ceremonies.',
    ),
    naval_warfare: af(
      'The theater is ocean-braided; outriggers and war canoes are sovereignty made hull.',
      'Naval bonuses reward island chains and reef passages — amphibious play is the default tempo.',
    ),
    population_stability: af(
      'Populations move with seasons; stability is harmony between fire, water, and law.',
      'Stability models carrying capacity — crowded coasts stress faster; inland recovery follows rain.',
    ),
    fog_of_war: af(
      'Reefs, mangrove mazes, and night voyaging hide fleets until the first torch on the beach.',
      'Fog hides island garrisons until you send scouts — the Pacific rewards patience.',
    ),
  },
};

const NATIONS_14: CustomMapImmersionProfile = {
  map_id: 'community_14_nations',
  tagline: 'Fourteen crowns — one continent, infinite border grudges.',
  backdrop:
    'North America reimagined as fourteen peer powers sharing one landmass. Every border is a treaty waiting to break; every heartland is someone else’s manifest destiny.',
  recommended_rules_era: 'modern',
  advanced: {
    territory_draft: af(
      'The continent is partitioned at the treaty table before armies march — manifest destiny starts in negotiation.',
      'Draft rewards locking Great Lakes industry, Gulf ports, or Pacific gateways early.',
    ),
    asymmetric_factions: af(
      'Industrial giants, breadbasket republics, and energy kingdoms each bend the rules of continental war.',
      'Factions feel like national character: mass mobilization, defensive depth, or economic snowball.',
    ),
    economy_buildings: af(
      'Factories, rails, and tech campuses are how a fourteen-way cold war turns hot.',
      'Economy is modern total war — production spikes in megacity clusters and resource belts.',
    ),
    tech_trees: af(
      'Stealth, precision, and integrated logistics define who wins the next brushfire on a superpower lawn.',
      'Tech unlocks doctrine edges: faster fortify, better defense in urban tiles, or attack tempo bonuses.',
    ),
    historical_events: af(
      'Sanctions, blackouts, and election shocks ripple across a continent wired together and armed to the teeth.',
      'Events are cable-news crises made mechanical — swing PP/TP, stability, or diplomacy windows.',
    ),
    naval_warfare: af(
      'Three oceans touch the map; sea control is how you flank a continental rival.',
      'Naval play unlocks amphibious end-arounds and strait pressure — Great Lakes and both coasts matter.',
    ),
    population_stability: af(
      'Megacity unrest and rural resentment decide whether your war machine keeps drafting.',
      'Stability is national morale — heartland peace funds coastal tech; riots cap your surge.',
    ),
    fog_of_war: af(
      'Satellite gaps, cyber smoke, and media blackout zones hide mobilization in plain sight.',
      'Fog models strategic ambiguity — you see borders, not stacks, until you probe or ally-share intel.',
    ),
  },
};

const STRAIT_HORMUZ: CustomMapImmersionProfile = {
  map_id: 'community_strait_hormuz',
  tagline: 'Chokepoint kings — tankers, gunboats, and desert mirages.',
  backdrop:
    'The Gulf’s narrow throat concentrates oil, faith, and firepower. Iran, the Arab Gulf states, and Oman’s coast are one locked room — whoever holds the strait holds the world’s pulse for a week.',
  recommended_rules_era: 'coldwar',
  advanced: {
    territory_draft: af(
      'Coalitions pick ports and desert spines before the first convoy is threatened.',
      'Draft emphasizes Hormuz islands, UAE hubs, and Iranian plateau gateways.',
    ),
    asymmetric_factions: af(
      'Revolutionary guards, emirate fleets, and desert monarchies each fight the chokepoint differently.',
      'Factions map to coastal AA, oil rent, or plateau depth — bonuses feel doctrinal, not cosmetic.',
    ),
    economy_buildings: af(
      'Refineries, pipelines, and port free zones turn black gold into bunkers and planes.',
      'Economy is petro-state logic — income clusters on coasts and choke hexes; wonders feel like national projects.',
    ),
    tech_trees: af(
      'Missile tech, radar nets, and blue-water escorts escalate the narrow sea into a chessboard.',
      'Tech unlocks sea denial, faster fleet redeploy, and crisis income when straits flash hot.',
    ),
    historical_events: af(
      'Embargo shocks, OPEC whispers, and proxy flare-ups keep the Gulf one spark from inferno.',
      'Events are tanker incidents and summit ultimatums — swing diplomacy and production together.',
    ),
    naval_warfare: af(
      'This map is naval war by design — gunboats are border guards and oil is blood.',
      'Every sea connection is a potential blockade; fleet income rewards holding island and mouth tiles.',
    ),
    population_stability: af(
      'Coastal cities swell; interior lines hold loyalty only while ration and rent hold.',
      'Stability tracks urban pressure and sanctions pain — strait owners feel riots first.',
    ),
    fog_of_war: af(
      'Jamming, sand haze, and smuggler dhows hide missile batteries until first salvo.',
      'Fog hides Gulf buildups — ISR (scouting) wins the strait before carriers do.',
    ),
  },
};

export const CUSTOM_MAP_IMMERSION: Record<string, CustomMapImmersionProfile> = {
  [FLOODED_NA.map_id]: FLOODED_NA,
  [BRITAIN_925.map_id]: BRITAIN_925,
  [HORN_AFRICA.map_id]: HORN_AFRICA,
  [AUSTRALIA_1337.map_id]: AUSTRALIA_1337,
  [NATIONS_14.map_id]: NATIONS_14,
  [STRAIT_HORMUZ.map_id]: STRAIT_HORMUZ,
};

for (const p of Object.values(CUSTOM_MAP_IMMERSION)) {
  assertComplete(p.advanced);
}

export function getCustomMapImmersion(mapId: string | null | undefined): CustomMapImmersionProfile | null {
  if (!mapId) return null;
  return CUSTOM_MAP_IMMERSION[mapId] ?? null;
}

/** Default mechanic blurbs (lobby tooltips) — prepended by theater lore when a curated map is selected. */
const MECHANIC_BASE: Record<AdvancedFeatureKey, string> = {
  territory_draft:
    'All territories start neutral. Players take turns selecting which territories they want instead of random assignment. Incompatible with Asymmetric Factions.',
  asymmetric_factions:
    "Each player or faction starts with a unique bonus — extra units, defensive perks, or special abilities tied to the era's major powers. Incompatible with Territory Draft.",
  economy_buildings:
    'Territories generate Production Points each turn. Spend them to construct buildings (farms, forts, ports, labs) that boost income, defense, research, or naval power.',
  tech_trees:
    'Earn Tech Points and research upgrades — improved combat dice, faster production, naval range, or era-specific breakthroughs — that compound advantages over time.',
  historical_events:
    'Era-specific event cards are drawn each turn — plagues, rebellions, trade booms, or political crises. Some affect all players; others let you choose a strategic response.',
  naval_warfare:
    'Coastal territories can build and station fleets. Move fleets across sea connections to project power, blockade enemies, or launch amphibious attacks on distant shores.',
  population_stability:
    'Each territory tracks stability (0–100%) and population (1–10). Low stability reduces income, caps unit placement, and risks rebellion. High stability grows population, which boosts production. Captured territories start at 30% stability with halved population. Select factions gain faster stability recovery.',
  fog_of_war:
    'Players can only see territories they own and neighboring enemy positions. Hidden territories conceal unit counts, making scouting and border control more important.',
};

/**
 * Tooltip copy for an advanced checkbox: theater flavor + standard rules.
 * When `mapId` is not a curated immersion map, returns the base rules text only.
 */
export function advancedFeatureTooltip(mapId: string | null | undefined, key: AdvancedFeatureKey): string {
  const base = MECHANIC_BASE[key];
  const imm = getCustomMapImmersion(mapId);
  if (!imm) return base;
  const { lore, effectFlavor } = imm.advanced[key];
  return `${lore}\n\nHow it feels here: ${effectFlavor}\n\nRules: ${base}`;
}
