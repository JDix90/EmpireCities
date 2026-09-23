/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source: backend/src/game-engine/eras/*.ts, projected by
 * backend/src/game-engine/eras/factionCodex.ts.
 * Regenerate: pnpm -C backend exec tsx scripts/generateFactionCodex.ts
 *
 * Committed on purpose: the prerender script is plain Node and the build must
 * not depend on the live API. A backend test fails if this drifts from the era
 * definitions, so an edit here would be reverted by the next regeneration.
 */
export const FACTION_CODEX = [
  {
    "era_id": "ancient",
    "factions": [
      {
        "faction_id": "rome",
        "name": "Roman Republic",
        "description": "Disciplined legions — +1 reinforcement per turn, and one assault each turn costs Rome nothing.",
        "lore": "A republic forged through citizen armies, road networks, and relentless campaigning, Rome expands by turning conquest into administration.",
        "flavor_quote": "The Senate debates. The legions decide.",
        "color": "#c0392b",
        "passive_attack_bonus": 0,
        "reinforce_bonus": 1,
        "stability_recovery_bonus": 3,
        "ability_description": "Testudo Formation: once per turn during attack phase, negate all attacker losses on one combat exchange."
      },
      {
        "faction_id": "parthia",
        "name": "Parthian Empire",
        "description": "Mounted archers — whenever an attacker takes Parthian ground, the Parthian shot costs them one more unit.",
        "lore": "Ruling the Iranian plateau from horseback and caravan city alike, Parthia bleeds invaders with mobility rather than static walls.",
        "flavor_quote": "Strike, vanish, and let the desert finish the rest.",
        "color": "#8e44ad",
        "ability_description": "Parting Shot: after losing a territory, immediately deal 1 unit loss to the attacker."
      },
      {
        "faction_id": "han",
        "name": "Han Dynasty",
        "description": "Vast territory and organized bureaucracy generates +2 extra reinforcements per turn.",
        "lore": "The Han state binds frontier armies, granaries, and court officials into one of the ancient world's most enduring imperial machines.",
        "flavor_quote": "Order the provinces, and the empire feeds itself.",
        "color": "#e67e22",
        "reinforce_bonus": 2,
        "ability_description": "Silk Road: once per turn during draft, add +3 tech points."
      },
      {
        "faction_id": "maurya",
        "name": "Maurya Empire",
        "description": "War elephants — +1 attack die on every assault, and a second die once per turn.",
        "lore": "From the Ganges heartland, Mauryan rulers project authority through elephant corps, tax officials, and a centralized imperial court.",
        "flavor_quote": "When the elephants move, kingdoms tremble.",
        "color": "#27ae60",
        "passive_attack_bonus": 1,
        "ability_description": "War Elephants: once per turn, one attack roll uses 4 dice (max)."
      },
      {
        "faction_id": "carthage",
        "name": "Carthaginian Republic",
        "description": "A maritime trading power anchored in North Africa, reaching across the sea lanes.",
        "lore": "Merchant princes and admirals make Carthage rich, turning harbors and trade routes into weapons that reach across the sea.",
        "flavor_quote": "Gold on the docks is power on the battlefield.",
        "color": "#2980b9"
      },
      {
        "faction_id": "germanic_tribes",
        "name": "Germanic Tribes",
        "description": "Fierce forest fighters — one ambush each turn adds an attack die.",
        "lore": "Loose confederations of war bands and chieftains know every forest trail and river crossing, punishing empires that overextend.",
        "flavor_quote": "The woods are our walls.",
        "color": "#7f8c8d",
        "reinforce_bonus": 0,
        "ability_description": "Ambush: once per turn, attack from a border territory using 1 extra die."
      }
    ]
  },
  {
    "era_id": "medieval",
    "factions": [
      {
        "faction_id": "hre",
        "name": "Holy Roman Empire",
        "description": "Central European power — a standing imperial levy of +1 reinforcement per turn.",
        "lore": "A patchwork empire of princes, bishops, and free cities, the Reich survives by fortifying passes and bargaining for allegiance.",
        "flavor_quote": "An empire stitched together by crowns, charters, and stone.",
        "color": "#f39c12",
        "reinforce_bonus": 1,
        "ability_description": "Imperial Diet: once per turn during draft, gain +2 extra reinforcements per fully owned region."
      },
      {
        "faction_id": "mongol_empire",
        "name": "Mongol Khanate",
        "description": "Devastating cavalry charges — +1 attack die on every attack, +1 reinforcement per turn.",
        "lore": "Mounted couriers, disciplined tumens, and ruthless speed let the Mongols turn open ground into an empire-spanning highway.",
        "flavor_quote": "Ride before their walls learn your name.",
        "color": "#d35400",
        "passive_attack_bonus": 1,
        "reinforce_bonus": 1,
        "ability_description": "Horse Archers: once per turn, a volley removes 1 unit from an adjacent enemy territory without a full attack exchange."
      },
      {
        "faction_id": "byzantine",
        "name": "Byzantine Empire",
        "description": "A professional army on an imperial payroll — +1 attack die and +2 reinforcements per turn, with Greek fire held in reserve.",
        "lore": "Heir to Rome in ceremony and statecraft, Byzantium outlasts stronger foes through coin, diplomacy, and fortified capitals.",
        "flavor_quote": "Where steel fails, intrigue holds the line.",
        "color": "#8e44ad",
        "passive_attack_bonus": 1,
        "reinforce_bonus": 2,
        "stability_recovery_bonus": 3,
        "ability_description": "Greek Fire: once per turn, an attacking force loses 1 additional unit before dice are rolled."
      },
      {
        "faction_id": "caliphate",
        "name": "Abbasid Caliphate",
        "description": "Caravan wealth and a fortified capital — +1 reinforcement per turn, and +2 tech points where research is in play.",
        "lore": "Centered on great cities of scholarship and trade, the Abbasid world links caravan wealth to scientific ambition.",
        "flavor_quote": "Knowledge is a treasury that marches with the army.",
        "color": "#16a085",
        "reinforce_bonus": 1,
        "ability_description": "City of Peace: once per turn, the first attack against you is met with +2 defence dice."
      },
      {
        "faction_id": "france",
        "name": "Kingdom of France",
        "description": "Chivalric knights — cavalry units grant +1 attack die when attacking from a territory you also hold a neighbor of.",
        "lore": "Feudal levies and ambitious nobles give France explosive striking power once its domains are stitched into a coherent realm.",
        "flavor_quote": "When banners gather, the charge becomes law.",
        "color": "#3498db",
        "passive_attack_bonus": 1,
        "ability_description": "Chevauchée: once per turn, raze an enemy territory (reduce unit count by 2) without attacking."
      },
      {
        "faction_id": "england",
        "name": "Kingdom of England",
        "description": "Longbowmen add +1 attack die when attacking across a sea connection.",
        "lore": "An island kingdom of fleets, bowmen, and stubborn kings, England fights best when it controls the narrow points of approach.",
        "flavor_quote": "Let the channel narrow them and the arrows finish them.",
        "color": "#c0392b",
        "passive_attack_bonus": 1,
        "ability_description": "Longbowmen: once per turn, one ranged attack deals 1 unit loss to an adjacent enemy territory without a full attack exchange."
      }
    ]
  },
  {
    "era_id": "discovery",
    "factions": [
      {
        "faction_id": "spain",
        "name": "Spanish Empire",
        "description": "Conquistadors press the advantage — +1 attack die on every attack.",
        "lore": "Silver fleets, crusading zeal, and hard-edged conquistadors make Spain a transoceanic empire hungry for rapid expansion.",
        "flavor_quote": "Across the ocean lies another crown to claim.",
        "color": "#f39c12",
        "passive_attack_bonus": 1
      },
      {
        "faction_id": "portugal",
        "name": "Portuguese Empire",
        "description": "Masters of the sea — sea_lanes connections allow 3 attack dice (normally 2) and free sea-lane fortify moves.",
        "lore": "Portugal lives by charts, caravels, and coastal strongpoints, turning sea lanes into a private imperial network.",
        "flavor_quote": "Map the current, own the world beyond it.",
        "color": "#27ae60",
        "ability_description": "Naval Charts: your sea_lanes attacks use the full 3 dice cap instead of the era-limited 2."
      },
      {
        "faction_id": "ottoman",
        "name": "Ottoman Empire",
        "description": "Straddling east and west — +2 reinforcements per turn from controlling the mediterranean sea_routes region.",
        "lore": "From the Balkans to Arabia, Ottoman rule merges disciplined corps and strategic chokepoints into a continental hinge.",
        "flavor_quote": "Hold the straits, and empires must knock at your door.",
        "color": "#d35400",
        "reinforce_bonus": 2,
        "ability_description": "Janissaries: once per turn, defend with 3 dice regardless of garrison size."
      },
      {
        "faction_id": "england_discovery",
        "name": "English Crown",
        "description": "Privateers and merchant adventurers — +1 tech point per sea territory owned.",
        "lore": "A rising maritime kingdom, England weaponizes chartered companies, private raids, and coastal footholds into empire.",
        "flavor_quote": "Where merchants sail, the flag soon follows.",
        "color": "#c0392b",
        "ability_description": "Privateer: once per turn, steal 1 production unit from an adjacent enemy coastal territory."
      },
      {
        "faction_id": "ming_china",
        "name": "Ming Dynasty",
        "description": "Vast population and the Great Wall — +1 defense die in Asian territories.",
        "lore": "The Ming command enormous manpower and monumental defenses, preferring layered stability over reckless overreach.",
        "flavor_quote": "The empire endures because its walls are built in both stone and grain.",
        "color": "#e74c3c",
        "reinforce_bonus": 1,
        "stability_recovery_bonus": 3,
        "ability_description": "Great Wall: once per turn, prevent one attack from resolving (the attacker's turn is wasted)."
      },
      {
        "faction_id": "mughal",
        "name": "Mughal Empire",
        "description": "Rich subcontinent — generates +3 extra tech points per turn.",
        "lore": "Courtly wealth, gunpowder armies, and a mosaic of provinces make the Mughals formidable when prosperity is protected.",
        "flavor_quote": "Splendor is strongest when backed by cannon.",
        "color": "#9b59b6",
        "ability_description": "Spice Trade: once per turn, exchange 5 tech points for 2 extra reinforcements."
      }
    ]
  },
  {
    "era_id": "ww2",
    "factions": [
      {
        "faction_id": "germany",
        "name": "Third Reich",
        "description": "Blitzkrieg doctrine — after a successful capture, may make one immediate bonus attack per turn.",
        "lore": "A mechanized war machine built on shock and tempo, Germany seeks to collapse fronts before attrition can catch up.",
        "flavor_quote": "Break the line before the enemy remembers how wide it is.",
        "color": "#7f8c8d",
        "passive_attack_bonus": 1,
        "ability_description": "Blitzkrieg: once per turn, after capturing a territory immediately execute a free additional attack from that territory."
      },
      {
        "faction_id": "soviet_union",
        "name": "Soviet Union",
        "description": "Vast reserves — +2 reinforcements per turn, and once per game a mass mobilisation places five extra units.",
        "lore": "Factories beyond the Urals and endless manpower let the Soviet state trade land for time and return with crushing mass.",
        "flavor_quote": "If the first line falls, build a second behind it.",
        "color": "#c0392b",
        "reinforce_bonus": 2,
        "ability_description": "Mass Mobilization: once per game, place 5 extra units on any owned territory."
      },
      {
        "faction_id": "usa",
        "name": "United States",
        "description": "Industrial supremacy — +1 reinforcement per turn; where research is in play, the Arsenal of Democracy turns it into materiel.",
        "lore": "Protected by oceans and powered by industry, the United States converts economic depth into global military reach.",
        "flavor_quote": "Assembly lines win wars long before the landing craft arrive.",
        "color": "#3498db",
        "reinforce_bonus": 1,
        "ability_description": "Arsenal of Democracy: once per turn during draft, spend 5 production points to place 3 extra units."
      },
      {
        "faction_id": "uk",
        "name": "United Kingdom",
        "description": "Island fortress and global empire — recovers stability quickly in contested ground.",
        "lore": "Britain survives through naval control, imperial links, and the stubborn advantage of making every approach expensive.",
        "flavor_quote": "Rule the routes, and the island cannot be isolated.",
        "color": "#e74c3c",
        "stability_recovery_bonus": 3
      },
      {
        "faction_id": "japan",
        "name": "Imperial Japan",
        "description": "Pacific supremacy — +1 attack die on every assault, and a banzai charge adds another once per turn.",
        "lore": "Fast carrier warfare and aggressive expansion define Japan at its peak, where initiative matters more than margin for error.",
        "flavor_quote": "In the first storm of war, strike farther than they thought possible.",
        "color": "#e67e22",
        "passive_attack_bonus": 1,
        "ability_description": "Banzai Charge: once per turn, one attack exchange uses 4 attack dice (maximum)."
      },
      {
        "faction_id": "china_ww2",
        "name": "Chinese Nationalists",
        "description": "Guerrilla resistance — once per turn, a hidden reserve places a free unit on ground you hold.",
        "lore": "Fighting across fractured provinces, Chinese resistance depends on endurance, local knowledge, and refusing decisive collapse.",
        "flavor_quote": "Hold long enough, and the invader begins fighting the land itself.",
        "color": "#27ae60",
        "ability_description": "Guerrilla Warfare: once per turn, place 1 unit on any owned territory for free."
      }
    ]
  },
  {
    "era_id": "coldwar",
    "factions": [
      {
        "faction_id": "usa_cw",
        "name": "United States",
        "description": "Global superpower — +1 tech point per ally-adjacent territory; influence ability range extended to 2 hops.",
        "lore": "Carrier groups, development aid, and alliance architecture let Washington project power without occupying every frontline directly.",
        "flavor_quote": "Influence the map before the battle begins.",
        "color": "#3498db",
        "reinforce_bonus": 1,
        "stability_recovery_bonus": 3,
        "ability_description": "Marshall Plan: once per turn during draft, place 1 free unit on any allied or newly captured territory."
      },
      {
        "faction_id": "ussr",
        "name": "Soviet Union",
        "description": "Command economy and a hardened perimeter — +1 reinforcement per turn.",
        "lore": "The Soviet bloc hardens its perimeter through ideology, armor, and a security state built to absorb existential pressure.",
        "flavor_quote": "Depth, discipline, and doctrine hold the frontier.",
        "color": "#c0392b",
        "reinforce_bonus": 1
      },
      {
        "faction_id": "china_cw",
        "name": "People's Republic of China",
        "description": "Vast army — +2 reinforcements per turn; guerrilla tactics grant +1 defense die in Asia.",
        "lore": "Revolutionary legitimacy and mass mobilization give China resilience, especially when the fight becomes one of exhaustion.",
        "flavor_quote": "A long war favors the side that can renew itself.",
        "color": "#e74c3c",
        "reinforce_bonus": 2,
        "ability_description": "People's War: once per game, double your reinforcements for one turn."
      },
      {
        "faction_id": "uk_cw",
        "name": "United Kingdom",
        "description": "Nuclear deterrent — if attacked in your capital territory, attacker loses 1 extra unit.",
        "lore": "Postwar Britain holds disproportionate leverage through diplomacy, intelligence, and the menace of strategic reprisal.",
        "flavor_quote": "A smaller empire can still cast a long shadow.",
        "color": "#e67e22",
        "ability_description": "Nuclear Deterrence: once per game, cancel an attack against your capital territory entirely."
      },
      {
        "faction_id": "decolonization_movement",
        "name": "Non-Aligned Movement",
        "description": "Guerrilla movements challenge both superpowers — territories you own cannot be influenced (immune to influence_spread).",
        "lore": "Newly independent states and insurgent movements refuse to become pawns, thriving in the gaps between the blocs.",
        "flavor_quote": "We are not another square on someone else's board.",
        "color": "#27ae60",
        "reinforce_bonus": 1,
        "ability_description": "Guerrilla Resistance: once per turn, place 2 free units on any border territory that was attacked last turn."
      },
      {
        "faction_id": "nato_proxy",
        "name": "NATO Alliance",
        "description": "Collective defense pact — if any NATO territory is attacked, adjacent NATO territories each add +1 defense die.",
        "lore": "Interoperability, shared planning, and mutual guarantees make NATO strongest when it fights as a network instead of a nation.",
        "flavor_quote": "An attack on one border wakes every garrison.",
        "color": "#9b59b6",
        "ability_description": "Article 5: once per turn, an attack on any of your territories triggers +1 automatic defender loss on the attacker."
      }
    ]
  },
  {
    "era_id": "modern",
    "factions": [
      {
        "faction_id": "western_power",
        "name": "Western Bloc",
        "description": "Precision warfare — precision_strike is always active; +1 defense die from advanced body armor.",
        "lore": "Satellite eyes, expeditionary logistics, and precision doctrine define a bloc that wins by seeing and striking first.",
        "flavor_quote": "Information arrives before the soldiers do.",
        "color": "#3498db",
        "passive_attack_bonus": 1,
        "stability_recovery_bonus": 3,
        "ability_description": "Precision Airstrike: once per turn, deal 2 unit losses to any adjacent enemy territory without a full attack exchange."
      },
      {
        "faction_id": "eastern_bloc",
        "name": "Eastern Coalition",
        "description": "Armored mass — +2 reinforcements per turn; tanks let you move 2 extra units in fortify.",
        "lore": "Centralized command and armored depth give the coalition raw staying power once the battlefield hardens into fronts.",
        "flavor_quote": "Pressure is a weapon when it never stops.",
        "color": "#c0392b",
        "reinforce_bonus": 2,
        "ability_description": "Armored Push: once per turn, execute two fortify moves instead of one."
      },
      {
        "faction_id": "rogue_state",
        "name": "Rogue State",
        "description": "Asymmetric tactics — +1 defense die and immune to precision_strike attacker bonus.",
        "lore": "Sanctioned, isolated, and unpredictable, the Rogue State survives by turning every invasion into a trap of attrition and ambiguity.",
        "flavor_quote": "If they cannot predict us, they cannot dominate us.",
        "color": "#e74c3c",
        "ability_description": "Insurgency: once per turn, spawn 1 free unit in a border territory that was attacked this turn."
      },
      {
        "faction_id": "emerging_power",
        "name": "Emerging Economy",
        "description": "Rapid industrialization — earn 2 extra production units per turn from every territory with a production building.",
        "lore": "Factories, ports, and swelling cities let the Emerging Power convert growth itself into strategic momentum.",
        "flavor_quote": "Development is the quietest path to dominance.",
        "color": "#f39c12",
        "reinforce_bonus": 1,
        "ability_description": "Economic Boom: once per turn, pay 4 tech points to immediately place 2 units anywhere."
      },
      {
        "faction_id": "petro_state",
        "name": "Petrostate",
        "description": "Oil wealth — +3 tech points per turn; can buy an extra reinforcement for every 3 owned resource territories.",
        "lore": "Energy rents and patronage networks give the Petrostate immense bursts of leverage so long as the wells stay secure.",
        "flavor_quote": "Guard the fields and the world will bargain on your terms.",
        "color": "#e67e22",
        "ability_description": "Oil Wealth: once per turn, spend 6 tech points to place 3 extra units on any owned territory."
      },
      {
        "faction_id": "cyber_power",
        "name": "Cyber State",
        "description": "Digital warfare — once per turn, sabotage an adjacent enemy territory (remove 1 unit before combat).",
        "lore": "A state built on code, surveillance, and disruption, it weakens enemies by corrupting the systems that coordinate them.",
        "flavor_quote": "Why storm the gate when you can turn off the locks?",
        "color": "#9b59b6",
        "ability_description": "Cyber Attack: once per turn, remove 1 unit from an adjacent enemy territory without combat."
      }
    ]
  },
  {
    "era_id": "acw",
    "factions": [
      {
        "faction_id": "union",
        "name": "Union Army",
        "description": "Industrial north — +1 production unit per owned territory; rifle_doctrine applies universally.",
        "lore": "Railroads, factories, and a widening war aim let the Union grind toward victory through capacity as much as battlefield brilliance.",
        "flavor_quote": "Win the rails, and the armies will follow.",
        "color": "#3498db",
        "reinforce_bonus": 1,
        "stability_recovery_bonus": 3,
        "ability_description": "Total War: once per game, in one turn place double your normal reinforcements."
      },
      {
        "faction_id": "confederacy",
        "name": "Confederate Army",
        "description": "Fighting on interior lines — recovers stability quickly under pressure.",
        "lore": "Fighting on familiar ground, the Confederacy leans on interior lines, local commitment, and punishing defensive battles.",
        "flavor_quote": "Make every mile northward cost them twice.",
        "color": "#c0392b"
      }
    ]
  },
  {
    "era_id": "risorgimento",
    "factions": [
      {
        "faction_id": "sardinia_piedmont",
        "name": "Kingdom of Sardinia",
        "description": "The catalyst of Italian unification — carbonari_network influence costs 1 fewer unit; +1 reinforce in Piedmont.",
        "lore": "Savoyard reformers turn a compact northern kingdom into the diplomatic and military engine of Italian unification.",
        "flavor_quote": "Lead the peninsula, and history may call it destiny.",
        "color": "#27ae60",
        "reinforce_bonus": 1,
        "ability_description": "Unification Drive: once per turn, convert a neutral Italian territory within range at zero cost."
      },
      {
        "faction_id": "austria",
        "name": "Austrian Empire",
        "description": "Conservative power defending the old order — +2 defense dice in Austrian core territories.",
        "lore": "Vienna defends its Italian possessions through garrisons, dynastic legitimacy, and a deep instinct for suppressing revolt.",
        "flavor_quote": "Empires endure by refusing every easy concession.",
        "color": "#e74c3c",
        "reinforce_bonus": 1,
        "ability_description": "Habsburg Garrison: once per turn, immediately place 2 units in any Austrian-held territory under threat."
      },
      {
        "faction_id": "papal_states",
        "name": "Papal States",
        "description": "Spiritual influence — carbonari_network range is halved against Papal territories; +1 defense die.",
        "lore": "The Papal States wield spiritual authority and conservative loyalty, making central Italy as political as it is military.",
        "flavor_quote": "A throne is harder to storm when it claims heaven behind it.",
        "color": "#f1c40f",
        "stability_recovery_bonus": 3,
        "ability_description": "Papal Dispensation: once per turn, prevent one influence attempt against any Papal territory."
      },
      {
        "faction_id": "kingdom_naples",
        "name": "Kingdom of the Two Sicilies",
        "description": "Southern stronghold — +1 defense die; Garibaldi attack bonus is negated in Neapolitan territory.",
        "lore": "The Bourbon south is resilient, regional, and wary of northern revolution, relying on stubborn defense and local control.",
        "flavor_quote": "The south does not yield merely because the north arrives with flags.",
        "color": "#d35400",
        "ability_description": "Bourbon Resistance: once per game, prevent an enemy from capturing Sicily for one full turn."
      }
    ]
  },
  {
    "era_id": "space_age",
    "factions": [
      {
        "faction_id": "terran_federation",
        "name": "Terran Federation",
        "description": "Satellite-backed democracies — +1 attack die on every attack; +2 tech points and +2 stability recovery per turn; Satellite Uplink ability.",
        "lore": "A confederation of North Atlantic and European megastates bound together by shared orbital infrastructure and open data networks.",
        "flavor_quote": "Transparency is the sharpest weapon of the free.",
        "color": "#3498db",
        "passive_attack_bonus": 1,
        "stability_recovery_bonus": 2,
        "ability_description": "Satellite Uplink: once per turn, spend 4 tech points to place 2 units on an owned territory bordering an enemy."
      },
      {
        "faction_id": "sino_hegemony",
        "name": "Sino-Pacific Hegemony",
        "description": "Automated industry + AI command — +2 reinforcements per turn; +1 production per tech building each turn; AI Surge ability.",
        "lore": "A tightly integrated Asia-Pacific bloc where AI planners schedule factory output, logistics, and troop rotations with ruthless efficiency.",
        "flavor_quote": "The machine does not sleep; neither does the empire.",
        "color": "#c0392b",
        "reinforce_bonus": 2,
        "ability_description": "AI Surge: once per turn, spend 5 tech points to place 3 units on any owned territory."
      },
      {
        "faction_id": "climate_alliance",
        "name": "Climate Alliance",
        "description": "Terraforming doctrine — +4 stability recovery per turn; population grows twice as fast; Terraform ability.",
        "lore": "Born from the flooded coastlines and dust belts of the late 21st century, the Alliance treats ecological repair as a strategic weapon.",
        "flavor_quote": "We build the future in soil, not steel.",
        "color": "#16a085",
        "stability_recovery_bonus": 4,
        "ability_description": "Terraform: once per turn, restore stability to 100 in an owned territory and gain 1 free unit there."
      },
      {
        "faction_id": "corpo_enclave",
        "name": "Corporate Enclave",
        "description": "Private militaries and techno-capitalism — +4 tech points per turn; Mercenary Contract ability (6 tech points).",
        "lore": "Post-state megacorporations ruling sovereign coastal cities, blurring the boundary between shareholders and citizens.",
        "flavor_quote": "Loyalty is a line item, not a virtue.",
        "color": "#9b59b6",
        "ability_description": "Mercenary Contract: once per turn, spend 6 tech points to place 4 units on any territory you own that has a production building."
      },
      {
        "faction_id": "solar_caliphate",
        "name": "Solar Caliphate",
        "description": "Energy hegemony of the post-petroleum age — +1 reinforcement per turn; Solar Surge ability.",
        "lore": "A post-petroleum coalition of Gulf and Central Asian states that turned their deserts into the energy heart of the 22nd century.",
        "flavor_quote": "The sun no longer rises in the East; it is owned there.",
        "color": "#f39c12",
        "reinforce_bonus": 1,
        "ability_description": "Solar Surge: once per turn, place 1 unit on an owned territory and gain 2 production."
      },
      {
        "faction_id": "lunar_pioneers",
        "name": "Lunar Pioneers",
        "description": "Moon-native colonists — start with a Launch Pad and Moon access from turn one; +1 reinforcement per turn; +2 defense dice on Moon territories; Lunar Supply Drop ability.",
        "lore": "Descendants of the first permanent lunar settlers, the Pioneers see Earth as a gravity well they are no longer obligated to return to.",
        "flavor_quote": "We do not look up at the stars. We live among them.",
        "color": "#bdc3c7",
        "reinforce_bonus": 1,
        "ability_description": "Lunar Supply Drop: once per turn, drop 2 units into any owned Moon territory."
      }
    ]
  },
  {
    "era_id": "galaxy_age",
    "factions": [
      {
        "faction_id": "stellar_mandate",
        "name": "Stellar Mandate",
        "description": "Central admiralty doctrine — Sol III is the cradle: deeper reinforcement on its systems and a population that replaces what it loses. Blockade runners ignore lane seals.",
        "lore": "The Mandate believes stability flows from a single chain of command spanning every recognized star system.",
        "flavor_quote": "Order is not imposed — it is synchronized.",
        "color": "#5dade2",
        "ability_description": "Blockade Runner: once per turn, your next attack across a hyperspace lane ignores an Emergency Seal."
      },
      {
        "faction_id": "forge_syndicate",
        "name": "Forge Syndicate",
        "description": "Industrial cartels — shipyard logistics deliver +1 reinforcement per turn and Jump Gates at half price; supply inserts on demand.",
        "lore": "Shipyards and foundries form the true border between civilization and the dark between stars.",
        "flavor_quote": "We sell the hulls that empires die in.",
        "color": "#e67e22",
        "reinforce_bonus": 2,
        "ability_description": "Supply Insert: once per turn, place 1 free unit on an owned territory."
      },
      {
        "faction_id": "helion_navigators",
        "name": "Helion Navigators",
        "description": "Lane-mappers and drift pilots — every gateway in the galaxy stays visible to them, and their fleets jump between their own gateways.",
        "lore": "Their astrogators tape gravimetric shoals the way ancient sailors mapped reefs.",
        "flavor_quote": "The void has currents; we read them.",
        "color": "#2ecc71",
        "ability_description": "Drift Jump: once per turn, fortify between two gateways you hold on different worlds with no connecting route."
      },
      {
        "faction_id": "void_custodians",
        "name": "Void Custodians",
        "description": "Station enginseers — +1 defence die against any attack across a lane; faster stability recovery. Nexus Station's Gate Ring is the Vault: hold all four tiles for +2 tech per turn and an Emergency Seal on any lane.",
        "lore": "They guard the silent rings and tether cities where vacuum is the only neighbor.",
        "flavor_quote": "We keep the dark from leaning in.",
        "color": "#9b59b6",
        "stability_recovery_bonus": 2,
        "ability_description": "Emergency Seal: once per turn, close any hyperspace lane touching Nexus Station to everyone else for one round."
      }
    ]
  }
];

/** Total factions across every era — for copy that quotes a count. */
export const FACTION_COUNT = 52;
