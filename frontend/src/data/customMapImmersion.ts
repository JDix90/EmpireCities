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

const CHARLEMAGNE_814: CustomMapImmersionProfile = {
  map_id: 'community_charlemagne_814',
  tagline: 'Inherit the empire — crowns, marches, and the long shadow of Charlemagne.',
  backdrop:
    'Europe in 814: the Frankish Empire towers from the Pyrenees to the Elbe, the Eastern Roman and Abbasid worlds hold the south, and a frontier of Norse, Slav, Bulgar, Avar, Magyar, and Khazar peoples presses every march. The old emperor is dead — the continent waits to see who can hold what he built.',
  recommended_rules_era: 'medieval',
  advanced: {
    territory_draft: af(
      'Counts and margraves stake their duchies before the host musters — Neustria, Saxony, and the Italian crown are claimed in the partition, not the field.',
      'Draft lets you anchor in the Carolingian heartland, the Iberian marches, or the open steppe before rivals spread.',
    ),
    asymmetric_factions: af(
      'Frankish heavy cavalry, Byzantine thematic defense, Norse raiders, and steppe horse-archers each wage a different war.',
      'Faction passives read like the era’s powers: mailed charge, fortified themes, longship tempo, or the endless mobility of the khaganates.',
    ),
    economy_buildings: af(
      'Royal abbeys, palatine mints, and march fortresses turn conquered land into a working empire.',
      'Buildings feel like the Carolingian renovatio — production rewards holding the Rhine–Seine breadbasket and the Italian and Greek cities.',
    ),
    tech_trees: af(
      'Stirrup and mail, Carolingian minuscule, and stone burhs drag the post-Roman world toward statecraft.',
      'Tech unlocks heavier knights, stronger marches, and faster recovery after a Viking or Magyar raid season.',
    ),
    historical_events: af(
      'Imperial successions, Viking landfalls, Magyar raids, and papal coronations rewrite the year’s borders.',
      'Events model partition crises and frontier raids — sudden windfalls of legitimacy or brutal losses along the marches.',
    ),
    naval_warfare: af(
      'The North Sea, Channel, Adriatic, and Aegean are highways for longships and dromons alike.',
      'Fleets and ports make the Norse coasts and Byzantine seas decisive — sea connections are invasions waiting to sail.',
    ),
    population_stability: af(
      'Newly conquered Saxons and Lombards chafe under Frankish counts; stability is the peace an emperor must keep.',
      'Low stability is a march in revolt; recovery is missi dominici and the king’s justice riding the frontier.',
    ),
    fog_of_war: af(
      'Forests, steppe, and storm-locked seas hide warbands until the raven banners crest the horizon.',
      'Fog hides musters beyond the Elbe and across the Danube — scouting the frontier wins the campaign before the levy marches.',
    ),
  },
};

const USA_BALKAN: CustomMapImmersionProfile = {
  map_id: 'community_balkanized_usa',
  tagline: 'Fifty stars, nine flags — the Union is a memory.',
  backdrop:
    'After the federal government dissolved, the old sectional fault lines hardened into borders, and nine successor nations now contest the continent from the Atlantic seaboard to the Pacific — each heir to a slice of America’s industry, farmland, and arsenals.',
  recommended_rules_era: 'modern',
  advanced: {
    territory_draft: af(
      'Successor states stake their claims at the post-collapse Continental Conference.',
      'Snake-draft territory picks weighted toward your faction’s historic heartland.',
    ),
    asymmetric_factions: af(
      'Industrial Great Lakes, agrarian Heartland, and theocratic Deseret each rebuilt differently.',
      'Every region grants a unique passive — Texas +oil income, Cascadia +defensive terrain.',
    ),
    economy_buildings: af(
      'Rust-belt foundries, Gulf refineries, and Central Valley farms underwrite the armies.',
      'Build factories, farms, and ports to convert resources into reinforcement bonuses.',
    ),
    tech_trees: af(
      'Salvaged labs and university towns drive a new arms race.',
      'Research unlocks mechanized units, rail logistics, and recon doctrine.',
    ),
    historical_events: af(
      'Refugee surges, dam failures, and secession referenda reshape the map.',
      'Timed event cards shift bonuses, spawn rebels, or open new fronts.',
    ),
    naval_warfare: af(
      'The old navy scattered to three coasts and the Great Lakes.',
      'Coastal and lake territories support fleets enabling amphibious assault and blockade.',
    ),
    population_stability: af(
      'Divided loyalties simmer in border cities like St. Louis and Cincinnati.',
      'Over-stacked or newly conquered territories accrue unrest, risking revolt.',
    ),
    fog_of_war: af(
      'With the satellite network down, intel comes from scouts and ham radio.',
      'Enemy troop counts stay hidden beyond your borders until you scout them.',
    ),
  },
};

