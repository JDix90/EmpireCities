# Borderfall — Lore & Maps Catalog

This document is a **player-facing and design-facing reference** for narrative framing, official map blurbs, and mechanical hooks that appear in the shipped application as of the repository state when the file was authored.

**Sources of truth in code**

| Layer | Location |
|--------|-----------|
| Era UI labels (year, color, short pitch) | `frontend/src/services/mapService.ts` → `ERA_METADATA` |
| Official era map titles & descriptions | `database/maps/era_*.json` (`name`, `description`) |
| Faction lore, quotes, passives, abilities | `backend/src/game-engine/eras/*.ts` → `*_FACTIONS` |
| Tech names & descriptions | Same files → `*_TECH_TREE` |
| Era wonders | Same files → `*_WONDER` |
| Global era combat modifiers | `backend/src/game-engine/state/gameStateManager.ts` → `ERA_DEFAULTS` |
| Regional map card copy | `frontend/src/data/regionalMaps.ts` |
| Curated custom-map immersion (advanced-settings flavor) | `frontend/src/data/customMapImmersion.ts` |
| Lobby display titles for some community IDs | `frontend/src/constants/gameLobbyLabels.ts` → `COMMUNITY_MAP_TITLES` |

Mechanical numbers (dice, costs) can change in balance patches; **lore strings** below are transcribed from the codebase at authoring time.

---

## Part A — Historical eras (rulesets)

Each era is a **rules bundle**: factions (if enabled), tech tree, event deck flavor, optional era-wide combat modifiers, and one **era wonder** building type.

### Global era modifiers (`ERA_DEFAULTS`)

These are applied on top of faction passives when the era is active:

| Era | Modifier | Meaning (high level) |
|-----|----------|----------------------|
| `ancient` | `legion_reroll: true` | Roman legion doctrine: attacker may re-roll lowest attack die. |
| `medieval` | _(none)_ | Baseline medieval; power comes from factions/tech. |
| `discovery` | `sea_lanes: true` | Sea-lane attacks use fewer dice by default; tech/cartography can restore full dice. |
| `ww2` | `wartime_logistics: true` | Extra fortify mobility (logistics pressure). |
| `coldwar` | `influence_spread: true`, `influence_range: 1` | Influence special action with limited hop range (extendable by tech/factions). |
| `modern` | `precision_strike: true` | Precision airstrike-style actions when thresholds met. |
| `acw` | `rifle_doctrine: true` | Rifled combat: tied dice re-roll behavior for period firefights. |
| `risorgimento` | `carbonari_network: true`, `influence_range: 1` | Secret-society influence network on the Italian peninsula. |
| `space_age` | `space_program: true` | Orbital / lunar program gates and Moon-facing play. |

`custom` is not a gameplay ruleset; it is a lobby label for user-uploaded or non-era-tagged maps.

---

### Ancient World (`ancient`) — UI: ~200 AD

**Pitch (`ERA_METADATA`)**  
Command the legions of Rome, the cavalry of Parthia, or the armies of Han China.

**Official map** — `era_ancient` (`database/maps/era_ancient.json`)  
- **Name:** Ancient World (200 AD)  
- **Description:** The world at the height of the Roman Empire. Command the legions of Rome, the cavalry of Parthia, the armies of Han China, or the warriors of the Eurasian Steppe.

**Factions** (`ANCIENT_FACTIONS`)

| Faction | Lore (summary) | Flavor quote | Signature notes |
|---------|------------------|--------------|-------------------|
| Roman Republic | Citizen armies, roads, relentless campaigning; conquest becomes administration. | “The Senate debates. The legions decide.” | Testudo ability; legion tactics stack with era reroll. |
| Parthian Empire | Plateau + caravan cities; mobility over walls. | “Strike, vanish, and let the desert finish the rest.” | Parting shot after losses. |
| Han Dynasty | Granaries, frontier armies, enduring imperial machine. | “Order the provinces, and the empire feeds itself.” | Silk Road tech income spike. |
| Maurya Empire | Ganges heartland, elephants, centralized court. | “When the elephants move, kingdoms tremble.” | War elephant burst attack. |
| Carthaginian Republic | Merchants + admirals; sea as weapon. | “Gold on the docks is power on the battlefield.” | Naval supremacy fortify pattern. |
| Germanic Tribes | Forest confederations punish overextension. | “The woods are our walls.” | Ambush tempo. |

**Wonder — The Colosseum** (`ANCIENT_WONDER`)  
*Spectacles of power: +1 defense die in all territories you own.*

---

### Medieval World (`medieval`) — UI: ~1200 AD

**Pitch**  
Lead the Mongol hordes, defend the Holy Land, or build a Silk Road empire.

**Official map** — `era_medieval`  
- **Name:** Medieval World (1200 AD)  
- **Description:** The age of the Mongol conquests, Crusades, and feudal kingdoms. Lead the Mongol hordes, defend the Holy Land, or build a trading empire across the Silk Road.

**Factions** (`MEDIEVAL_FACTIONS`)

| Faction | Lore (summary) | Flavor quote |
|---------|------------------|--------------|
| Holy Roman Empire | Princes, bishops, free cities; fortify passes, bargain allegiance. | “An empire stitched together by crowns, charters, and stone.” |
| Mongol Khanate | Couriers, tumens, speed as empire. | “Ride before their walls learn your name.” |
| Byzantine Empire | Heir to Rome in ceremony; coin + Greek fire. | “Where steel fails, intrigue holds the line.” |
| Abbasid Caliphate | Scholarship + caravan wealth. | “Knowledge is a treasury that marches with the army.” |
| Kingdom of France | Feudal levies, explosive striking power when unified. | “When banners gather, the charge becomes law.” |
| Kingdom of England | Fleets, bowmen, narrow seas. | “Let the channel narrow them and the arrows finish them.” |

