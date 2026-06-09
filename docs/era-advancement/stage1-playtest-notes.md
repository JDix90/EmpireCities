# Era Advancement — Stage 1 Playtest Notes

**Date:** June 2026  
**Mode:** Human-only PoC (Stage 1 close-out)

---

## Automated verification (CI)

| Check | Status |
|-------|--------|
| `advanceEra.test.ts` + `eraAdvancementReadiness.test.ts` | Pass |
| `economyBootstrap.test.ts` | Pass |
| `combatModifiers.test.ts` era gap 0/1/2 + vuln | Pass |
| Toggle-off regression (`era_advancement_enabled: false`) | Pass (full backend suite) |
| Ranked + era advancement rejected on create | Pass (`games.routes.ts`) |
| Feature flag server guard | Pass (403 when flag off, non-admin) |

---

## 30–45 min playtest session (copy this checklist)

**Before you start**

1. Backend + frontend running locally (or staging).
2. Admin → Feature Flags → enable `era_advancement_lobby_enabled`.
3. Log in as a non-guest account (admin also works).
4. Open a notes row per game: `Game #`, `First tech turn`, `First build turn`, `Advance eligible turn`, `Who won`, `Advanced? Y/N`.

**Recommended lobby (Game A — era advancement ON)**

| Setting | Value |
|---------|-------|
| Era | Ancient |
| Map | `era_ancient` |
| Players | 2 humans, or 1 human + 1 AI (medium) |
| Era Advancement | **On** (auto-enables Economy, Tech Trees, Stability) |
| Territory Selection | Off (faster session) |
| Turn timer | Off (or 120s if you want pressure) |

Confirm at start: toast shows **"{username} goes first"** (random first player, not host).

**Quick path to advance (milestone gate)**

Research **3 tier-1** + **1 tier-2** tech, build **1** non-wonder building, keep empire stability ≥ 60%, save gold for advance cost (scales with production income).

---

### Per-scenario checklist (~5–7 min each)

| # | Do this | Pass if | Your result |
|---|---------|---------|-------------|
| 1 | Create **Game B** identical to A but **Era Advancement off**. Play 2–3 turns. | No Advance Era panel; no era fields in UI; normal draft/attack flow | ☐ |
| 2 | **Game A**: open Advance Era panel during draft/attack. | Three milestone rows (tier-1, tier-2, buildings) + gold + stability; blockers update as you research/build | ☐ |
| 3 | Meet all gates; click **Advance to Medieval** on your turn. | Gold deducted; units reduced (~70%); `current_era_index` → 1; tech list cleared; medieval tree available | ☐ |
| 4 | After you advance, end turn; opponent attacks you **before your next turn**. | Defender fights at vulnerability penalty (−25% effective defense); combat feels harder than usual | ☐ |
| 5 | As Medieval player, make **one attack** with signature charge available. | +1 attack die once; charge consumed (`medieval_signature_charges` → 0) | ☐ |
| 6 | **Game C**: same lobby as A; **do not advance**; push domination/threshold win at era 0. | You can still win without advancing | ☐ |

**Record tuning metrics (Game A)**

| Metric | Target | Your turn # |
|--------|--------|-------------|
| First tech researched | 1–2 | |
| First building placed | 2–3 | |
| First advance attempt (all gates met) | 6–10 | |
| Winner advanced? | Either outcome OK | |

**Red flags (note and stop if severe)**

- Still cannot research/build until turn 4+ → bootstrap regression.
- Everyone eligible to advance by turn 5 → milestone or bootstrap too loose.
- Nobody eligible by turn 12 → milestone too tight or gold cost too high.
- Host always goes first → random start not working.

**Optional automation (after manual pass)**

```bash
pnpm -C backend exec tsx scripts/eraAdvancementPlaytest.ts
```

Requires server at `PLAYTEST_BASE_URL` (default `http://localhost:3001`) and flag on or admin account.

---

## Manual smoke scenarios (Phase E)

Run with `era_advancement_lobby_enabled` enabled via Admin → Feature Flags.

| # | Scenario | Expected | Manual |
|---|----------|----------|--------|
| 1 | Create game with era advancement **off** | Normal game, no era fields consulted | Pending human |
| 2 | Create with era advancement **on**, economy + tech + stability | Lobby persists flag; gates visible | Pending human |
| 3 | Advance on turn 4–6 when gates pass | Gold deducted, units converted, era index 1 | Pending human |
| 4 | Opponent attacks during vulnerability window | Defender at −25% effective defense | Pending human |
| 5 | Signature +1 attack die fires once | `medieval_signature_charges` consumed | Pending human |
| 6 | Win without advancing (stayer path) | Domination/threshold win at era 0 | Pending human |

**Socket automation:** `pnpm -C backend exec tsx scripts/eraAdvancementPlaytest.ts` (requires running server + admin flag or admin account).

---

## Stage 1 success criteria

| Criterion | Evidence |
|-----------|----------|
| Vulnerability tension | Stage 0 pen-and-paper + combat modifier tests |
| Stayer strike incentive | Vuln defense mult test + AI striker (Stage 2) |
| Win without advancing | Requires human playtest #6 |
| Toggle-off regression | CI green |
| Combat gap tests | gap 0, 1, 2 in `combatModifiers.test.ts` |

---

## Tuning metrics (post-bootstrap)

Track per session when playtesting economy + tech games:

| Metric | Target |
|--------|--------|
| First tech researched | Turn 1–2 |
| First building placed | Turn 2–3 |
| First advance attempt (eligible) | Turn 6–10 |
| Wins without advancing | Still possible |

## Rollout

- `era_advancement_lobby_enabled` remains **off** by default in production.
- Enable via Admin page for beta testers after manual scenarios 1–6 pass.
