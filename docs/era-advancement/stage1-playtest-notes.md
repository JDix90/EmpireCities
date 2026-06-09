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