**Wonder — Notre-Dame** (`MEDIEVAL_WONDER`)  
*Divine authority rallies the faithful: +2 reinforcements per turn globally.*

---

### Age of Discovery (`discovery`) — UI: ~1600 AD

**Pitch**  
Command the Spanish Armada, Portuguese spice fleets, or Ottoman janissaries.

**Official map** — `era_discovery`  
- **Name:** Age of Discovery (1600 AD)  
- **Description:** The world in the age of colonial empires and global sea trade. Command the Spanish Armada, Portuguese spice fleets, Ottoman janissaries, or Mughal cavalry across a world being reshaped by exploration.

**Factions** (`DISCOVERY_FACTIONS`)

| Faction | Lore (summary) | Flavor quote |
|---------|------------------|--------------|
| Spanish Empire | Silver fleets, crusading zeal, conquistador tempo. | “Across the ocean lies another crown to claim.” |
| Portuguese Empire | Charts, caravels, coastal strongpoints. | “Map the current, own the world beyond it.” |
| Ottoman Empire | Balkans-to-Arabia hinge; straits as power. | “Hold the straits, and empires must knock at your door.” |
| English Crown | Chartered companies, private raids, footholds. | “Where merchants sail, the flag soon follows.” |
| Ming Dynasty | Manpower + Great Wall layered stability. | “The empire endures because its walls are built in both stone and grain.” |
| Mughal Empire | Courtly wealth + gunpowder armies. | “Splendor is strongest when backed by cannon.” |

**Wonder — Lighthouse of Alexandria** (`DISCOVERY_WONDER`)  
*Guiding beacon of navigation: sea-lane attacks use 3 dice instead of 2.*

---

### World War II (`ww2`) — UI: 1939–1945

**Pitch**  
Lead the Wehrmacht, Allied forces, Soviet Red Army, or Imperial Japan.

**Official map** — `era_ww2`  
- **Name:** World War II (1939–1945)  
- **Description:** The greatest conflict in human history. Command the Wehrmacht across Europe, lead the Allied landings, defend the Pacific with Japan, or push back with the Soviet Red Army on the Eastern Front.

**Factions** (`WW2_FACTIONS`)

| Faction | Lore (summary) | Flavor quote |
|---------|------------------|--------------|
| Third Reich | Shock + tempo; collapse fronts before attrition. | “Break the line before the enemy remembers how wide it is.” |
| Soviet Union | Factories beyond the Urals; trade land for time. | “If the first line falls, build a second behind it.” |
| United States | Oceans + industry → global reach. | “Assembly lines win wars long before the landing craft arrive.” |
| United Kingdom | Naval control + imperial links; expensive approaches. | “Rule the routes, and the island cannot be isolated.” |
| Imperial Japan | Carrier tempo; initiative over margin. | “In the first storm of war, strike farther than they thought possible.” |
| Chinese Nationalists | Fractured provinces; endurance + locality. | “Hold long enough, and the invader begins fighting the land itself.” |

**Wonder — Manhattan Project** (`WW2_WONDER`)  
*Industrial supremacy: +2 flat reinforcement units per turn for the owner.*

---

### Cold War (`coldwar`) — UI: 1947–1991

**Pitch**  
Command NATO or the Warsaw Pact, fight proxy wars, or play the Non-Aligned Movement.

**Official map** — `era_coldwar`  
- **Name:** Cold War (1947–1991)  
- **Description:** The world divided between two superpowers. Command NATO forces in Western Europe, lead the Soviet bloc, fight proxy wars in Korea, Vietnam, and Africa, or play the Non-Aligned Movement as a kingmaker.

**Factions** (`COLDWAR_FACTIONS`)

| Faction | Lore (summary) | Flavor quote |
|---------|------------------|--------------|
| United States | Carriers, aid, alliance architecture. | “Influence the map before the battle begins.” |
| Soviet Union | Ideology, armor, security state depth. | “Depth, discipline, and doctrine hold the frontier.” |
| PRC | Mass mobilization + revolutionary legitimacy. | “A long war favors the side that can renew itself.” |
| United Kingdom | Deterrence, intelligence, disproportionate shadow. | “A smaller empire can still cast a long shadow.” |
| Non-Aligned Movement | Independence + insurgency in bloc gaps. | “We are not another square on someone else's board.” |
| NATO Alliance | Interoperability; network defense. | “An attack on one border wakes every garrison.” |

**Wonder — Sputnik** (`COLDWAR_WONDER`)  
*Eyes in the sky: +1 tech point per owned territory per turn.*

---

### The Modern Day (`modern`) — UI: 2025 (`ERA_METADATA`)

**Pitch**  
Command modern superpowers, build alliances, and dominate the 21st-century geopolitical landscape.

**Official map** — `era_modern`  
- **Name:** The Modern Day  
- **Description:** The world as it stands today. Command the United States, lead the European Union, direct the rising power of China, build alliances across Africa, or dominate the Pacific Rim in a struggle for 21st-century supremacy.

**Factions** (`MODERN_FACTIONS`)

