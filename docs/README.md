# Borderfall Documentation Index

Borderfall is a turn-based territory-conquest strategy game (think Risk, across history) — React/Vite SPA + Fastify/Socket.io backend with Postgres and Redis, live at borderfall.gg. Setup and quick-start live in the [root README](../README.md); this page is the map to everything else.

## Start here, by audience

**"I'm new and want to run or develop it"**
[root README](../README.md) (quick-start) → [ONBOARDING.md](ONBOARDING.md) (dev environment) → [ARCHITECTURE.md](ARCHITECTURE.md) (how it works) → [CONFIGURATION.md](CONFIGURATION.md) (every knob)

**"I'm an AI coding agent"**
[AGENTS.md](../AGENTS.md) (orientation) → [CLAUDE.md](CLAUDE.md) (paste-ready system prompt) → [ARCHITECTURE.md](ARCHITECTURE.md) (ground truth — wins over any embedded summary)

**"I'm operating production"**
[DEPLOYMENT.md](../DEPLOYMENT.md) (stack + deploy) → [OPERATIONS.md](OPERATIONS.md) (state recovery, restarts) → [RUNBOOK.md](RUNBOOK.md) (procedures, incidents) → [INTEGRATIONS.md](INTEGRATIONS.md) (third-party credentials & failure modes)

**"I want to understand the game itself"**
[PLAYER_GUIDE.md](PLAYER_GUIDE.md) (complete rules) → [LORE_AND_MAPS_CATALOG.md](LORE_AND_MAPS_CATALOG.md) (eras & maps) → [../database/maps/MAP_CREATION.md](../database/maps/MAP_CREATION.md) (authoring maps)

## All documents

Status: **current** (maintained, carries source-of-truth pointers) · **point-in-time** (accurate when written, dated, not continuously updated) · **design-archive** (planning/design records; never updated).

| Document | Purpose | Status |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design: topology, Redis-authoritative state, resilience, auth, workers, CI | current |
| [CONFIGURATION.md](CONFIGURATION.md) | Every env var, feature flag, port | current |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Third-party connections, credentials, failure modes | current |
| [ONBOARDING.md](ONBOARDING.md) | Developer environment setup | current |
| [OPERATIONS.md](OPERATIONS.md) | State persistence/recovery, restart behavior | current |
| [RUNBOOK.md](RUNBOOK.md) | Deploy/incident procedures, launch sequence | current |
| [CLAUDE.md](CLAUDE.md) | Paste-ready AI-assistant system prompt | current |
| [PLAYER_GUIDE.md](PLAYER_GUIDE.md) | Complete game rules | current |
| [LORE_AND_MAPS_CATALOG.md](LORE_AND_MAPS_CATALOG.md) | Era/map content reference | current |
| [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) | Rolling security review checklist | current |
| [MOBILE_CAPACITOR.md](MOBILE_CAPACITOR.md) | Native iOS/Android builds | current |
| [COMMUNITY_MAP_FIXES.md](COMMUNITY_MAP_FIXES.md) | Community-map maintenance log | current |
| [LAUNCH_QA_SIGNOFF.md](LAUNCH_QA_SIGNOFF.md) | Pre-release QA gates A–H | current |
| [CODEBASE_STATUS.md](CODEBASE_STATUS.md) | Already-implemented-features checklist | point-in-time |
| [AUDIT_BACKLOG.md](AUDIT_BACKLOG.md) | Security/code audit tracking | point-in-time |
| [LAUNCH_PLAN_PHASES_1_2.md](LAUNCH_PLAN_PHASES_1_2.md) | Release phase planning | design-archive |
| [LAUNCH_QA_ROADMAP.md](LAUNCH_QA_ROADMAP.md) | QA automation roadmap | design-archive |
| [MOBILE_UX_PLAN.md](MOBILE_UX_PLAN.md) / [MOBILE_UX_REQUIREMENTS.md](MOBILE_UX_REQUIREMENTS.md) | Mobile UX strategy/requirements | design-archive |
| [BRAND_COMPETITIVE_ANALYSIS.md](BRAND_COMPETITIVE_ANALYSIS.md) | Positioning & market analysis | design-archive |
| [STORE_RELEASE.md](STORE_RELEASE.md) | App-store submission checklist | design-archive |
| [GLOBE_2D_CHECKLIST.md](GLOBE_2D_CHECKLIST.md) | 2D/globe parity checklist | design-archive |
| [era-advancement/](era-advancement/README.md) | Era Advancement feature design (stages 0–3) | design-archive |

Root-level: [README.md](../README.md) (canonical setup), [DEPLOYMENT.md](../DEPLOYMENT.md), [CONTRIBUTING.md](../CONTRIBUTING.md), [AGENTS.md](../AGENTS.md), [PRIVACY_POLICY.md](../PRIVACY_POLICY.md), [TERMS_AND_CONDITIONS.md](../TERMS_AND_CONDITIONS.md).

## Keeping docs accurate

The *current* docs trade completeness for honesty: every table cites its source-of-truth file, and `bash scripts/check-docs.sh` re-verifies the load-bearing claims (env var names against `config/index.ts`, ports against compose files, migration count, and a sweep for retired state-model phrasing). Run it after architecture-level changes; if it flags drift, fix the doc in the same PR as the code. Design-archive docs are intentionally never updated — they record what was planned, not what is.