const CHINA_WARLORD: CustomMapImmersionProfile = {
  map_id: 'community_fractured_china',
  tagline: 'The Republic is dead. Nine cliques, one Mandate of Heaven.',
  backdrop:
    'After the old Republic collapsed, China dissolved into a patchwork of warlord fiefdoms — Fengtian bayonets in Manchuria, the Zhili clique on the dusty North China Plain, frontier khanates along the Gobi, and the rich treaty ports of Jiangnan financing every army that marches.',
  recommended_rules_era: 'modern',
  advanced: {
    territory_draft: af(
      'Cliques carve up the provinces in a frantic land-grab as the Republic collapses.',
      'Players snake-draft starting provinces, each pick locking an adjacent one until the map is claimed.',
    ),
    asymmetric_factions: af(
      'Fengtian cavalry, Zhili infantry, the cash-rich Jiangnan ports, and the mountain cliques each fight to their strengths.',
      'Each region grants a unique perk — extra reinforcements, cheaper buildings, or defensive terrain.',
    ),
    economy_buildings: af(
      'Arsenals at Hanyang, silk mills in Shanghai, and salt-tax bureaus fund the war machine.',
      'Build factories, banks, and forts to convert income into troops, gold, or defense.',
    ),
    tech_trees: af(
      'Warlords court foreign advisors for aircraft, armored trains, and Mauser rifles.',
      'Spend research to unlock combat modifiers, faster movement, and unit upgrades.',
    ),
    historical_events: af(
      'The Northern Expedition, the May Thirtieth strikes, and shifting concessions reshape the board.',
      'Timed event cards trigger reinforcements, unrest, or diplomatic windfalls at key cities.',
    ),
    naval_warfare: af(
      'Gunboats patrol the Yangtze and the South China Sea while fleets contest Taiwan and Hainan.',
      'Sea connections require naval units, and island assaults need a controlled coastal port.',
    ),
    population_stability: af(
      'Famine, conscription, and bandit unrest churn the vast peasant population.',
      'Over-taxed or over-garrisoned provinces accrue unrest that can spawn rebel armies.',
    ),
    fog_of_war: af(
      'Rival cliques hide troop strength behind rumor and bought intelligence.',
      'Enemy army sizes stay hidden until scouted or adjacent, rewarding spies and garrisons.',
    ),
  },
};

const INDIA_BALKAN: CustomMapImmersionProfile = {
  map_id: 'community_balkanized_india',
  tagline: 'The jewel shattered — nine crowns, one subcontinent.',
  backdrop:
    'When the last paramount empire collapsed, the subcontinent splintered into rival successor states from the Sikh Punjab and Himalayan Kashmir to the Maratha Deccan, the Dravidian south, and island Lanka. Monsoon rivers, the Ghats, the Thar, and two oceans now draw the borders.',
  recommended_rules_era: 'modern',
  advanced: {
    territory_draft: af(
      'Princely houses and panchayats parcel out the land before the first monsoon campaign.',
      'Players snake-draft territories; contiguous home regions grant a one-time founding levy.',
    ),
    asymmetric_factions: af(
      'Khalsa cavalry, Maratha light horse, Bengal’s river fleets, and southern temple-treasuries each fight by their own doctrine.',
      'Each region confers a passive — Maratha gain movement, Bengal gain trade income, Punjab gain attack dice.',
    ),
    economy_buildings: af(
      'Bazaars, river ghats, temple granaries, and mountain forts turn districts into engines of wealth.',
      'Spend income on structures that boost reinforcement output or fortify a territory’s defense.',
    ),
    tech_trees: af(
      'From matchlock to flintlock, from war-elephant to field artillery, each court races to modernize.',
      'Research unlocks unit upgrades and economic multipliers along a branching tree.',
    ),
    historical_events: af(
      'Famine years, monsoon floods, trading companies, and tax revolts reshape the board.',
      'Event cards apply map-wide modifiers, sometimes spawning neutral company enclaves on the coast.',
    ),
    naval_warfare: af(
      'The Arabian Sea and Bay of Bengal carry dhows, war-galleys, and the first steam frigates.',
      'Sea connections (Lanka, the Konkan) allow naval invasions and blockades that cut coastal income.',
    ),
    population_stability: af(
      'Overtaxed ryots riot; a contented province feeds armies and fills treasuries.',
      'Each territory tracks unrest; high unrest cuts reinforcements and can trigger rebel garrisons.',
    ),
    fog_of_war: af(
      'Beyond the Ghats and across the great rivers, scouts carry only rumors of enemy strength.',
      'Enemy army counts stay hidden until a bordering or scouted territory reveals them.',
    ),
  },
};