| Faction | Lore (summary) | Flavor quote |
|---------|------------------|--------------|
| Western Bloc | Satellites + expeditionary precision. | “Information arrives before the soldiers do.” |
| Eastern Coalition | Centralized command + armored depth. | “Pressure is a weapon when it never stops.” |
| Rogue State | Sanctions, ambiguity, attrition traps. | “If they cannot predict us, they cannot dominate us.” |
| Emerging Economy | Ports + factories; growth as strategy. | “Development is the quietest path to dominance.” |
| Petrostate | Energy rents; leverage while wells hold. | “Guard the fields and the world will bargain on your terms.” |
| Cyber State | Code + disruption; weaken coordination. | “Why storm the gate when you can turn off the locks?” |

**Wonder — CERN** (`MODERN_WONDER`)  
*Particle accelerator breakthroughs: research all T1/T2 tech nodes at half cost.*

---

### American Civil War (`acw`) — UI: 1861–1865

**Pitch**  
Union versus Confederacy across theaters.

**Official map** — `era_acw`  
- **Name:** American Civil War (1861–1865)  
- **Description:** Union versus Confederacy: fight for the Eastern Theater, the Mississippi, and the Trans-Mississippi West.

**Factions** (`ACW_FACTIONS`)

| Faction | Lore (summary) | Flavor quote |
|---------|------------------|--------------|
| Union Army | Rails, factories, widening war aim. | “Win the rails, and the armies will follow.” |
| Confederate Army | Interior lines + punishing defense. | “Make every mile northward cost them twice.” |

**Wonder — The Great Arsenal** (`ACW_WONDER`)  
*Industrial might of the North: +3 units per turn flat bonus.*

---

### Italian Unification (`risorgimento`) — UI: 1859–1871 (`ERA_METADATA`)

**Pitch**  
Risorgimento Italy: Piedmont, the Two Sicilies, Papal States, and Austrian Italy on a peninsula-scale map.

**Official map** — `era_risorgimento`  
- **Name:** Italian Unification (1859–1871)  
- **Description:** Risorgimento Italy: from Piedmont and the Two Sicilies to a united kingdom. Territories follow modern provincial outlines grouped into historical regions.

**Factions** (`RISORGIMENTO_FACTIONS`)

| Faction | Lore (summary) | Flavor quote |
|---------|------------------|--------------|
| Kingdom of Sardinia | Reformist north as unification engine. | “Lead the peninsula, and history may call it destiny.” |
| Austrian Empire | Garrisons + dynastic legitimacy. | “Empires endure by refusing every easy concession.” |
| Papal States | Spiritual authority; central Italy politics. | “A throne is harder to storm when it claims heaven behind it.” |
| Kingdom of the Two Sicilies | Bourbon south; stubborn regional control. | “The south does not yield merely because the north arrives with flags.” |

**Wonder — Unification Monument** (`RISORGIMENTO_WONDER`)  
*Symbol of a united Italy: +2 influence range for Cold War mechanics.*

---

### Space Age (`space_age`) — UI: 2100 AD (`ERA_METADATA`)

**Pitch**  
Projected 2100 Earth with lunar territories — research Lunar Expansion, build a Launch Pad, and launch a Space Station to claim the Moon.

**Official map** — `era_space_age`  
- **Name:** Space Age (2100 AD)  
- **Description:** The world as it may be in 2100 — climate-reshaped borders, corporate enclaves, planetary megastates — plus a second globe representing a contested lunar surface. Research Lunar Expansion, build a Launch Pad, and launch your Space Station to claim the Moon.

**Factions** (`SPACE_AGE_FACTIONS`)

| Faction | Lore (summary) | Flavor quote |
|---------|------------------|--------------|
| Terran Federation | Orbital infrastructure + open data. | “Transparency is the sharpest weapon of the free.” |
| Sino-Pacific Hegemony | AI planners + automated industry. | “The machine does not sleep; neither does the empire.” |
| Climate Alliance | Ecological repair as strategy. | “We build the future in soil, not steel.” |
| Corporate Enclave | Post-state coastal cities; shareholder loyalty. | “Loyalty is a line item, not a virtue.” |
| Solar Caliphate | Desert solar + hydrogen economy. | “The sun no longer rises in the East; it is owned there.” |
| Lunar Pioneers | Moon-native colonists; Earth as gravity well. | “We do not look up at the stars. We live among them.” |

**Wonder — Space Elevator** (`SPACE_AGE_WONDER`)  
*Tethered orbital ribbon — Moon access requires only Lunar Expansion tech + Launch Pad (skips Space Station launch).*

---

## Part B — Official built-in maps (by `map_id`)

These are the **system** maps shipped under `database/maps/era_*.json` and surfaced via `GET /api/maps/eras` for the Map Hub “Historical Era Maps” grid.

| `map_id` | Name & one-line pitch (from JSON / `ERA_METADATA`) |
|----------|-----------------------------------------------------|
| `era_ancient` | Ancient World (200 AD) — classical empires at maximum reach. |
| `era_medieval` | Medieval World (1200 AD) — Mongols, crusades, Silk Road. |
| `era_discovery` | Age of Discovery (1600 AD) — colonial competition + sea trade. |
| `era_ww2` | World War II — global total war. |
| `era_coldwar` | Cold War — bipolar world + proxies. |
| `era_modern` | The Modern Day — contemporary multipolar struggle. |
| `era_acw` | American Civil War — two nations, interior lines. |
| `era_risorgimento` | Italian Unification — peninsula provinces as gameplay regions. |
| `era_space_age` | Space Age — Earth 2100 plus **Moon** territories (`globe_id`), launch pad / station / lunar expansion tech branch. |

