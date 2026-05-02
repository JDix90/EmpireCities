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

/**
 * Galaxy storyline shown in lobby / codex tooltips.
 */
export const GALAXY_STORYLINE = `Year 4423 GE. A thousand years after the Diaspora, humanity's descendants squabble over the bones of the Pathfinder Civilization — a vanished species whose abandoned hyperspace lanes are humanity's only road between stars. Each successor faction begins on a single home world; to strike at a rival, a lord must first chart a way through the lanes.`;

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
    tagline: 'Bioluminescent Jungles — Helion Navigators',
    description:
      'A super-Venus terraformed by Helion seedships in 3220 GE. Beneath perpetual sulphur clouds, vast carbon-fixing megalichens have engineered the entire surface into a single photosynthetic organism. By night the canopy glows green; by day, the cloud-tops flicker with electrical storms. The Navigators rule from sky-cities suspended above the methane mists.',
    stakes:
      'Storm belts and living canopy divide control — fleets bargain corridors through weather Braille scratched into the clouds during four centuries of Navigator civil war.',
  },
  rust: {
    display_name: 'Rust Belt',
    tagline: 'Forge-World — Industrial Syndicate',
    description:
      "Once a cool red world, Rust Belt was disassembled across two centuries by the Forge Syndicate's mining megacorps. Its ancient volcanoes — Olympus, Tharsis, Pavonis — are now the largest factory complexes ever built; their slopes are hollowed into shipyards stacked dozens of decks deep. Forge citizens are gene-hardened against radiation and dust.",
    stakes:
      'Territory follows slag rivers and tether anchors — Syndicate guild charters redraw holdings whenever a caldera plant changes hands or a tether chapter sells passage.',
  },
  nexus_station: {
    display_name: 'Nexus Station',
    tagline: 'The Pathfinder Vault — Void Custodians',
    description:
      "Not a planet but a constructed shellworld the size of Sol's moon — a hollow, cratered sphere of impossibly old composite alloys, locked in a halo orbit between the systems. Its surface is pocked with kilometre-deep impact basins, each one a dormant Pathfinder gateway. Whoever controls Nexus controls the lane network itself.",
    stakes:
      'Custodian lodges carved spherical mandates along crater rims — each basin treaty ratifies who may wake a gate without invoking Pathfinder contingencies.',
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

  // ── Verdan Reach ────────────────────────────────────────────────────────
  verdan_aurora: {
    frontier:
      'Polar aurora bands ionize navigation — Navigators carved jagged limits wherever Choir dirigibles could hover without shedding lift gas to storms.',
    hold: 'Sky-platforms hang in polar updrafts; biolum broadcast hymns that double as IFF codes for Helion merchant militias.',
  },
  verdan_stormwall: {
    frontier:
      'The perpetual hurricane wall shifts yearly — borders are ratchets of wreck buoys and tether anchors left by fleets that tried to punch through.',
    hold: 'Only storm-rated skiffs survive the methane shear; rescue guilds sell passage maps drawn from lightning-flash telemetry auctions.',
  },
  verdan_canopy: {
    frontier:
      'Follows lichen strain gradients — older treaties locked haul lanes where two incompatible megastructures merge and neither faction will terraform further.',
    hold: 'Harvest claws rake the upper canopy; lower strata are classified ecological hazards because something beneath answers lidar in Mandate encryption.',
  },
  verdan_marsh: {
    frontier:
      'Chemosynthetic blooms creep nightly — patrol drones redraw limits each season where violet mycelium breaches containment berms.',
    hold: 'Marsh pilots swear the ground remembers troop formations; Custodian observers refuse soil samples beyond thirty metre depth.',
  },
  verdan_drift: {
    frontier:
      'Floating castles drift on jet streams — jurisdictional claims tie to anchor cables cut during Navigator succession wars.',
    hold: 'Refugee sky-enclaves trade salvage rights for maneuvering fuel; Mandate exiles launder identities through drifting passport brokers.',
  },
  verdan_brilliance: {
    frontier:
      'Navigators refused straight lines here — the brilliance gap exposes molten crust that cooks sensors; borders corkscrew along ash shadow contours.',
    hold: 'Landing banned under capital letters; black-ops teams still race to drop probes before Choir interceptors burn them mid-descent.',
  },

  // ── Rust Belt ───────────────────────────────────────────────────────────
  rust_olympus: {
    frontier:
      'Follows pressure bulkheads inside the hollow caldera — guild chapters duel over deck slices whenever a foundry crucible changes allegiance.',
    hold: 'Olympus shipyards stack kilometers deep; gantry cranes cast shadows long enough to calendar shifts across three time zones of forge smoke.',
  },
  rust_tharsis: {
    frontier:
      'Geothermal conduit treaties zigzag with slag rivers — whoever controls a vent spine inherits kilometers of radiant trench law.',
    hold: 'Three live volcanoes feed continent-wide plasma plants; cooling lakes glow dull orange from dumped reactor glass.',
  },
  rust_marineris: {
    frontier:
      'Anchored to the tether elevator footprint — borders jag along cable shadow corridors where debris shields still orbit from the Syndicate schism.',
    hold: 'Marineris hosts the counterweight stalk — freight climbers crawl like luminous ants along a cable visible from orbit on clear dust days.',
  },
  rust_hellas: {
    frontier:
      'Deep pit mining rights scar the basin rim — each terrace notch records a bankruptcy auction or a guild duel fought in vac suits.',
    hold: 'Hellas floor mines pre-Diaspora alloys; acoustic pings still bounce off sealed vault doors nobody admits owning keys for.',
  },
  rust_cydonia: {
    frontier:
      'Custodian observers drew irregular cordons after “terrain incidents” — tourism bans mask sensor grids listening for harmonic wakes in the bedrock.',
    hold: 'Forge tourists die rich documenting taboo mesas; locals charge danger fees that double whenever satellites eclipse.',
  },
  rust_argyre: {
    frontier:
      'Southern yards inherit tidal dust schedules — borders shift with seasonal storms that bury marker beacons unless guilds pay upkeep.',
    hold: 'Torch-drive frigate slips glow white-hot at night; mech-frame ranges crater the regolith in overlapping trial circles.',
  },

  // ── Nexus Station ───────────────────────────────────────────────────────
  nexus_valhalla: {
    frontier:
      'Valhalla rim forts echo Pathfinder harmonics — Custodian lodges refuse Euclidean borders; limits trace resonance nulls mapped during the Awakening Scare.',
    hold: 'Only confirmed-active gate on the shell — whoever camps the basin threshold bills tolls in hyperspace transit futures.',
  },
  nexus_asgard: {
    frontier:
      'Dormant gate seismic masks wander — patrol routes corkscrew along fracture networks left when Custodians pulse-fed the basin to listen for echoes.',
    hold: 'Silence broadcasts loop endlessly; rookie crews swear the dust spells coordinates if stared at long enough through augmented visors.',
  },
  nexus_heimdall: {
    frontier:
      'Sensor treaty lines stitch across uplift plates — each antenna spine owns a veto wedge because jamming one node blinds half the volume.',
    hold: 'Heimdall tracks every torch flare in-system; black-market pilots pay fortunes for twelve-minute blind spots.',
  },
  nexus_adlinda: {
    frontier:
      'Regolith subsidence redraws maps — Custodian cordons follow ground-penetrating radar ghosts around sealed vaults declared “nonexistent.”',
    hold: 'Subsurface listens hear rhythmic pings nobody correlates to ships; dredging permits come signed in blood-equivalent escrow bonds.',
  },
  nexus_tornarsuk: {
    frontier:
      'Half-melted Pathfinder spires radiate waste heat — borders hug isotherms where armor plating fails without liquid cooling umbilicals.',
    hold: 'Basin floor runs hot enough to anneal rifle barrels; veterans stencil prayers into heat sinks before patrol.',
  },
  nexus_loni: {
    frontier:
      'Dock tariffs drew fractal customs lanes — merchant consortiums inherited weird angles whenever a clan defaulted on berth lineage debts.',
    hold: 'Loni berths swallow traffic from Verdan and Rust; lane brokers auction queue jumps while holographic statues argue admiralty law.',
  },
};

/** @deprecated Prefer `GALAXY_TERRITORY_LORE_DETAIL` — kept for external string lookups. */
export const GALAXY_TERRITORY_LORE: Record<string, string> = Object.fromEntries(
  Object.entries(GALAXY_TERRITORY_LORE_DETAIL).map(([id, d]) => [
    id,
    `${d.frontier} ${d.hold}`,
  ]),
);

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

/** Combined paragraph for callers that want a single block (Codex, tooltips). */
export function getGalaxyTerritoryLore(territoryId: string | undefined | null): string | null {
  const d = getGalaxyTerritoryLoreDetail(territoryId);
  return d ? `${d.frontier} ${d.hold}` : null;
}
