/**
 * Galactic Age — narrative metadata.
 *
 * Backend stays authoritative for gameplay; this file ships only player-facing
 * flavor strings. Use `getGalaxyWorldLore`, `getGalaxyTerritoryLoreDetail`, and
 * `getGalaxyTerritoryLore` (combined fallback paragraph for simple callers).
 */

export interface GalaxyWorldLore {
  /** UI heading; mirrors `MapWorldDefinition.display_name`. */
  display_name: string;
  /** One-line subtitle / faction tag. */
  tagline: string;
  /** 2–4 sentence world description shown in the territory panel. */
  description: string;
  /** How decades of lane-war shaped control on this sphere (shown under tagline). */
  stakes: string;
}

export interface GalaxyTerritoryLoreDetail {
  /** Terrain, economy, population — what armies occupy. */
  hold: string;
  /** Treaties, raids, terrain — why the border zigzags the way it does. */
  frontier: string;
}

export const GALAXY_WORLD_LORE: Record<string, GalaxyWorldLore> = {
  sol: {
    display_name: 'Sol III',
    tagline: 'Cradle World — Stellar Mandate',
    description:
      "Earth, scarred but enduring. Forty-seven billion souls layered into arcology stacks across every continent. The Stellar Mandate rules from Geneva-Yokohama, claiming legitimacy as the unbroken line of Earth's civilization. Their armies are old, slow, and disciplined; their continents walking history.",
    stakes:
      'Continental fronts froze into ribbon borders after the Second Diaspora armistice — every coastline and arcology belt is a cease-fire line someone still remembers.',
  },
  verdan: {
    display_name: 'Verdan Reach',
    tagline: 'The Twilight Ring — Helion Navigators',
    description:
      'A tidally locked super-Venus, terraformed by Helion seedships in 3220 GE. One face burns under the Brilliance, a white-hot sea of sulphur cloud turning round a storm the size of a continent: the Eye. The other face is black ice. Life holds on only in the twilight between, two crescent continents of glowing fen joined end to end by storm straits into a ring round the world. The Navigators rule from sky-cities that ride the terminator jet stream and never see a sunrise.',
    stakes:
      'The ring has no rear: every stretch of it is somebody’s front. The short way across runs through the Brilliance Isles, and the Stormwall tears apart any army big enough to hold them.',
  },
  rust: {
    display_name: 'Rust Belt',
    tagline: 'The Sundered Plate — Forge Syndicate',
    description:
      "Once a cool red world, the Rust Belt was disassembled across two centuries by the Forge Syndicate's mining megacorps, and cracked open in the doing. The Marineris Rift now runs molten nearly pole to pole. West of it lies the Tharsis plate, whose old volcanoes — Olympus, Ascraeus, Pavonis — are hollowed into shipyards dozens of decks deep; east of it, the Hesperia–Hellas plate and its deep mines. Forge citizens are gene-hardened against radiation and dust.",
    stakes:
      'Three places cross the rift: the Noctis isthmus, the Tether Anchorage where the space elevator comes down, and the southern narrows. Every guild war on the Belt has been fought over one of them.',
  },
  nexus_station: {
    display_name: 'Nexus Station',
    tagline: 'The Shattered Shell — Void Custodians',
    description:
      "Not a planet but a constructed shellworld the size of Sol's moon, hung in a halo orbit between the systems — and broken open when the Gate woke. The Gate crater sits at the centre of the near side, ringed by the four segments of the Vault. Around it the shell has cracked into shards joined by bridges over glowing void; the far hemisphere is gone, a breach into the Pathfinder lattice itself. Whoever controls Nexus controls the lane network.",
    stakes:
      'Every road on Nexus leads to the Vault, and no lane lands in it: whoever wants the Gate has to take it from inside the shell, one bridge at a time.',
  },
};