const AFRICA_UNCOL: CustomMapImmersionProfile = {
  map_id: 'community_uncolonized_africa',
  tagline: 'The continent before the Scramble — eight indigenous powers for the whole of Africa.',
  backdrop:
    'On the eve of partition, Africa stands whole and self-ruled: the caravan empires of the Sahel weigh gold against salt, Abyssinia’s mountain kings hold the Horn, and Swahili dhows thread the monsoon coast from Mombasa to Madagascar.',
  recommended_rules_era: 'discovery',
  advanced: {
    territory_draft: af(
      'Founding chiefs and sultans parcel out the land at the first great council.',
      'Snake-draft starting territories; first picks claim coastal hubs, later picks gain extra garrisons.',
    ),
    asymmetric_factions: af(
      'A Sahelian gold-empire fights nothing like a Swahili merchant city or a Zulu impi.',
      'Each region grants a trait — Sahel +income, Abyssinia defensive terrain, Swahili naval reach.',
    ),
    economy_buildings: af(
      'Salt pans, gold reefs, ivory ports, and grain terraces fund the muskets and spears of empire.',
      'Build markets, mines, and ports to multiply yield; coastal builds unlock trade routes.',
    ),
    tech_trees: af(
      'From savanna horse-cavalry to ocean-going dhows and imported firearms, knowledge spreads along the caravan roads.',
      'Three branches — Cavalry, Seafaring, Firearms — each unlocking stronger units and a region passive.',
    ),
    historical_events: af(
      'A monsoon failure, a gold rush at the Niger bend, or a foreign caravel can upend the balance.',
      'Era events fire each round: famines cut income, gold strikes spawn resources, ships open sea raids.',
    ),
    naval_warfare: af(
      'Dhows and war-canoes rule the Indian Ocean coast; whoever holds Zanzibar reaches Madagascar first.',
      'Sea connections require a fleet to traverse; naval units can blockade enemy ports.',
    ),
    population_stability: af(
      'Overtaxed villages revolt, and lands stripped for war empty as people flee to safer kingdoms.',
      'Over-mobilizing or over-taxing lowers stability, risking revolts that flip a territory neutral.',
    ),
    fog_of_war: af(
      'Beyond the last waterhole and the rim of the rainforest, rival armies move unseen.',
      'Enemy stack sizes stay hidden in non-adjacent territories until scouted or contacted.',
    ),
  },
};

const SOUTHAM_BALKAN: CustomMapImmersionProfile = {
  map_id: 'community_south_america',
  tagline: 'From the Pampas to the cordillera — six heirs of Bolívar’s broken dream.',
  backdrop:
    'After the great federations of the 19th century splintered, South America settled into six rival powers divided by the Andes, the Amazon, and the Plata. Now the continent’s rivers and mountain passes are the front lines of a struggle to reunify it under one flag.',
  recommended_rules_era: 'modern',
  advanced: {
    territory_draft: af(
      'Provincial juntas pledge to whichever caudillo reaches them first as the old federations dissolve.',
      'Players claim territories in snake-draft order; border provinces grant a one-time muster bonus.',
    ),
    asymmetric_factions: af(
      'Brazil fields an imperial navy and coffee wealth; Chile is a thin nitrate-rich blade; Paraguay is a fortress of conscripts.',
      'Each region starts with a trait — Brazil +income, Chile +defense in mountains, Guaraní +reinforcement rate.',
    ),
    economy_buildings: af(
      'Silver mints at Potosí, coffee fazendas, and the cattle saladeros of the Plata bankroll every army.',
      'Build mines, plantations, and ports on matching terrain to multiply territory income.',
    ),
    tech_trees: af(
      'Railroads, ironclads, and breech-loading rifles arrive unevenly across canyons and jungle.',
      'Spend research to unlock rail movement, naval bombardment, and entrenchment along three branches.',
    ),
    historical_events: af(
      'The War of the Triple Alliance, the War of the Pacific, and rubber booms reshape the board.',
      'Timed event cards trigger blockades, gold rushes, and border arbitration.',
    ),
    naval_warfare: af(
      'Squadrons duel from Valparaíso to Rio while the Paraná and Amazon carry gunboats inland.',
      'Coastal and river territories enable fleets; holding the Plata and Magellan straits taxes enemy sea movement.',
    ),
    population_stability: af(
      'Conscription drains the villages, and a hungry province will hoist the black flag of revolt.',
      'Over-garrisoned or starved territories accrue unrest; high unrest spawns rebel armies.',
    ),
    fog_of_war: af(
      'Beyond the Andean passes and under the Amazon canopy, scouts vanish and rumor rules.',
      'Enemy strength in jungle and mountain territories is hidden until adjacent or scouted.',
    ),
  },
};