**Tutorial** (not in Map Hub list but present in app)  
- Map id `tutorial` and WW2 tutorial variant are defined in `backend/src/game-engine/tutorial/tutorialScript.ts` — scripted teaching flow rather than sandbox lore catalog.

---

## Part C — Curated regional & featured community theaters

These maps use **custom geometry** (often with `projection_bounds` / `globe_view`) and may recommend a **rules era** in the lobby via `frontend/src/data/customMapImmersion.ts`.

### Regional Map Hub entries (`REGIONAL_MAPS`)

| `map_id` | Display name | Year tag | Card description |
|----------|----------------|----------|-------------------|
| `community_flooded_north_america` | Flooded North America | Alt-2100 | Climate-collapse North America: inland seas, fractured coastlines; hold mountain arcs, bay citadels, island corridors. |
| `community_britain_925` | Great Britain 925 A.D. | 925 AD | Anglo-Saxon, Viking, Welsh, Scottish patchwork; heartland vs Celtic fringes. |
| `community_horn_africa` | Horn of Africa & Yemen | Alt-History | Socialist Union spanning Ethiopia, Somalia, Eritrea, Djibouti, southern Yemen. |
| `community_australia_1337` | Karkiyapani & Aotearoa 1337 | 1337 AD | Alternate indigenous Australian polities + Aotearoa + Pacific neighbors as territorial states. |

### Featured community theaters (Mongo seed / static DB; titles in lobby)

| `map_id` | Lobby title | Notes |
|----------|---------------|--------|
| `community_14_nations` | The 14 Nations | North America as fourteen peer powers; globe uses admin-1 geometry (`GlobeMap` / `globeTerritoryGeometry`). |
| `community_strait_hormuz` | Strait of Hormuz | Gulf chokepoint theater; admin-1 subset for coastlines. |

### Immersion profiles (verbatim from `customMapImmersion.ts`)

Lobby tooltips combine each feature’s **lore** + **effectFlavor** with the base rules text (`advancedFeatureTooltip`). Below is the full immersion copy for the six curated maps.

#### `community_flooded_north_america` — recommended era: `modern`

- **Tagline:** Rise from drowned valleys — trade arcs, citadels, and exile fleets.
- **Backdrop:** After the great inundation, North America is a lattice of inland seas and shattered ranges. Survivor states cling to high ground; whoever controls ports, narrows, and hydro-corridors controls the continent’s ghost economy.
- **territory_draft** — *Lore:* Neutral high ground is the prize — powers carve spheres before the first shot. *How it feels:* Draft favors coastal citadels and choke islands; early borders echo real geography under water.
- **asymmetric_factions** — *Lore:* Mountain republics, bay fleets, and desert enclaves each bring a distinct doctrine to the drowned world. *How it feels:* Faction bonuses read as regional survival perks: logistics, defense in narrows, or rapid island hops.
- **economy_buildings** — *Lore:* Hydro-farms, desalination, and fortified ports are the spine of post-flood civilization. *How it feels:* Production and wonders feel like reclaiming infrastructure — income spikes along restored trade spines.
- **tech_trees** — *Lore:* Salvaged engineering, climate tech, and hardened logistics define who thrives above the new sea level. *How it feels:* Research gates coastal batteries, faster reinforcement along sea lanes, and crisis-response perks.
- **historical_events** — *Lore:* Storm surges, refugee waves, and relic dam failures keep every era unstable. *How it feels:* Events hit as environmental and political shocks — production swings, stability shocks, sudden truce pressure.
- **naval_warfare** — *Lore:* The map is half ocean; fleets are how empires breathe between archipelagos. *How it feels:* Naval income and amphibious pressure mirror island-hopping across drowned plains and sounds.
- **population_stability** — *Lore:* Crowded enclaves and salt-stressed cities riot or thrive on rationing and morale. *How it feels:* Stability caps and recovery echo refugee logistics — coastal holds swing harder when contested.
- **fog_of_war** — *Lore:* Storms, sensor gaps, and smuggler smoke hide fleet movements between fractured coasts. *How it feels:* Fog hides unit stacks beyond your archipelago rim — scouting archipelagos matters as much as brute force.

#### `community_britain_925` — recommended era: `medieval`