export const GALAXY_TERRITORY_LORE_DETAIL: Record<string, GalaxyTerritoryLoreDetail> = {
  // ── Sol III ──────────────────────────────────────────────────────────────
  sol_atlantic: {
    frontier:
      'The ribbon follows the drowned Maritime Corridor armistice — Mandate coastal batteries still duel Syndicate privateers in fog bands nobody charts honestly.',
    hold: 'Corporate arcologies spike through perpetual Atlantic cloud; board-room armies levy tribute from fishing fleets that refuse to register hull IDs.',
  },
  sol_mediterranean: {
    frontier:
      'Drawn after the Adriatic Ceasefire of 4311 — every olive terrace became a listening post; the line still kinks where drone swarms mutually crashed.',
    hold: 'Terraced megafarms feed half the Mandate fleet; marble bunkers hide diaspora-era vaults the auditors pretend not to inventory.',
  },
  sol_panasian: {
    frontier:
      'Frozen along the Muroran Ice Shelf DMZ — armor divisions mirror each other across taiga so heavily mined that neither side will pay to survey it.',
    hold: 'One uninterrupted fortress-city from old Murmansk ruins to Shanghai stacks — conscripts born on maglev platforms rarely touch bare soil.',
  },
  sol_equatorial: {
    frontier:
      'Tracks the Green Curtain protocol: canopy militias and drone hunters negotiated gaps where sunlight still reaches forgotten Lagos bunkers.',
    hold: 'The equatorial canopy is a single organism — patrol paths are carved where spider-vines thin enough for troop drones to slip through.',
  },
  sol_pacific: {
    frontier:
      'Codified by the Ring-of-Fire Arbitration — hypersonic skirmishes left thermal scars that navigation AI treat as sacred no-fly teeth.',
    hold: 'Tokyo–Manila–Jakarta reads as one urban knot on infrared; submarine districts trade black-market lane keys beneath coral reclamation pylons.',
  },
  sol_antarctic: {
    frontier:
      'Matches the Andean Elevator Treaty — every ridge hosts diaspora silos classified extinct until someone sells launch windows on the black lane.',
    hold: 'Terraced arcologies climb from Pacific trench vents into thinning oxygen — veterans swear the wind still carries missile coolant from the old wars.',
  },

  // ── Verdan Reach — the Twilight Ring ─────────────────────────────────────
  // Dawnrim: the Sol / Luna front.
  verdan_spore_reach: {
    frontier:
      'Ends at the north storm strait, where the Stormwall makes the water impassable to anything slower than a Navigator skiff; the border is wherever the last spore beacon still answers.',
    hold: 'Spore towers seed the jet stream with the ring’s pollen — half the canopy on Verdan grew from what blows off these cliffs.',
  },
  verdan_verdigris_span: {
    frontier:
      'Runs along the frost line on the night-facing shore. The canopy stops where the dark begins, and so does every treaty.',
    hold: 'Copper-green lichen plateaus cured in cold starlight; the Navigators mine them for the pigment that tints every sky-city hull.',
  },
  verdan_saffron_mire: {
    frontier:
      'Faces the Brilliance across the first strait of the chord — mire pilots claim every sandbar the day-tide leaves, and lose half of them by evening.',
    hold: 'Saffron bogs simmer gold under a sun that never sets; skimmer crews ferry spore-oil out to Mycel Deep on the hot wind.',
  },
  verdan_chlorophage_span: {
    frontier:
      'Drawn round the landing field of the Sol lane — the Mandate’s first beachhead, fenced by Navigator pylons that have never once been switched off.',
    hold: 'Chlorophage vines eat anything green that is not them; the lane port is the only clear ground for a hundred kilometres.',
  },
  // Emberfen.
  verdan_glowmire_shelf: {
    frontier:
      'Ends at the south storm strait. Across the water the Storm Belts glow the same colour, and both shores claim the wrecks between.',
    hold: 'A drowned shelf of luminous peat that burns without flame; crews navigate by the light of the ground itself.',
  },
  verdan_greenfire_vault: {
    frontier:
      'Walled round the second Sol lane, over seedship vaults sealed in 3220 GE that still hold the stock Helion terraformed the world from.',
    hold: 'Greenfire orchards glow under the vault domes. Whoever holds the lane holds the seed bank, and both sides know it.',
  },
  verdan_lumen_bog: {
    frontier:
      'A cape pushed out into the night side. Its border is the terminator itself, and it creeps a few metres a century.',
    hold: 'The last light before the ice: bog-lanterns, exiles, and a smugglers’ anchorage the dark keeps off every chart.',
  },
  // Duskrim: the Rust front.
  verdan_photic_crown: {
    frontier:
      'Holds the Rust lane at the north storm strait. Forge engineers bolted the landing yards straight into the cliffs, and the Navigators never forgave them.',
    hold: 'Photic towers catch the last of the dusk and beam it inland; the yards below trade spore-oil for Rust alloy.',
  },
  verdan_thundercrown_belt: {
    frontier:
      'Follows the night-facing ridgeline, where thunderheads break on the ice every evening that never comes.',
    hold: 'Storm-farm arrays pull lightning from the dusk front — the Belt powers half the sky-cities and is shelled by all of them in turn.',
  },
  verdan_witchlight_fen: {
    frontier:
      'Its day-facing shore looks across the water to Pollen Sea: the last stepping stone of the chord, and the Duskrim’s door to the Eye.',
    hold: 'Witchlight marsh flickers blue under a sun that sits on the horizon for ever; ferry clans run the crossing for whoever pays in water.',
  },
  // Storm Belts.
  verdan_mistveil_hollow: {
    frontier:
      'A basin walled in by fog. Borders here are drawn in wreck buoys, because nothing else stays put.',
    hold: 'Methane mist pools in the hollow for months; storm-rated skiffs slip through it to hit Duskrim convoys from behind.',
  },
  verdan_cinder_bloom: {
    frontier:
      'Faces Glowmire across the south storm strait. Its shore batteries were built to stop exactly one crossing, and have.',
    hold: 'Fire-blossoms seed in ash and open in lightning strikes; the pollen burns bright enough to read by.',
  },
  verdan_sulphur_drift: {
    frontier:
      'Anchored on the second Rust lane at the ring’s southern tip. The dunes shift so fast the border is re-surveyed every tide.',
    hold: 'Sulphur flats drift under the day-glare; Forge refineries at the lane port turn them into the acid the Syndicate etches hulls with.',
  },
  // Brilliance Isles: across the day side, through the Eye.
  verdan_mycel_deep: {
    frontier:
      'The first isle out from the Dawn crescent. Claims end where the mycelium mats give way to open cloud-sea.',
    hold: 'A floating island of fungal mat thick enough to land a frigate on, if the pilot trusts it.',
  },
  verdan_emberleaf_basin: {
    frontier:
      'The only land beneath the storm. The Eye’s calm is a circle a few hundred kilometres wide, and the Stormwall round it is a border nobody drew.',
    hold: 'The emberleaf forests grow in the calm at the heart of the Brilliance, where the Navigators crown their Pilot-Regent under a sun directly overhead.',
  },
  verdan_pollen_sea: {
    frontier:
      'The last isle before the Duskrim. Pollen tides turn the strait yellow, and the border moves with them.',
    hold: 'Pollen reefs rise out of the cloud-sea — flat, gold, and walkable for the few hours the wind drops.',
  },

  // ── Rust Belt — the Sundered Plate ──────────────────────────────────────
  // Tharsis Foundries, on the west plate.
  rust_caldera_foundry: {
    frontier:
      'Runs round the rim of the Olympus caldera — guild chapters duel over deck slices whenever a foundry crucible changes allegiance.',
    hold: 'The Olympus shipyards stack kilometres deep; gantry cranes cast shadows long enough to calendar shifts across three time zones of forge smoke.',
  },
  rust_crucible_deep: {
    frontier:
      'The hub of the west plate, and where the Sulphur Drift lane comes down: the Navigators land in the middle of Tharsis, and every road from there to the isthmus runs past Pavonis.',
    hold: 'The Pavonis crucible pours hull steel in rivers a kilometre wide; its heat bloom shows from orbit on the night side, and guides the Verdan barges in.',
  },
  rust_smelter_crown: {
    frontier:
      'Bounded on the east by the rift’s northern arm; the cliff-top smelters look straight down into the glow.',
    hold: 'Ascraeus smelters vent sulphur plumes the Syndicate bottles and sells back to Verdan as fertiliser.',
  },
  // Argyre Marches: the Verdan front.
  rust_furnace_marches: {
    frontier:
      'The western edge of the plate, behind the Argyre rim — close enough to the Verdan landings that the Syndicate garrisons it before anything else.',
    hold: 'Furnace towns built from the slag of the towns before them; the old lane port is the only thing on the Marches older than a decade, and it has been dark since the lane moved to Pavonis.',
  },
  rust_oxide_flats: {
    frontier:
      'The west bank of the rift lake. Its ferries to the Tether Anchorage run on a timetable written in blood feud.',
    hold: 'Salt flats where the rift lake boils off; oxide crews rake the crust into pigment and propellant.',
  },
  rust_anvil_basin: {
    frontier:
      'The Argyre impact basin, walled by its own rim. The Photic Crown lane comes down on its floor, and the southern narrows open off its eastern shore.',
    hold: 'Torch-drive frigate slips glow white-hot at night; mech-frame ranges crater the regolith in overlapping trial circles.',
  },
  // Anchor Works: the crossings.
  rust_bessemer_cut: {
    frontier:
      'The only land bridge across the rift. Whoever holds the Cut holds the Belt together — or holds it apart.',
    hold: 'Noctis Labyrinthus, cut down to one fortified causeway; the Bessemer converters along it never stop, because the heat is the wall.',
  },
  rust_tether_anchorage: {
    frontier:
      'An island in the rift lake where the space elevator comes down, ferried from both banks and never held by either for long.',
    hold: 'Freight climbers crawl like luminous ants up a cable visible from orbit on clear dust days; the anchorage pays for half the Syndicate.',
  },
  // Hellas Deeps, on the east plate.
  rust_cinderworks: {
    frontier:
      'The east bank of the rift lake, facing the anchorage ferry across water that glows at night.',
    hold: 'Kilns fired by rift heat bake the east plate’s ore into ingots before it ever leaves the ground.',
  },
  rust_ironstorm_belt: {
    frontier:
      'Faces Anvil Basin across the southern narrows. The dust storms that name it close the crossing for weeks at a time.',
    hold: 'Magnetite dunes that sing in the wind; the Belt’s mines run under the storms, not through them.',
  },
  rust_dross_hollow: {
    frontier:
      'The Hellas basin rim — each terrace notch records a bankruptcy auction or a guild duel fought in vac suits.',
    hold: 'Hellas floor mines pre-Diaspora alloys; acoustic pings still bounce off sealed vault doors nobody admits owning keys for.',
  },
  // Hesperia: the Nexus front.
  rust_scoria_flats: {
    frontier:
      'Where the Bessemer causeway lands on the east plate. Every army that crosses the Cut comes down here first.',
    hold: 'The Chryse lava plains, glassy and black; the Syndicate’s rail yards fan out across them from the causeway head.',
  },
  rust_hematite_span: {
    frontier:
      'The old Arabia highlands and the hub of Hesperia, where the Nexus lane comes down; the Custodians inspect every hull that leaves, and the claims around the port are older than the Syndicate.',
    hold: 'Hematite spherules lie on the ground like shot; harvesters sweep them up faster than the wind can bury them, and the Span ships them to Nexus for gate time.',
  },
  rust_ferro_span: {
    frontier:
      'The Syrtis shoulder at the eastern edge of the plate, facing the Borealis platforms across the slag sea.',
    hold: 'A plateau of dark basalt; the Span’s wind farms power the Hesperia mines, and its old lane port now handles only the Tailing Drift ferries.',
  },
  // Slag Wastes: platforms in the Borealis slag sea.
  rust_slag_reach: {
    frontier:
      'A platform in the Borealis slag sea holding the second Nexus lane. Its border is the edge of the platform.',
    hold: 'Acidalia’s slag was dumped here for a century until it hardened into ground; the lane port sits on the oldest layer.',
  },
  rust_tailing_drift: {
    frontier:
      'A spoil platform chained to the Hesperia shore by ferry lines that snap in every storm.',
    hold: 'Utopia’s tailings pile, settle and pile again; the crews who live on the Drift build on whatever held last year.',
  },

  // ── Nexus Station — the Shattered Shell ─────────────────────────────────
  // The Gate Ring: the Vault.
  nexus_harmonic_rim: {
    frontier:
      'The north-east segment of the Gate Ring, cut from its neighbours by fractures you can see the lattice through.',
    hold: 'Harmonic dampers line the rim; when the Gate pulses, the whole segment rings like a struck bell and every clock aboard skips.',
  },
  nexus_gate_threshold: {
    frontier:
      'The segment where Halo Span’s causeway comes down — the only place anyone has ever reached the Vault on foot.',
    hold: 'Customs halls built right to the crater lip; beyond the last window there is nothing but the Gate.',
  },
  nexus_echo_concourse: {
    frontier:
      'Two shards of the Vault Ward bridge into it, which makes it the Ward’s front door and the Custodians’ first worry.',
    hold: 'A concourse built for pilgrims who stopped coming; the echoes of the Awakening still loop in its acoustics.',
  },
  nexus_basin_mandate: {
    frontier:
      'Named for the Basin Mandate, the treaty that decides who may wake the Gate, and signed on this segment for that reason.',
    hold: 'Lodge halls and archive vaults; every Custodian oath is sworn here, facing the crater.',
  },
  // Spire Walk.
  nexus_cordon_march: {
    frontier:
      'The inner shard whose bridge lands on Basin Mandate. The Cordon was drawn to keep pilgrims off it; now it keeps out armies.',
    hold: 'Watch-towers and cordon fences on a slab that has sat ten degrees off true since the shell broke.',
  },
  nexus_quietude_basin: {
    frontier:
      'Bridged to Harmonic Rim across a moat of open void. Its border is the crack it drifts on.',
    hold: 'A sensor-dead basin where the lattice noise cancels out — the quietest place on Nexus, and the best place to hide a fleet.',
  },
  nexus_antenna_spire: {
    frontier:
      'Holds the Rust lane on the north-west crown; its bridge to Custodian Quarter is the Spire Walk’s back door.',
    hold: 'The Heimdall array: every torch flare in the system arrives here first, and blind spots sell by the minute.',
  },
  nexus_lodgeway: {
    frontier:
      'The Sol lane lands here, on the crown and not in the Vault: anyone from Sol must cross the whole Spire Walk to reach the Gate.',
    hold: 'Guest lodges for delegations who are never quite invited in; the Custodians keep them comfortable and far from the crater.',
  },
  // Berth Ring.
  nexus_halo_span: {
    frontier:
      'Joined to the Gate Ring by the only land causeway on the shell, and bridged to Harmonic Rim besides.',
    hold: 'A halo of docking arms round a slab that never stopped spinning; the causeway to the Threshold is the busiest floor on Nexus.',
  },
  nexus_toll_crater: {
    frontier:
      'Shares its slab with Halo Span; the toll line down the middle is older than the crack.',
    hold: 'Every hull bound for the Gate pays here; toll-keepers audit cargo in a crater that used to be a berth.',
  },
  nexus_waystation_loni: {
    frontier:
      'Holds the second Rust lane on the east crown, bridged to Lodgeway across the broken edge of the shell.',
    hold: 'Loni’s berths swallow the traffic from Rust; lane brokers auction queue jumps while holographic statues argue admiralty law.',
  },
  nexus_lattice_berth: {
    frontier:
      'The south crown’s last shard before the gap; its bridge to Resonance Vault runs straight over the breach.',
    hold: 'Ships dock on the lattice itself here — berths hung from Pathfinder struts nobody built.',
  },
  // Vault Ward.
  nexus_vault_approach: {
    frontier:
      'The inner shard that bridges into Echo Concourse; every Ward army bound for the Gate musters here.',
    hold: 'Blast doors and weigh stations. The Approach was built to slow things down, and it does.',
  },
  nexus_beacon_hollow: {
    frontier:
      'Bridged to Echo Concourse, and cracked off Vault Approach by a fracture that still widens a finger’s breadth a year.',
    hold: 'A hollow of dead beacons, each the grave-marker of a gate someone woke without asking.',
  },
  nexus_resonance_vault: {
    frontier:
      'Holds the other Sol lane, on the south-west crown — a lane that lands in the Ward, not the Vault, by treaty and by geometry.',
    hold: 'Resonance chambers tuned to the Gate, where the Custodians listen for the next Awakening.',
  },
  nexus_custodian_quarter: {
    frontier:
      'The west crown shard, bridged to Antenna Spire across the gap: the Custodians’ own quarter, and their last line.',
    hold: 'Cloisters cut into the shell’s outer skin; through the floor grilles you can see the stars that ought to be on the far side of the world.',
  },
};

export function getGalaxyWorldLore(worldId: string | undefined | null): GalaxyWorldLore | null {
  if (!worldId) return null;
  return GALAXY_WORLD_LORE[worldId] ?? null;
}

export function getGalaxyTerritoryLoreDetail(
  territoryId: string | undefined | null,
): GalaxyTerritoryLoreDetail | null {
  if (!territoryId) return null;
  return GALAXY_TERRITORY_LORE_DETAIL[territoryId] ?? null;
}
