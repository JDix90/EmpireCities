/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source: backend/src/game-engine/eras/*.ts, projected by
 * backend/src/game-engine/eras/factionCodex.ts.
 * Regenerate: pnpm -C backend exec tsx scripts/generateFactionCodex.ts
 *
 * Faction display names by era and faction id (utils/factionNames.ts reads
 * it). A backend test fails if this drifts from the era definitions.
 */
export const FACTION_NAMES: Record<string, Record<string, string>> = {
  "ancient": {
    "rome": "Roman Republic",
    "parthia": "Parthian Empire",
    "han": "Han Dynasty",
    "maurya": "Maurya Empire",
    "carthage": "Carthaginian Republic",
    "germanic_tribes": "Germanic Tribes"
  },
  "medieval": {
    "hre": "Holy Roman Empire",
    "mongol_empire": "Mongol Khanate",
    "byzantine": "Byzantine Empire",
    "caliphate": "Abbasid Caliphate",
    "france": "Kingdom of France",
    "england": "Kingdom of England"
  },
  "discovery": {
    "spain": "Spanish Empire",
    "portugal": "Portuguese Empire",
    "ottoman": "Ottoman Empire",
    "england_discovery": "English Crown",
    "ming_china": "Ming Dynasty",
    "mughal": "Mughal Empire"
  },
  "ww2": {
    "germany": "Third Reich",
    "soviet_union": "Soviet Union",
    "usa": "United States",
    "uk": "United Kingdom",
    "japan": "Imperial Japan",
    "china_ww2": "Chinese Nationalists"
  },
  "coldwar": {
    "usa_cw": "United States",
    "ussr": "Soviet Union",
    "china_cw": "People's Republic of China",
    "uk_cw": "United Kingdom",
    "decolonization_movement": "Non-Aligned Movement",
    "nato_proxy": "NATO Alliance"
  },
  "modern": {
    "western_power": "Western Bloc",
    "eastern_bloc": "Eastern Coalition",
    "rogue_state": "Rogue State",
    "emerging_power": "Emerging Economy",
    "petro_state": "Petrostate",
    "cyber_power": "Cyber State"
  },
  "acw": {
    "union": "Union Army",
    "confederacy": "Confederate Army"
  },
  "risorgimento": {
    "sardinia_piedmont": "Kingdom of Sardinia",
    "austria": "Austrian Empire",
    "papal_states": "Papal States",
    "kingdom_naples": "Kingdom of the Two Sicilies"
  },
  "space_age": {
    "terran_federation": "Terran Federation",
    "sino_hegemony": "Sino-Pacific Hegemony",
    "climate_alliance": "Climate Alliance",
    "corpo_enclave": "Corporate Enclave",
    "solar_caliphate": "Solar Caliphate",
    "lunar_pioneers": "Lunar Pioneers"
  },
  "galaxy_age": {
    "stellar_mandate": "Stellar Mandate",
    "forge_syndicate": "Forge Syndicate",
    "helion_navigators": "Helion Navigators",
    "void_custodians": "Void Custodians"
  }
};