- **Tagline:** Heptarchy blood-oaths — shield-walls, longships, and crown claims.
- **Backdrop:** Britain in 925 is a patchwork of Anglo-Saxon kingdoms, Norse footholds, Welsh fastnesses, and Scottish raids. Every shire is a borderland; every coast hears oars before dawn.
- **territory_draft** — *Lore:* Jarls and ealdormen pick heartlands before the fyrd marches — the scramble for Mercia and Northumbria begins in ink, not iron. *How it feels:* Draft lets you anchor in Welsh hills, Danelaw coasts, or the southern wheat belt before random warbands spread.
- **asymmetric_factions** — *Lore:* Wessex consolidation, Viking sea-kings, Welsh mountain princes — each crown fights differently. *How it feels:* Faction passives feel like saga gifts: shield-wall defense, raid tempo, or hill-fort stubbornness.
- **economy_buildings** — *Lore:* Burhs, monastic granaries, and coastal salt-works fund the endless shield-tax. *How it feels:* Buildings read as burh rings and monastic wealth — production rewards holding the fertile midlands and safe harbors.
- **tech_trees** — *Lore:* Iron rivets, longship upgrades, and royal charters drag Britain from raid economy to kingdom. *How it feels:* Tech unlocks heavier fortification, better coastal muster, and faster recovery after Viking burns.
- **historical_events** — *Lore:* Famine winters, saintly omens, and sudden longship landings rewrite the year’s story. *How it feels:* Events model harvest prayer, cattle plague, and oath-breaking — spikes of loss or windfall across shires.
- **naval_warfare** — *Lore:* The Irish Sea and Channel mouths are Viking highways; whoever owns the waves owns the harvest coast. *How it feels:* Fleets and ports make Danelaw corridors lethal — sea connections are raids-in-waiting.
- **population_stability** — *Lore:* Peasants flee burning burhs; stability is the peace between harvest and reaving. *How it feels:* Low stability is fyrd exhaustion; recovery is the king’s justice returning to the shire.
- **fog_of_war** — *Lore:* Mist moors and forest tracks hide warbands until the ravens rise. *How it feels:* Fog hides muster sizes in the Welsh marches and Scottish edges — scouts earn their silver.

#### `community_horn_africa` — recommended era: `coldwar`

- **Tagline:** Red Sea socialism — federated steel, coffee coasts, and desert frontiers.
- **Backdrop:** A unified Horn and southern Yemen imagines a federated socialist state bridging highlands, nomad corridors, and the Bab el-Mandeb choke. Ideology, logistics, and clan loyalties pull in three directions at once.
- **territory_draft** — *Lore:* Revolutionary committees parcel the federation before the first congress — who claims the Ogaden, the coast, the highlands? *How it feels:* Draft reflects competing visions: coastal trade, highland defense, or Red Sea projection.
- **asymmetric_factions** — *Lore:* Highland defense cadres, coastal planners, and desert federators each embody a pillar of the union. *How it feels:* Factions map to doctrine: stability-first, naval outreach, or rapid mobilization along porous borders.
- **economy_buildings** — *Lore:* Collective farms, ports, and industrial nodes are the five-year plan made concrete. *How it feels:* Economy feels like planned development — bonuses cluster on choke ports and breadbasket highlands.
- **tech_trees** — *Lore:* Soviet-adjacent aid, local innovation, and Red Sea radar nets drag the union into modernity. *How it feels:* Tech unlocks better logistics, influence projection, and crisis-response along long supply lines.
- **historical_events** — *Lore:* Drought diplomacy, Gulf crises, and solidarity congresses keep the federation on a knife edge. *How it feels:* Events are coups of fortune: aid convoys, border incidents, and ideological purges that swing production.
- **naval_warfare** — *Lore:* The map is a hinge between seas — convoys, blockades, and gunboat politics are existential. *How it feels:* Naval play mirrors Bab el-Mandeb reality — whoever parks fleets shapes Yemen and Somali coasts alike.
- **population_stability** — *Lore:* Multi-ethnic federation means loyalty is earned every harvest; stability is the union’s true currency. *How it feels:* Stability swings echo pastoral stress and urban unrest — coastal cities recover faster with ports secured.
- **fog_of_war** — *Lore:* Sandstorms, smuggler dhows, and radio silence cloak troop movements along desert seams. *How it feels:* Fog hides buildups on the Ogaden and Red Sea rims — intel wins before armor rolls.

#### `community_australia_1337` — recommended era: `discovery`

- **Tagline:** Karkiyapani crowns — songlines, trade winds, and island thrones.
- **Backdrop:** An alternate 1337 where Indigenous Australian polities, Aotearoa, and Pacific neighbors appear as structured realms. The continent is a web of trade winds, fire-country, and reef gates — empire is kinship scaled to geography.
- **territory_draft** — *Lore:* Elders and voyaging captains choose ceremonial grounds before the great gatherings arm. *How it feels:* Draft lets you anchor reef nations, desert trade hubs, or Aotearoa’s volcanic north before the map colors.
- **asymmetric_factions** — *Lore:* Each realm’s law and lore grant different blessings — sea mastery, desert endurance, or island unity. *How it feels:* Factions read as cultural strengths: reef raiders, inland law-holders, or double-hulled navigators.
- **economy_buildings** — *Lore:* Ceremonial trade houses, fish weirs, and stone storehouses turn songlines into surplus. *How it feels:* Buildings feel like sustainable extraction — bonuses along coasts and reliable river basins.
- **tech_trees** — *Lore:* Voyaging astronomy, hardened hulls, and seasonal calendars push fleets farther each generation. *How it feels:* Tech unlocks longer sea reach, safer harvests, and faster recovery after fire-season or storm.
- **historical_events** — *Lore:* El Niño hunger, sacred site disputes, and voyaging omens rewrite the year’s luck. *How it feels:* Events are natural and cultural — reef bleaching, trade wind shifts, or alliance ceremonies.
- **naval_warfare** — *Lore:* The theater is ocean-braided; outriggers and war canoes are sovereignty made hull. *How it feels:* Naval bonuses reward island chains and reef passages — amphibious play is the default tempo.
- **population_stability** — *Lore:* Populations move with seasons; stability is harmony between fire, water, and law. *How it feels:* Stability models carrying capacity — crowded coasts stress faster; inland recovery follows rain.
- **fog_of_war** — *Lore:* Reefs, mangrove mazes, and night voyaging hide fleets until the first torch on the beach. *How it feels:* Fog hides island garrisons until you send scouts — the Pacific rewards patience.