const JAPAN_DIVIDED: CustomMapImmersionProfile = {
  map_id: 'community_divided_japan',
  tagline: 'Whoever holds the straits holds the home islands.',
  backdrop:
    'In an alternate 1946, the victorious Allies split occupied Japan into Soviet, American, British, and Chinese zones while Korea is partitioned along the 38th parallel. With every front separated by water, the war is decided not in the rice paddies but in the contested straits.',
  recommended_rules_era: 'coldwar',
  advanced: {
    territory_draft: af(
      'As the occupation begins, each power races to plant its flag before the demarcation lines harden.',
      'Players alternate claiming territories; contested straits are drafted last and stay neutral a turn longer.',
    ),
    asymmetric_factions: af(
      'The Red Army marches down Hokkaido, the US Navy anchors off Tokyo Bay, the Royal Navy patrols the Inland Sea, and China presses up from Kyūshū.',
      'Soviet Zone gets cheap land reinforcements; American +naval movement; British draws extra cards; Chinese reinforces faster after losses.',
    ),
    economy_buildings: af(
      'Shipyards at Yokosuka, Kure, and Sasebo decide who can keep a fleet at sea through the winter.',
      'Shipyards lower the cost of sea-crossing attacks; docks raise the income of the straits you control.',
    ),
    tech_trees: af(
      'From battleship gunnery to carrier doctrine to early missile boats, each zone invests in the navy it can afford.',
      'Naval techs add dice to amphibious assaults; coastal radar reveals adjacent enemy sea movement.',
    ),
    historical_events: af(
      'The Korean front flares, a typhoon scatters a fleet, and a great-power summit freezes the lines.',
      'Event cards trigger DMZ clashes, storm turns that disable sea attacks, and single-strait ceasefires.',
    ),
    naval_warfare: af(
      'This is a war of straits — the Tsugaru, Kanmon, Bungo, and Tsushima crossings are the only roads between the islands.',
      'Every sea connection requires naval supremacy to cross; massing a fleet in a strait blockades it and halves enemy reinforcements beyond.',
    ),
    population_stability: af(
      'Occupied cities seethe under foreign garrisons; an overstretched fleet cannot also hold the docks quiet.',
      'Dense zones (Tokyo, Osaka, Seoul) risk unrest that spawns rebels unless garrisoned; loyal ports boost income.',
    ),
    fog_of_war: af(
      'Beyond the horizon, enemy convoys and landing fleets move unseen until they break the surf.',
      'Sea-adjacent enemy stacks are hidden until they attack or you hold coastal radar.',
    ),
  },
};

const RUSSIA_FRACTURED: CustomMapImmersionProfile = {
  map_id: 'community_fractured_russia',
  tagline: 'The largest country on Earth comes apart at the seams.',
  backdrop:
    'When the Federation finally fractures, eight successor states scramble to claim the wreckage of a continent — from the Baltic littoral of St. Petersburg to the Pacific docks of Vladivostok. Rivers, mountain ranges, and frozen frontiers draw every contested border across northern Eurasia.',
  recommended_rules_era: 'modern',
  advanced: {
    territory_draft: af(
      'As the center hollows out, oblast governors and warlords race to plant their flags.',
      'Players claim starting territories in snake-draft order; border regions seed extra contested zones.',
    ),
    asymmetric_factions: af(
      'Muscovy commands the old bureaucracy; the Cossack Don rides light; Turkestan trades across the steppe.',
      'Each region grants a perk — Muscovy +reinforcement, Cossacks +attack die on plains, Siberia resource resilience.',
    ),
    economy_buildings: af(
      'Pipelines, rail junctions, and river ports are the sinews of a continent too vast to hold by infantry alone.',
      'Build depots and rail hubs to boost production and accelerate cross-region movement.',
    ),
    tech_trees: af(
      'Some republics inherit the rocket forges and reactor towns; others rebuild industry from scratch.',
      'Invest in Industry, Logistics, or Strategic branches; the Urals unlock heavy industry early.',
    ),
    historical_events: af(
      'Coup season, harvest failures, and breakaway referendums ripple across the steppe.',
      'Each turn draws an event — defections, oil booms, or winter freezes that close river crossings.',
    ),
    naval_warfare: af(
      'Whoever holds the Pacific shore and the Caspian flotillas controls the seams the land routes can’t span.',
      'Sea links (Sakhalin, Okhotsk) require naval units; coastal hubs enable amphibious assault.',
    ),
    population_stability: af(
      'A republic that overreaches its supply lines breeds unrest in the cities it cannot feed.',
      'Overextended players accrue unrest, cutting income and risking partisan revolts in the rear.',
    ),
    fog_of_war: af(
      'Across nine time zones of taiga and tundra, no one knows what masses beyond the Yenisei.',
      'Enemy troop counts in non-adjacent territories stay hidden until scouted or bordered.',
    ),
  },
};

