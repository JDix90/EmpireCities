# Eras of Empire — Player Guide & FAQ

A complete guide to the game — from core rules to advanced features. New players should start with the **Core Rules** section; experienced Risk players can skip ahead to the advanced features.

All advanced features are **opt-in** — the host toggles them individually when creating a game via the **Advanced Features** checkboxes in the lobby.

---

## Table of Contents

1. [Core Rules](#core-rules)
   - [Turn Structure](#turn-structure)
   - [Combat & Dice](#combat--dice)
   - [Territory Cards](#territory-cards)
   - [Victory Conditions](#victory-conditions)
2. [Game Settings](#game-settings)
3. [Economy & Buildings](#economy--buildings)
4. [Technology Trees](#technology-trees)
5. [Naval Warfare](#naval-warfare)
6. [Event Cards (Historical Events)](#event-cards)
7. [Asymmetric Factions](#asymmetric-factions)
8. [Population & Stability](#population--stability)
9. [How Features Interact](#how-features-interact)
10. [FAQ](#faq)

---

## Core Rules

### Turn Structure

Each turn has three phases:

1. **Draft (Reinforcement)** — Receive new units and place them on your territories.
2. **Attack** — Attack adjacent enemy territories (optional — you can skip).
3. **Fortify** — Move units between connected friendly territories (once, optional).

**Reinforcement formula:**

| Component | Units |
|-----------|-------|
| Base | 1 per 3 territories you own (minimum 3) |
| Continent bonus | Extra units for owning all territories in a continent (scaled by player count) |
| Card trade-in | Bonus units from redeeming a card set (see below) |

Some games also include a **Territory Selection** phase before the first turn, where players take turns picking starting territories.

### Combat & Dice

To attack, you need at least **2 units** on your territory (one must stay behind to garrison).

| Role | Dice |
|------|------|
| **Attacker** | Rolls up to **3 dice** (specifically: `min(attacking_units − 1, 3)`) |
| **Defender** | Rolls up to **2 dice** (specifically: `min(defending_units, 2)`) |

All dice are standard **d6** (1–6). Both sides sort their rolls from highest to lowest, then compare in pairs:

- **Highest attacker die vs highest defender die** — lower roll loses 1 unit.
- **Second highest vs second highest** (if both have ≥2 dice) — lower roll loses 1 unit.
- **Ties go to the defender.** The defender's unit survives; the attacker loses one.

You **capture** a territory when its last defending unit is destroyed. At least one attacking unit automatically moves in.

**Era-specific modifiers** can modify combat (e.g., Ancient-era "Legion Reroll" lets the attacker re-roll their lowest die, ACW "Rifle Doctrine" gives the attacker a re-roll on ties). These are shown in the HUD during gameplay.

### Territory Cards

If you capture **at least one territory** during your attack phase, you draw a card at the end of your turn. Each card shows a symbol:

| Symbol | |
|--------|-|
| **Infantry** | 🪖 |
| **Cavalry** | 🐎 |
| **Artillery** | 💣 |
| **Wild** | ★ (2 in the deck; matches any symbol) |

During your Draft phase, you can trade a **set of 3 cards** for bonus reinforcement units.

**Valid sets:**
- Three of a kind (e.g., 3 Infantry)
- One of each (Infantry + Cavalry + Artillery)
- Any 2 matching + 1 Wild

**Escalating bonus** — Each successive trade-in (globally across all players) gives more units:

| Trade-in # | 1st | 2nd | 3rd | 4th | 5th | 6th | 7th+ |
|------------|-----|-----|-----|-----|-----|-----|------|
| **Bonus** | 4 | 6 | 8 | 10 | 12 | 15 | +5 each |

Timing your trade-ins is a strategic decision — trade early for a small safe bonus, or hold cards for a massive later payout (risking elimination).

### Victory Conditions

The host selects one or more victory conditions at game creation. The first player to satisfy **any** enabled condition wins:

| Condition | How to Win |
|-----------|-----------|
| **Domination** (default) | Capture every territory — or be the last player standing |
| **Threshold** | Own ≥ X% of all territories (percentage set by host, e.g., 70%) |
| **Capital Conquest** | Each player starts with a capital territory. Capture your own + all opponents' capitals |
| **Secret Mission** | Each player receives a hidden objective at game start |

**Secret Mission types:**
- **Capture territories** — Conquer 2 specific enemy territories
- **Eliminate player** — Eliminate a specific opponent entirely
- **Control regions** — Control 1 or 2 entire continents
- **Alliance** (rare, 4+ player games) — You and a secret ally each hold ≥20% of all territories

---

## Game Settings

When creating a game, the host can configure:

| Setting | Options |
|---------|---------|
| **Era & Map** | Ancient, Medieval, Discovery, WW2, Cold War, Modern, ACW, Risorgimento, or community maps |
| **Players** | 2–12 (mix of human and AI) |
| **AI Bots** | 0–7 bots at Easy / Medium / Hard / Expert difficulty |
| **Turn Timer** | None, 3 min, 5 min, 10 min, or async (12h / 24h / 72h) |
| **Victory** | Domination, Threshold, Capital, Secret Mission (can enable multiple) |
| **Fog of War** | Only see owned territories + immediate neighbors |
| **Territory Draft** | Players pick starting territories instead of random assignment |
| **Ranked / Casual** | Ranked games affect your skill rating and leaderboard position |

**Advanced feature toggles** (each independent): Economy & Buildings, Technology Trees, Naval Warfare, Historical Events, Factions, Population & Stability.

---

## Economy & Buildings

**Toggle:** "Economy & Buildings" in lobby.

### Resources

Your currency is **Production Points** (shown as 💰 in the UI). You spend Production Points to construct buildings on your territories.

**How you earn Production Points each turn:**

| Source | Income |
|--------|--------|
| **Base territory income** | 1 per 3 territories you own (minimum 1) |
| **Camp (production_1)** | +1 per turn |
| **Barracks (production_2)** | +2 per turn |
| **Arsenal (production_3)** | +4 per turn |

> Your base income is automatic — even with no buildings, holding territories generates a small trickle of Production Points every turn.

### Buildings

Buildings are constructed during the **Draft** or **Fortify** phase. Click a territory you own to open the Territory Panel, then scroll to the **Buildings** section.

| Building | Cost | Effect | Prerequisite |
|----------|------|--------|--------------|
| **Camp (I)** | 3💰 | +1 unit income/turn | — |
| **Barracks (II)** | 6💰 | +2 units income/turn | Camp |
| **Arsenal (III)** | 10💰 | +4 units income/turn | Barracks |
| **Palisade (I)** | 3💰 | +1 defender die | — |
| **Fortress (II)** | 6💰 | +2 defender dice | Palisade |
| **Citadel (III)** | 10💰 | +3 defender dice | Fortress |
| **Laboratory (I)** | 4💰 | +2 Tech Points/turn | — |
| **Research Center (II)** | 8💰 | +4 Tech Points/turn | Laboratory |
| **Capital Works** | 5💰 | Capital special project | — |
| **Wonder** | 8💰 | Era wonder project | — |
| **Port** | 5💰 | +1 fleet/turn (coastal only) | — |
| **Naval Base** | 10💰 | +2 fleets/turn (coastal only) | Port |

**Rules:**
- Each territory can have **one building per category** (one production tier, one defense tier, one tech tier, one naval tier, etc.).
- Upgrading (e.g., Camp → Barracks) replaces the previous tier; you pay only the upgrade cost, not the original.
- **Buildings are razed when a territory is captured** by an enemy.

### Getting Started with Economy

1. Your first turns generate ~1 Production Point from base income.
2. After 3 turns, build a **Camp** (3💰) on a safe interior territory.
3. The Camp produces +1/turn — now you earn ~2/turn total.
4. Save up for a **Barracks** upgrade (6💰) or a **Palisade** on a front-line territory.
5. Prioritize defense buildings on border territories and production buildings deep in your empire.

---

## Technology Trees

**Toggle:** "Technology Trees" in lobby.

### Tech Points (TP)

Tech Points are the currency for researching technologies. They are separate from Production Points.

**How you earn Tech Points each turn:**

| Source | Income |
|--------|--------|
| **Base territory income** | 1 TP per 5 territories you own (minimum 1) |
| **Laboratory (I) building** | +2 TP/turn |
| **Research Center (II) building** | +4 TP/turn |
| **Unlocked tech nodes with `tech_point_income`** | Varies per node (e.g., Trade Routes = +3 TP/turn) |

> Like Production Points, you earn a small base trickle of Tech Points each turn from your territory count alone.

### Researching Technologies

Open the **Tech Tree** panel (available during Draft or Fortify phase) to see your era's technology tree. Each era has a unique tree with 3–4 tiers of nodes.

- **Tier 1** nodes have no prerequisites and cost 3–4 TP.
- **Tier 2** nodes require a specific Tier 1 node and cost 6–7 TP.
- **Tier 3+** nodes chain further, with increasing costs.

Click an available (unlocked) node and confirm to spend your TP.

### What Technologies Unlock

Tech nodes can grant any combination of:

| Bonus | Example |
|-------|---------|
| **+N Attack dice** | Iron Weapons (+1 attack die on all rolls) |
| **+N Defense dice** | — |
| **+N Reinforcements/turn** | Roman Roads (+1 unit/turn) |
| **+N Tech Points/turn** | Trade Routes (+3 TP/turn) |
| **Unlocks a building type** | Granaries → unlocks Camp; Stone Walls → unlocks Palisade |
| **Unlocks a special ability** | Siege Engines → siege attack ability |

> **Important:** When Tech Trees is enabled alongside Economy, some buildings (like Camp, Palisade, Laboratory) may require you to research the corresponding tech first. Check the tech tree for `unlocks_building` nodes.

### Getting Started with Tech Trees

1. You earn at least 1 TP/turn from base income.
2. After 3–4 turns, research a Tier 1 tech (cost 3–4 TP).
3. Good first picks: a building unlock (Granaries, Stone Walls) or a combat bonus (Iron Weapons).
4. Build a **Laboratory** once you can afford one to accelerate TP income.
5. Rush Tier 2 Trade Routes for a self-sustaining TP engine.

---

## Naval Warfare

**Toggle:** "Naval Warfare" in lobby.

### Fleets

When Naval Warfare is enabled, **coastal territories** (those connected by at least one sea connection on the map) gain a **fleet counter** starting at 0. Fleets are shown in the Territory Panel with an ⚓ icon.

### Building Fleets

Fleets are generated by **naval buildings**, which can only be built on coastal territories:

| Building | Cost | Fleet Income |
|----------|------|-------------|
| **Port** | 5💰 | +1 fleet/turn |
| **Naval Base** | 10💰 | +2 fleets/turn |

Naval Base requires a Port to be built first (upgrade path). Fleet income is collected automatically at the start of each turn.

> You need the **Economy & Buildings** feature enabled alongside Naval Warfare to build ports. Without Economy, you cannot construct fleet-generating buildings.

### Sea-Lane Attacks

When attacking across a **sea connection** (shown on the map as a dashed or blue line):

1. **You must have at least 1 fleet** on the attacking territory. Attacks across sea without fleets are blocked.
2. **If the defender has fleets**, naval combat occurs first:
   - Fleet-vs-fleet dice rolls (same system as land combat: attacker up to 3 dice, defender up to 2 dice).
   - If you lose the naval battle, the land attack is aborted entirely.
3. **If you win** (or defender has no fleets), 1 fleet is consumed for the crossing, and the normal land attack proceeds.

### Fleet Movement

During the **Attack** or **Fortify** phase, you can move fleets between your own coastal territories that share a sea connection. This does not cost a turn action.

### Naval Attack (Blockade)

You can also launch a standalone naval attack against an enemy's fleets on an adjacent sea-connected territory. This is pure fleet-vs-fleet combat without a follow-up land battle — useful for clearing enemy naval presence.

### Getting Started with Naval Warfare

1. Enable both "Economy & Buildings" and "Naval Warfare" in the lobby.
2. Identify coastal territories on the map (those with sea connections to other territories).
3. Build a **Port** (5💰) on a safe coastal territory early.
4. Accumulate fleets, then use them to project power across sea lanes.
5. Upgrade to a **Naval Base** (10💰) for double fleet production.
6. Always keep fleets on coastal borders you want to defend — enemy naval attacks can strip your sea presence.

---

## Event Cards

**Toggle:** "Historical Events" in lobby.

### How Events Work

At the **start of each game round** (after all players have taken a turn), an era-specific event card is drawn automatically. Each card represents a historical event from the game's era.

### Event Types

| Category | Color | Description |
|----------|-------|-------------|
| **Global** | Blue | Affects all players equally |
| **Regional** | Amber | Affects specific territories or regions |
| **Player-Targeted** | Purple | Targets the current player directly |
| **Natural Disaster** | Red | Destructive events (unit losses, production penalties) |

### Instant vs. Choice Events

- **Instant events** apply their effect immediately (e.g., "+2 units to all your territories" or "All players lose 1 unit from their weakest territory"). You see a summary modal and click "Continue."
- **Choice events** present 2–3 options with different tradeoffs. You click your preferred choice and its effect applies. Example: "The Silk Road is open — invest in trade (+3 resources) or military expansion (+5 units on a random territory)."

### Temporary Modifiers

Some events grant **temporary modifiers** that last multiple turns:
- **Attack modifier**: +N or −N to your attack dice for N turns.
- **Defense modifier**: +N or −N to your defense dice for N turns.

Temporary modifiers tick down automatically at the start of each of your turns. Active modifiers are factored into combat automatically.

### AI Behavior

AI players automatically resolve choice events by selecting the first option.

---

## Asymmetric Factions

**Toggle:** "Asymmetric Factions" in lobby.

Each era has 4–6 unique factions with different home regions, passive bonuses, and special abilities. When factions are enabled:

- Players are assigned factions at game start (round-robin from the era's faction pool).
- Starting territories are **geographically clustered** around each faction's home region instead of random.
- Each faction grants persistent passive bonuses that apply every turn.

### Faction Bonuses

| Bonus Type | Effect |
|-----------|--------|
| **Passive Attack Bonus** | +N dice on all your attacks |
| **Passive Defense Bonus** | +N dice when defending |
| **Reinforce Bonus** | +N extra units during draft phase |
| **Special Ability** | Unique once-per-turn ability (varies per faction) |

### Example: Ancient Era Factions

| Faction | Passive Bonus | Special Ability |
|---------|--------------|-----------------|
| Roman Republic | +1 reinforcement/turn | Testudo: negate attacker losses on one combat |
| Parthian Empire | +1 defense die | Parting Shot: deal 1 loss to attacker after losing a territory |
| Han Dynasty | +2 reinforcements/turn | Silk Road: +3 tech points once per turn |
| Maurya Empire | +1 attack die | War Elephants: one attack with 4 dice |

---

## Population & Stability

**Toggle:** "Population & Stability" in lobby.

### How Stability Works

Every owned territory has a **Stability** rating from 0 to 100, shown as a color-coded progress bar in the Territory Panel:

| Range | Color | Meaning |
|-------|-------|---------|
| 80–100 | 🟢 Green | Stable — full production |
| 50–79 | 🟡 Yellow | Unrest — slightly reduced output |
| 30–49 | 🟠 Orange | Rebellion — noticeably reduced output |
| 0–29 | 🔴 Red | Collapse — severely reduced output |

### Stability Effects

- **Production scaling**: All building income (Production Points, Tech Points) from a territory is multiplied by `stability / 100`. A territory at 50% stability produces half its normal income.
- **Recovery**: Each of your territories recovers **+5 stability per turn** automatically on your turn (capped at 100).

### Stability Penalties

| Event | Stability Effect |
|-------|-----------------|
| **Territory captured** (via combat) | Reset to **30** |
| **Territory flipped** (via Cold War influence) | −20 from current value (floor 0) |

### Strategy Tips

- Newly conquered territories are near-useless economically (30% output). It takes ~14 turns to fully recover.
- Avoid over-extending if Economy is also on — expanding too fast tanks your overall income.
- Defensive play is rewarded: territories you've held for many turns are at 100% and produce maximum income.
- Build production buildings on long-held interior territories for maximum value.

---

## How Features Interact

These features were designed to be mixed and matched. Here are the key interactions:

| Combination | Interaction |
|------------|-------------|
| **Economy + Tech Trees** | Some buildings (Camp, Palisade, Lab) require researching the corresponding tech node first. Tech buildings (Laboratory) generate Tech Points. |
| **Economy + Naval Warfare** | Ports and Naval Bases are economy buildings that generate fleets. You need Economy enabled to build fleet-generating structures. |
| **Economy + Stability** | Low stability reduces building income. New conquests produce very little until stability recovers. |
| **Tech Trees + Economy** | Tech Point income partly comes from tech_gen buildings (Lab, Research Center). Base TP income helps bootstrap. |
| **Events + Combat** | Event card temporary modifiers (+/− attack or defense) apply automatically to all combats during their duration. |
| **Factions + Combat** | Faction passive attack/defense bonuses stack with tech bonuses, building bonuses, and event modifiers. |
| **Naval + Stability** | Capturing a coastal territory via sea-lane attack still triggers the stability penalty (reset to 30). |

### Recommended Combinations for New Players

- **Economy + Tech Trees**: The core "build and research" loop. Start here.
- **Economy + Tech Trees + Factions**: Adds strategic variety with asymmetric starts.
- **All features**: The full experience — complex, strategic, and rewarding.

---

## FAQ

### Economy

**Q: I have 0 Production Points and no buildings. How do I get started?**
A: You earn a base income of 1 Production Point per 3 territories you own (minimum 1) at the start of each turn. After a few turns you'll have enough to build your first Camp (costs 3💰).

**Q: What happens to buildings when I lose a territory?**
A: All buildings on a captured territory are **razed** (destroyed). The conqueror starts fresh.

**Q: Can I build during the attack phase?**
A: No. Buildings can only be constructed during the **Draft** or **Fortify** phases.

**Q: Is there a limit to how many buildings one territory can have?**
A: One building per category. A single territory can have one production building, one defense building, one tech building, one naval building, and specials — but not two of the same category.

### Tech Trees

**Q: How do I earn Tech Points without buildings?**
A: You earn a base income of 1 TP per 5 territories (minimum 1) each turn, even without any buildings or researched techs.

**Q: Do I need to research before I can build anything?**
A: Only when **both** Economy and Tech Trees are enabled. In that case, buildings like Camp require the "Granaries" tech, and Palisade requires "Stone Walls." If only Economy is on (no Tech Trees), all buildings are available immediately.

**Q: Are tech trees the same for every era?**
A: No. Each era (Ancient, Medieval, Discovery, WW2, etc.) has a unique tech tree with era-appropriate technologies.

### Naval Warfare

**Q: Why can't I attack across a sea connection?**
A: When Naval Warfare is enabled, sea-lane attacks require at least 1 fleet on the attacking territory. Build a Port to start generating fleets.

**Q: Can I move fleets to non-coastal territories?**
A: No. Fleets only exist on coastal territories and can only move along sea connections.

**Q: What if I don't enable Naval Warfare — can I still attack across sea lanes?**
A: Yes. Without Naval Warfare, sea connections work like normal connections with the Discovery-era sea lanes modifier (max 2 attack dice across sea). No fleets are involved.

**Q: Do I need Economy enabled to use Naval Warfare?**
A: You need Economy to **build** Ports and Naval Bases (fleet-generating buildings). Without Economy, there's no way to construct them, so fleets would remain at 0. Enable both for the full naval experience.

### Events

**Q: Can I skip or refuse an event card?**
A: Instant events are applied automatically — you can't refuse them. For choice events, you must pick one of the available options (there's no "decline" option).

**Q: Do events affect AI players?**
A: Yes. Global events affect all players. AI players auto-resolve choice events by picking the first option.

**Q: How long do temporary modifiers last?**
A: Each modifier specifies a turn duration (typically 2–3 turns). They tick down at the start of your turn.

### Stability

**Q: A territory I captured has 30% output — how do I fix it?**
A: Stability recovers +5 per turn automatically. From 30, it takes 14 turns to reach 100. There's no way to speed it up currently — plan your economy around this.

**Q: Does stability affect reinforcement count?**
A: No. Stability only scales **building income** (Production Points and Tech Points). Your reinforcement count from territory/continent bonuses is unaffected.

**Q: Does stability go below 0?**
A: No, stability is floored at 0 and capped at 100.