#### `community_14_nations` — recommended era: `modern`

- **Tagline:** Fourteen crowns — one continent, infinite border grudges.
- **Backdrop:** North America reimagined as fourteen peer powers sharing one landmass. Every border is a treaty waiting to break; every heartland is someone else’s manifest destiny.
- **territory_draft** — *Lore:* The continent is partitioned at the treaty table before armies march — manifest destiny starts in negotiation. *How it feels:* Draft rewards locking Great Lakes industry, Gulf ports, or Pacific gateways early.
- **asymmetric_factions** — *Lore:* Industrial giants, breadbasket republics, and energy kingdoms each bend the rules of continental war. *How it feels:* Factions feel like national character: mass mobilization, defensive depth, or economic snowball.
- **economy_buildings** — *Lore:* Factories, rails, and tech campuses are how a fourteen-way cold war turns hot. *How it feels:* Economy is modern total war — production spikes in megacity clusters and resource belts.
- **tech_trees** — *Lore:* Stealth, precision, and integrated logistics define who wins the next brushfire on a superpower lawn. *How it feels:* Tech unlocks doctrine edges: faster fortify, better defense in urban tiles, or attack tempo bonuses.
- **historical_events** — *Lore:* Sanctions, blackouts, and election shocks ripple across a continent wired together and armed to the teeth. *How it feels:* Events are cable-news crises made mechanical — swing PP/TP, stability, or diplomacy windows.
- **naval_warfare** — *Lore:* Three oceans touch the map; sea control is how you flank a continental rival. *How it feels:* Naval play unlocks amphibious end-arounds and strait pressure — Great Lakes and both coasts matter.
- **population_stability** — *Lore:* Megacity unrest and rural resentment decide whether your war machine keeps drafting. *How it feels:* Stability is national morale — heartland peace funds coastal tech; riots cap your surge.
- **fog_of_war** — *Lore:* Satellite gaps, cyber smoke, and media blackout zones hide mobilization in plain sight. *How it feels:* Fog models strategic ambiguity — you see borders, not stacks, until you probe or ally-share intel.

#### `community_strait_hormuz` — recommended era: `coldwar`

- **Tagline:** Chokepoint kings — tankers, gunboats, and desert mirages.
- **Backdrop:** The Gulf’s narrow throat concentrates oil, faith, and firepower. Iran, the Arab Gulf states, and Oman’s coast are one locked room — whoever holds the strait holds the world’s pulse for a week.
- **territory_draft** — *Lore:* Coalitions pick ports and desert spines before the first convoy is threatened. *How it feels:* Draft emphasizes Hormuz islands, UAE hubs, and Iranian plateau gateways.
- **asymmetric_factions** — *Lore:* Revolutionary guards, emirate fleets, and desert monarchies each fight the chokepoint differently. *How it feels:* Factions map to coastal AA, oil rent, or plateau depth — bonuses feel doctrinal, not cosmetic.
- **economy_buildings** — *Lore:* Refineries, pipelines, and port free zones turn black gold into bunkers and planes. *How it feels:* Economy is petro-state logic — income clusters on coasts and choke hexes; wonders feel like national projects.
- **tech_trees** — *Lore:* Missile tech, radar nets, and blue-water escorts escalate the narrow sea into a chessboard. *How it feels:* Tech unlocks sea denial, faster fleet redeploy, and crisis income when straits flash hot.
- **historical_events** — *Lore:* Embargo shocks, OPEC whispers, and proxy flare-ups keep the Gulf one spark from inferno. *How it feels:* Events are tanker incidents and summit ultimatums — swing diplomacy and production together.
- **naval_warfare** — *Lore:* This map is naval war by design — gunboats are border guards and oil is blood. *How it feels:* Every sea connection is a potential blockade; fleet income rewards holding island and mouth tiles.
- **population_stability** — *Lore:* Coastal cities swell; interior lines hold loyalty only while ration and rent hold. *How it feels:* Stability tracks urban pressure and sanctions pain — strait owners feel riots first.
- **fog_of_war** — *Lore:* Jamming, sand haze, and smuggler dhows hide missile batteries until first salvo. *How it feels:* Fog hides Gulf buildups — ISR (scouting) wins the strait before carriers do.

---

## Part D — User-created community maps

Maps uploaded through the Map Editor appear in the **Community Maps** section of the Map Hub (`GET /api/maps/public`). Their **name** and **description** are author-defined per document in MongoDB; they are **not** listed here.

---

## Part E — How to keep this document honest

1. When adding an era: extend `ERA_METADATA`, the era’s `backend/src/game-engine/eras/<era>.ts`, and `database/maps/era_<era>.json`, then append a section under Part A/B.  
2. When adding a curated regional / featured map: extend `REGIONAL_MAPS` and/or `COMMUNITY_MAP_TITLES`, add a full `CustomMapImmersionProfile` in `customMapImmersion.ts`, and mirror the immersion subsection under Part C.  
3. **Tech trees** are not duplicated line-for-line here; each node’s `name` and `description` live in `backend/src/game-engine/eras/<era>.ts` inside `*_TECH_TREE`.

---

## Appendix A — Faction `description` and `ability_description` (verbatim)

Mechanical bonuses (dice, reinforce numbers) are omitted; these strings are the **card copy** shown through faction definitions.