const BYZANTIUM_MEGALI: CustomMapImmersionProfile = {
  map_id: 'community_byzantium_megali',
  tagline: 'The Empire endures — but only as far as her fleet can reach.',
  backdrop:
    'An alternate Byzantium that never fell: Constantinople still chains the Bosphorus, Greece and western Anatolia remain Roman, and a battered Ottoman rump, Bulgaria, Serbia, the Latin islanders, and the Levantine ports all fight for the straits and the wine-dark Aegean.',
  recommended_rules_era: 'medieval',
  advanced: {
    territory_draft: af(
      'Themes and ducats are apportioned by the Logothete before the campaigning season opens.',
      'Players snake-draft starting themes; coastal and island holdings cost an extra pick.',
    ),
    asymmetric_factions: af(
      'The Basileus, the Sultan’s heirs, the Tsars of Tarnovo, the Serbian Kral, and the island Latins each rule by different law.',
      'Each faction gains a bonus — Byzantines a free strait crossing, Latins cheaper fleets, Ottomans stronger land levies.',
    ),
    economy_buildings: af(
      'Harbours, kastra, and silk-works turn provinces into the treasury that pays the tagmata.',
      'Build harbours for +naval income, kastra for defense, workshops for +gold per turn.',
    ),
    tech_trees: af(
      'Greek fire, dromon design, and the cataphract drill advance along distinct paths of war.',
      'Spend research on Naval, Fortification, or Cavalry trees; Greek Fire unlocks a one-time fleet-wipe.',
    ),
    historical_events: af(
      'Crusader fleets, Anatolian earthquakes, and Black Death galleys arrive unbidden each era.',
      'Random events reshuffle the board — plague halves a region’s garrisons, a Crusade grants a neutral army.',
    ),
    naval_warfare: af(
      'The Aegean is the true frontier; every island is won by oar and sail, and no march crosses the straits unescorted.',
      'Sea links require fleets; a contested strait blockades all crossing armies until the navy is broken.',
    ),
    population_stability: af(
      'A province bled of men and faith breeds revolt, and the Aegean isles are quick to declare for Venice.',
      'Over-taxed or under-garrisoned territories lose stability and may defect; islands defect fastest.',
    ),
    fog_of_war: af(
      'Beyond the Pharos and the watchtowers of the Mani, the sea hides every enemy sail.',
      'Enemy fleet sizes stay hidden until adjacent; scouting ships reveal one sea-zone per turn.',
    ),
  },
};

const SPAIN_BALKAN: CustomMapImmersionProfile = {
  map_id: 'community_balkanized_spain',
  tagline: 'Eight crowns for one peninsula — and not one will bend the knee.',
  backdrop:
    'The Iberian Peninsula has shattered along its oldest faults. Castile, Portugal, Andalusia, Catalonia, Aragon-Valencia, Galicia, the Basque Country, and Navarre each raise their own banner across a compact theater of mountain frontiers and river borders.',
  recommended_rules_era: 'modern',
  advanced: {
    territory_draft: af(
      'The old kingdoms reconvene their Cortes and parcel the peninsula province by province before the first muster.',
      'Players snake-draft starting provinces; your historic heartland drafts first.',
    ),
    asymmetric_factions: af(
      'Castilian tercios, Catalan almogàvers, Basque ironworks, and Andalusian cavalry each wage a different war.',
      'Each region grants a passive — Castile +reinforcements, Catalonia +trade income, Basque +defense in hills.',
    ),
    economy_buildings: af(
      'Wool fairs, Mediterranean ports, and the silver of the Indies bankroll every crown.',
      'Build markets, ports, and forts to convert territory income into troops and defense.',
    ),
    tech_trees: af(
      'From the arquebus to the bastion fort, each kingdom modernizes its army at its own pace.',
      'Research unlocks stronger infantry, fortification, and faster recovery after a defeat.',
    ),
    historical_events: af(
      'Harvest failures, foral revolts, and dynastic marriages redraw alliances overnight.',
      'Event cards trigger reinforcements, unrest, or a rival’s sudden claim on your throne.',
    ),
    naval_warfare: af(
      'The Mediterranean and Atlantic coasts are the lifelines of Catalonia, Andalusia, and the Atlantic crowns.',
      'Coastal territories support fleets enabling amphibious assault and blockade.',
    ),
    population_stability: af(
      'Mountain provinces chafe under a distant crown; stability is the peace between harvest and revolt.',
      'Over-taxed or over-garrisoned provinces accrue unrest that can flip them neutral.',
    ),
    fog_of_war: af(
      'The sierras and the Meseta hide armies until the watchfires are lit.',
      'Enemy strength stays hidden beyond your borders until scouted.',
    ),
  },
};