### `ancient`

- **Roman Republic** — *Disciplined legions re-roll their lowest attack die and receive extra reinforcements from Italic territory.* — Ability: *Testudo Formation: once per turn during attack phase, negate all attacker losses on one combat exchange.*
- **Parthian Empire** — *Mounted archers force attackers into the attack phase with one fewer attack die when assaulting Parthian territories.* — Ability: *Parting Shot: after losing a territory, immediately deal 1 unit loss to the attacker.*
- **Han Dynasty** — *Vast territory and organized bureaucracy generates +2 extra reinforcements per turn.* — Ability: *Silk Road: once per turn during draft, add +3 tech points.*
- **Maurya Empire** — *War elephants add +1 attack die when assaulting territories with 3 or fewer defenders.* — Ability: *War Elephants: once per turn, one attack roll uses 4 dice (max).*
- **Carthaginian Republic** — *Naval supremacy allows sea-lane fortify moves at no extra cost and +1 defense on coastal territories.* — Ability: *Naval Supremacy: move units along sea connections without restriction during fortify phase.*
- **Germanic Tribes** — *Fierce forest fighters — +1 defense die on all defense rolls.* — Ability: *Ambush: once per turn, attack from a border territory using 1 extra die.*

### `medieval`

- **Holy Roman Empire** — *Central European power — entrenched defensive doctrine with +1 defense die from faction bonuses.* — Ability: *Imperial Diet: once per turn during draft, gain +2 extra reinforcements per fully owned region.*
- **Mongol Khanate** — *Devastating cavalry charges — +1 attack die on territories with fewer than 3 defenders.* — Ability: *Great Raid: once per turn, attack a territory and move all (not just 3) units into captured territory.*
- **Byzantine Empire** — *Sophisticated bureaucracy and Greek fire — +1 defense die in your capital region.* — Ability: *Greek Fire: once per turn, an attacking force loses 1 additional unit before dice are rolled.*
- **Abbasid Caliphate** — *Intellectual hub and trade mastery — +2 tech points per turn passively.* — Ability: *House of Wisdom: once per turn, reduce the cost of a tech node by 3 (minimum 1).*
- **Kingdom of France** — *Chivalric knights — cavalry units grant +1 attack die when attacking from a territory you also hold a neighbor of.* — Ability: *Chevauchée: once per turn, raze an enemy territory (reduce unit count by 2) without attacking.*
- **Kingdom of England** — *Longbowmen add +1 attack die when attacking across a sea connection.* — Ability: *Longbowmen: once per turn, one ranged attack deals 1 unit loss to an adjacent enemy territory without a full attack exchange.*

### `discovery`