const NUSANTARA: CustomMapImmersionProfile = {
  map_id: 'community_nusantara',
  tagline: 'Whoever holds the straits holds the wind.',
  backdrop:
    'The age of the spice routes, when Srivijaya and Majapahit ruled the sea-lanes and a thousand islands traded pepper, cloves, and nutmeg under monsoon sail. From the Strait of Malacca to the Banda Sea, fleets — not armies — decide who commands the archipelago.',
  recommended_rules_era: 'discovery',
  advanced: {
    territory_draft: af(
      'Petty rajahs and harbor-lords stake claim to their home isles before the monsoon turns.',
      'Players alternate-pick island clusters; coastal capitals draft first, granting an early port.',
    ),
    asymmetric_factions: af(
      'Srivijaya the river-thalassocracy, Majapahit the rice-and-fleet empire, the Moluccan sultanates rich in cloves alone.',
      'Each faction begins with a bonus — Srivijaya +sea-link reach, Majapahit cheaper musters, Maluku double spice income.',
    ),
    economy_buildings: af(
      'Godowns, dry-docks, and pepper terraces line every sheltered bay.',
      'Build shipyards to cut fleet cost, warehouses to store income through a bad monsoon, plantations for +gold on spice isles.',
    ),
    tech_trees: af(
      'From the outrigger jong to the lateen-rigged trade junk, shipwrights chase the wind.',
      'A naval-weighted tree: hull upgrades raise fleet range, navigation unlocks crossing the open Banda and Sulu seas.',
    ),
    historical_events: af(
      'Monsoon reversals, the Majapahit succession wars, and the first carracks rounding Malacca.',
      'Timed events flip the wind (favoring east- or west-bound fleets) and spawn foreign traders bidding for ports.',
    ),
    naval_warfare: af(
      'War here is fought rail-to-rail: grappling jongs, fire-arrows, and boarding parties in the narrows of Malacca and Makassar.',
      'Sea links require fleets to traverse and contest; naval dominance is the only path between most regions.',
    ),
    population_stability: af(
      'Overtaxed pepper villages riot; a glutted spice market starves the outer isles.',
      'Each territory tracks unrest; over-garrisoning or stripping income raises revolt risk that can flip an island neutral.',
    ),
    fog_of_war: af(
      'Beyond the horizon lie reef, squall, and pirate prahu — charts are worth their weight in cloves.',
      'Open-sea tiles hide enemy fleet strength until scouted; scouting ships reveal incoming armadas a turn early.',
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

const ROMAN_EMPIRE_117: CustomMapImmersionProfile = {
  map_id: 'community_roman_empire_117',
  tagline: 'All roads lead to Rome — and every legion wants to march on it.',
  backdrop:
    'The empire of Trajan at its greatest extent, from the mists of Britannia to the deserts of Mesopotamia. The Mediterranean is a Roman lake; the frontiers seethe with Germans, Dacians, and Parthians. Hold the purple, or rise from the provinces to seize it.',
  recommended_rules_era: 'ancient',
  advanced: {
    territory_draft: af(
      'Carve the provinces as the legions did — secure the grain of Aegypt and Africa before a rival does.',
      'Draft rewards locking Italia, the Aegyptian breadbasket, or a defensible frontier early.',
    ),
    asymmetric_factions: af(
      'Senatorial Rome, the frontier legions, and the client kingdoms each wage war by different rules.',
      'Factions feel distinct: heartland economy, legionary tempo, or frontier resilience.',
    ),
    economy_buildings: af(
      'Roads, aqueducts, and grain fleets turn provinces into a war machine.',
      'Economy rewards connected provinces — infrastructure compounds across the Mediterranean.',
    ),
    tech_trees: af(
      'Siege craft, road engineering, and legionary doctrine decide the frontier wars.',
      'Tech unlocks faster movement on roads, stronger sieges, and frontier defense bonuses.',
    ),
    historical_events: af(
      'Succession crises, frontier revolts, and Parthian wars ripple across the empire.',
      'Events swing reinforcements, stability, and frontier pressure — the Crisis is always one bad emperor away.',
    ),
    naval_warfare: af(
      'The Mediterranean sea-lanes bind the empire; control them to flank from Carthage to Cyprus.',
      'Naval play unlocks rapid redeployment and amphibious strikes across Mare Nostrum.',
    ),
    population_stability: af(
      'Bread and circuses keep the provinces loyal; tax them too hard and the legions revolt.',
      'Stability funds expansion — unrest in the heartland caps your campaigns.',
    ),
    fog_of_war: af(
      'Beyond the limes lies the barbaricum — scouts and frontier forts reveal the next incursion.',
      'Fog models the unknown frontier; ISR (scouting) the borders before the horde arrives.',
    ),
  },
};

const MONGOL_EMPIRE_1279: CustomMapImmersionProfile = {
  map_id: 'community_mongol_empire',
  tagline: 'One empire from the Pacific to the Danube — until the ulus break apart.',
  backdrop:
    'The year Kublai Khan drowned the last Song resistance. The largest land empire in history stretches from Goryeo to the Rus’ — Yuan China, the Mongol heartland, the Chagatai khanate, the Ilkhanate, and the Golden Horde. Reunite the ulus under one Khan, or shatter it into rival khanates.',
  recommended_rules_era: 'medieval',
  advanced: {
    territory_draft: af(
      'The khanates are divided among the sons of the line — claim your ulus before the kurultai turns to war.',
      'Draft rewards a contiguous khanate: China’s wealth, Persia’s cities, or the open steppe.',
    ),
    asymmetric_factions: af(
      'Settled Yuan China, the Persian Ilkhanate, and the nomad Horde fight by utterly different doctrines.',
      'Factions split along steppe vs. sown — cavalry tempo against fortified wealth.',
    ),
    economy_buildings: af(
      'The Silk Road and the Yam relay network turn a continent of cities into one treasury.',
      'Economy rewards holding trade arteries — connected provinces snowball.',
    ),
    tech_trees: af(
      'Horse archery, siege engineers from China, and the relay post define Mongol war.',
      'Tech unlocks unmatched movement, siege power, and reinforcement reach.',
    ),
    historical_events: af(
      'Succession kurultais, plague, and the fracture into four khanates loom over every campaign.',
      'Events swing unity and reinforcements — the empire is one disputed succession from civil war.',
    ),
    naval_warfare: af(
      'From the Yangtze to the Caspian, rivers and coasts flank the great land powers.',
      'Naval play opens river crossings and coastal raids on the settled south.',
    ),
    population_stability: af(
      'Tax the cities, spare the steppe — overreach and the conquered rise.',
      'Stability funds the next conquest; revolts in distant ulus bleed your armies.',
    ),
    fog_of_war: af(
      'Scouts range days ahead of the tumens across the open steppe.',
      'Fog rewards the faster scout — the Mongols always saw the enemy first.',
    ),
  },
};

const NAPOLEONIC_EUROPE: CustomMapImmersionProfile = {
  map_id: 'community_napoleonic_europe',
  tagline: 'From Lisbon to Moscow — the Grande Armée against a continent.',
  backdrop:
    'Europe in 1812, at the zenith of Napoleon’s power. The French Empire and its satellites face the grand coalition of Britain, Russia, Prussia, and Austria, while Spain bleeds the eagles white. March on the enemy capital — or hold the line at the Niemen.',
  recommended_rules_era: 'discovery',
  advanced: {
    territory_draft: af(
      'The Confederation of the Rhine, the satellites, and the coalition powers are divided before the campaign opens.',
      'Draft rewards a coherent bloc: the French core, the German middle, or the Russian depth.',
    ),
    asymmetric_factions: af(
      'Napoleonic France, the maritime British, and continental Russia each break the rules of war.',
      'Factions feel like grand strategy: offensive tempo, naval supremacy, or scorched-earth depth.',
    ),
    economy_buildings: af(
      'Conscription, the Continental System, and arsenals fuel total war.',
      'Economy rewards mobilization — production scales with held capitals and industry.',
    ),
    tech_trees: af(
      'Massed artillery, corps organization, and line-infantry drill decide the great battles.',
      'Tech unlocks attack tempo, combined-arms bonuses, and faster fortification.',
    ),
    historical_events: af(
      'The Spanish ulcer, the Russian winter, and shifting coalitions reshape the war.',
      'Events swing attrition, reinforcements, and diplomacy — the coalition can always reform.',
    ),
    naval_warfare: af(
      'Britannia rules the waves; the Channel and the Baltic decide who can be invaded.',
      'Naval play unlocks blockade, amphibious landings, and the defense of the isles.',
    ),
    population_stability: af(
      'Nationalism stirs in the occupied lands; overextend and the partisans rise.',
      'Stability funds the next offensive — unrest behind the lines bleeds the Grande Armée.',
    ),
    fog_of_war: af(
      'Cavalry screens and the fog of the great battlefield hide the decisive corps.',
      'Fog rewards reconnaissance — find the enemy army before it finds your flank.',
    ),
  },
};

const SENGOKU_JAPAN: CustomMapImmersionProfile = {
  map_id: 'community_sengoku_japan',
  tagline: 'Sixty provinces, one road to Kyōto — who will unify the realm?',
  backdrop:
    'Japan in the age of war, the Sengoku Jidai. From Satsuma to Ezo the great clans — Shimazu, Mōri, Oda, Takeda, Uesugi, Hōjō, Date, Tokugawa — contend for supremacy. March your banners on Kyōto and take the realm under heaven.',
  recommended_rules_era: 'medieval',
  advanced: {
    territory_draft: af(
      'The provinces are parcelled to the clans before the first castle falls.',
      'Draft rewards a defensible home province and a road toward the capital.',
    ),
    asymmetric_factions: af(
      'Coastal trade clans, mountain cavalry houses, and the central powers each fight by their own code.',
      'Factions feel like clan character: naval reach, cavalry shock, or central economy.',
    ),
    economy_buildings: af(
      'Castles, rice paddies, and the gold and silver mines bankroll the war of unification.',
      'Economy rewards rich home provinces — koku funds bigger armies.',
    ),
    tech_trees: af(
      'The matchlock, castle engineering, and massed ashigaru transform the battlefield.',
      'Tech unlocks firearms volleys, stronger castles, and faster levies.',
    ),
    historical_events: af(
      'Betrayals, peasant ikkō-ikki risings, and the arrival of the Europeans reshape the war.',
      'Events swing loyalty, reinforcements, and the firearms trade — treachery is a mechanic.',
    ),
    naval_warfare: af(
      'The Inland Sea and the straits divide the islands; fleets carry the war across the water.',
      'Naval play unlocks island crossings and blockades of the trade ports.',
    ),
    population_stability: af(
      'A loyal province feeds your armies; tax the rice too hard and the ikkō-ikki revolt.',
      'Stability funds campaigns — unrest at home stalls your march on the capital.',
    ),
    fog_of_war: af(
      'Shinobi scouts and mountain mists hide the enemy’s muster.',
      'Fog rewards the better-informed daimyō — scout before you commit the levy.',
    ),
  },
};

export const CUSTOM_MAP_IMMERSION: Record<string, CustomMapImmersionProfile> = {
  [FLOODED_NA.map_id]: FLOODED_NA,
  [ROMAN_EMPIRE_117.map_id]: ROMAN_EMPIRE_117,
  [MONGOL_EMPIRE_1279.map_id]: MONGOL_EMPIRE_1279,
  [NAPOLEONIC_EUROPE.map_id]: NAPOLEONIC_EUROPE,
  [SENGOKU_JAPAN.map_id]: SENGOKU_JAPAN,
  [CHARLEMAGNE_814.map_id]: CHARLEMAGNE_814,
  [USA_BALKAN.map_id]: USA_BALKAN,
  [CHINA_WARLORD.map_id]: CHINA_WARLORD,
  [INDIA_BALKAN.map_id]: INDIA_BALKAN,
  [AFRICA_UNCOL.map_id]: AFRICA_UNCOL,
  [SOUTHAM_BALKAN.map_id]: SOUTHAM_BALKAN,
  [JAPAN_DIVIDED.map_id]: JAPAN_DIVIDED,
  [RUSSIA_FRACTURED.map_id]: RUSSIA_FRACTURED,
  [BYZANTIUM_MEGALI.map_id]: BYZANTIUM_MEGALI,
  [SPAIN_BALKAN.map_id]: SPAIN_BALKAN,
  [NUSANTARA.map_id]: NUSANTARA,
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