- **Spanish Empire** — *Conquistadors press the advantage — +1 attack die when attacking territories in the Americas or Africa.* — Ability: *Conquistador: once per turn, capture a territory with 1 or 2 defenders without rolling dice (auto-capture, costs 2 of your units).*
- **Portuguese Empire** — *Masters of the sea — sea_lanes connections allow 3 attack dice (normally 2) and free sea-lane fortify moves.* — Ability: *Naval Charts: your sea_lanes attacks use the full 3 dice cap instead of the era-limited 2.*
- **Ottoman Empire** — *Straddling east and west — +2 reinforcements per turn from controlling the mediterranean sea_routes region.* — Ability: *Janissaries: once per turn, defend with 3 dice regardless of garrison size.*
- **English Crown** — *Privateers and merchant adventurers — +1 tech point per sea territory owned.* — Ability: *Privateer: once per turn, steal 1 production unit from an adjacent enemy coastal territory.*
- **Ming Dynasty** — *Vast population and the Great Wall — +1 defense die in Asian territories.* — Ability: *Great Wall: once per turn, prevent one attack from resolving (the attacker's turn is wasted).*
- **Mughal Empire** — *Rich subcontinent — generates +3 extra tech points per turn.* — Ability: *Spice Trade: once per turn, exchange 5 tech points for 2 extra reinforcements.*

### `ww2`

- **Third Reich** — *Blitzkrieg doctrine — after a successful capture, may make one immediate bonus attack per turn.* — Ability: *Blitzkrieg: once per turn, after capturing a territory immediately execute a free additional attack from that territory.*
- **Soviet Union** — *Vast reserves — +2 reinforcements per turn; wartime_logistics allows 3 fortify moves.* — Ability: *Mass Mobilization: once per game, place 5 extra units on any owned territory.*
- **United States** — *Industrial supremacy — +1 production unit from every owned territory per turn.* — Ability: *Arsenal of Democracy: once per turn during draft, spend 5 production points to place 3 extra units.*
- **United Kingdom** — *Island fortress and global empire — +1 defense die; sea-lane fortify is free.* — Ability: *Commonwealth: once per turn, reinforce any owned territory from another owned territory via sea at no movement cost.*
- **Imperial Japan** — *Pacific supremacy — sea-lane attacks use 3 dice; +1 attack die in Pacific or Asia regions.* — Ability: *Banzai Charge: once per turn, one attack exchange uses 4 attack dice (maximum).*
- **Chinese Nationalists** — *Guerrilla resistance — +1 defense die; can spend production to place hidden reserve units.* — Ability: *Guerrilla Warfare: once per turn, place 1 unit on any owned territory for free.*

### `coldwar`

- **United States** — *Global superpower — +1 tech point per ally-adjacent territory; influence ability range extended to 2 hops.* — Ability: *Marshall Plan: once per turn during draft, place 1 free unit on any allied or newly captured territory.*
- **Soviet Union** — *Iron Curtain — influence ability can target territories within 2 hops; +1 defense die in Eastern Bloc territories.* — Ability: *Iron Curtain: once per turn, fortify up to 4 units to ANY owned territory regardless of path.*
- **People's Republic of China** — *Vast army — +2 reinforcements per turn; guerrilla tactics grant +1 defense die in Asia.* — Ability: *People's War: once per game, double your reinforcements for one turn.*
- **United Kingdom** — *Nuclear deterrent — if attacked in your capital territory, attacker loses 1 extra unit.* — Ability: *Nuclear Deterrence: once per game, cancel an attack against your capital territory entirely.*
- **Non-Aligned Movement** — *Guerrilla movements challenge both superpowers — territories you own cannot be influenced (immune to influence_spread).* — Ability: *Guerrilla Resistance: once per turn, place 2 free units on any border territory that was attacked last turn.*
- **NATO Alliance** — *Collective defense pact — if any NATO territory is attacked, adjacent NATO territories each add +1 defense die.* — Ability: *Article 5: once per turn, an attack on any of your territories triggers +1 automatic defender loss on the attacker.*

### `modern`

- **Western Bloc** — *Precision warfare — precision_strike is always active; +1 defense die from advanced body armor.* — Ability: *Precision Airstrike: once per turn, deal 2 unit losses to any adjacent enemy territory without a full attack exchange.*
- **Eastern Coalition** — *Armored mass — +2 reinforcements per turn; tanks let you move 2 extra units in fortify.* — Ability: *Armored Push: once per turn, execute two fortify moves instead of one.*
- **Rogue State** — *Asymmetric tactics — +1 defense die and immune to precision_strike attacker bonus.* — Ability: *Insurgency: once per turn, spawn 1 free unit in a border territory that was attacked this turn.*
- **Emerging Economy** — *Rapid industrialization — earn 2 extra production units per turn from every territory with a production building.* — Ability: *Economic Boom: once per turn, pay 4 tech points to immediately place 2 units anywhere.*
- **Petrostate** — *Oil wealth — +3 tech points per turn; can buy an extra reinforcement for every 3 owned resource territories.* — Ability: *Oil Wealth: once per turn, spend 6 tech points to place 3 extra units on any owned territory.*
- **Cyber State** — *Digital warfare — once per turn, sabotage an adjacent enemy territory (remove 1 unit before combat).* — Ability: *Cyber Attack: once per turn, remove 1 unit from an adjacent enemy territory without combat.*

### `acw`

- **Union Army** — *Industrial north — +1 production unit per owned territory; rifle_doctrine applies universally.* — Ability: *Total War: once per game, in one turn place double your normal reinforcements.*
- **Confederate Army** — *Defensive masters — +2 defense dice in home (Southern) territory; rifle_doctrine grants extra re-roll.* — Ability: *Southern Defense: once per turn, fortify any number of units within the South region regardless of adjacency.*

### `risorgimento`

- **Kingdom of Sardinia** — *The catalyst of Italian unification — carbonari_network influence costs 1 fewer unit; +1 reinforce in Piedmont.* — Ability: *Unification Drive: once per turn, convert a neutral Italian territory within range at zero cost.*
- **Austrian Empire** — *Conservative power defending the old order — +2 defense dice in Austrian core territories.* — Ability: *Habsburg Garrison: once per turn, immediately place 2 units in any Austrian-held territory under threat.*
- **Papal States** — *Spiritual influence — carbonari_network range is halved against Papal territories; +1 defense die.* — Ability: *Papal Dispensation: once per turn, prevent one influence attempt against any Papal territory.*
- **Kingdom of the Two Sicilies** — *Southern stronghold — +1 defense die; Garibaldi attack bonus is negated in Neapolitan territory.* — Ability: *Bourbon Resistance: once per game, prevent an enemy from capturing Sicily for one full turn.*

### `space_age`

- **Terran Federation** — *Satellite-backed democracies — +1 attack die from surveillance dominance; precision doctrine always active.* — Ability: *Orbital Surveillance: once per turn, reveal all units in an adjacent enemy territory and gain +1 attack die against it this turn.*
- **Sino-Pacific Hegemony** — *Automated industry + AI command — +2 reinforcements per turn; additional production from every tech_gen building.* — Ability: *AI Surge: once per turn, spend 5 tech points to place 3 units on any owned territory.*
- **Climate Alliance** — *Terraforming doctrine — +2 stability recovery per turn; territories recover population faster.* — Ability: *Terraform: once per turn, restore stability to 100 in an owned territory and gain 1 free unit there.*
- **Corporate Enclave** — *Private militaries and techno-capitalism — +4 tech points per turn; can purchase mercenaries.* — Ability: *Mercenary Contract: once per turn, spend 6 tech points to place 4 units on any territory you own that has a production building.*
- **Solar Caliphate** — *Vast solar arrays + hydrogen economy — +3 tech points per turn; extra reinforcement for every 3 owned resource territories.* — Ability: *Power Projection: once per turn, pay 4 tech points to attack any territory within 2 hops.*
- **Lunar Pioneers** — *Moon-native colonists — start with Moon access unlocked; +2 defense dice on all lunar territories.* — Ability: *Lunar Supply Drop: once per turn, drop 2 units into any owned Moon territory.*

---

*End of catalog.*
