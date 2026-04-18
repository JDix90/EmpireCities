# Eras of Empire

> A browser-based historical world map strategy game inspired by Risk — featuring eight playable historical eras, asymmetric factions, a tech tree, an economy system, event cards, secret missions, a 3D globe view, ranked matchmaking, a daily challenge, a campaign mode, game replays, an in-game cosmetics store, and a full JWT authentication system.

> **Now with Population & Stability:** Each territory tracks stability (0–100%) and population (1–10). Low stability reduces income, caps unit placement, and risks rebellion. High stability grows population, which boosts production. Captured territories start unstable with halved population. Select factions gain faster stability recovery. New event cards and mechanics included!

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Playable Eras](#playable-eras)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Prerequisites](#prerequisites)
6. [Quick Start](#quick-start)
7. [Environment Variables](#environment-variables)
8. [Database Setup](#database-setup)
9. [Running the Application](#running-the-application)
10. [Game Mechanics Reference](#game-mechanics-reference)
11. [Population & Stability System](#population--stability-system)
12. [Factions & Asymmetric Gameplay](#factions--asymmetric-gameplay)
13. [Technology Tree](#technology-tree)
14. [Economy & Buildings](#economy--buildings)
15. [Event Cards](#event-cards)
16. [Victory Conditions](#victory-conditions)
17. [Map Editor Guide](#map-editor-guide)
18. [Architecture Overview](#architecture-overview)
19. [Pages & Features](#pages--features)
20. [Development Notes](#development-notes)

---

## Project Overview

Eras of Empire is a full-stack web application where players command armies across historically accurate maps spanning eight distinct eras. Each era features asymmetric factions with unique passive bonuses and once-per-turn abilities, a multi-tier technology tree, an optional territory economy with upgradeable buildings, a shuffled deck of era-specific event cards, and a unique wonder structure. Matches support 2–8 players (human or AI bot), real-time WebSocket gameplay, reconnection recovery, fog of war, and multiple configurable victory conditions.

Beyond live multiplayer, the game includes a ranked matchmaking queue with Glicko-2 ratings, a daily challenge seeded from the date, a linear single-player campaign across six eras, a turn-by-turn replay viewer, a community map hub with ratings and moderation, a custom D3-based map editor, a 3D interactive globe view, an in-game cosmetics store, a friends system with game invites, an interactive tutorial, and guest play without registration.

---

## Playable Eras

| Era | Period | Territories | Connections | Regions |
|---|---|---|---|---|
| Ancient World | 200 AD | 28 | 40 | 8 |
| Medieval World | 1200 AD | 29 | 41 | 8 |
| Age of Discovery | 1600 AD | 34 | 51 | 8 |
| World War II | 1939–1945 | 35 | 53 | 8 |
| Cold War | 1947–1991 | 44 | 72 | 8 |
| The Modern Day | Present | 43 | 94 | 8 |
| American Civil War | 1861–1865 | 18 | 37 | 6 |
| Italian Unification | 1859–1871 | 14 | 23 | 6 |

Two community maps (14 Nations and Strait of Hormuz) are also included. Additional custom maps can be created with the built-in map editor and published to the community hub.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + TypeScript + Vite + TailwindCSS |
| **2D Map Rendering** | PixiJS v7 (WebGL canvas) |
| **3D Globe** | react-globe.gl (Three.js) |
| **Map Editor** | D3.js v7 (SVG-based polygon drawing) |
| **State Management** | Zustand |
| **Real-time** | Socket.io v4 (WebSockets) |
| **Backend API** | Node.js 22 + TypeScript + Fastify |
| **Authentication** | Custom JWT (access + refresh token rotation) |
| **Relational DB** | PostgreSQL 16 (Drizzle ORM) |
| **Document DB** | MongoDB 7 (Mongoose — map documents) |
| **Cache / Leaderboards** | Redis 7 |
| **AI Bots** | Server-side heuristic Minimax with Alpha-Beta Pruning, timeout-guarded worker |
| **Ratings** | Glicko-2 (per era, ranked queue) |
| **Dev Environment** | Docker Compose + VS Code |

---

## Project Structure

```
eras-of-empire/
├── README.md
├── package.json                  # Root monorepo workspace
├── .gitignore
│
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example              # ← Copy to .env and fill in
│   └── src/
│       ├── index.ts              # Fastify server entry point
│       ├── config/               # Environment config loader
│       ├── db/
│       │   ├── postgres/         # PostgreSQL connection + migrations
│       │   ├── mongo/            # MongoDB connection + Map model
│       │   └── redis/            # Redis connection + helpers
│       ├── middleware/
│       │   ├── authenticate.ts   # JWT auth middleware
│       │   └── rejectGuest.ts    # Block guest accounts from mutating routes
│       ├── modules/
│       │   ├── auth/             # Register, login, refresh, logout, guest sessions
│       │   ├── users/            # Profile, achievements, leaderboard, ratings
│       │   ├── games/            # Game CRUD, lobby, join, replay, tutorial
│       │   ├── maps/             # Custom map CRUD, publish, rate, report
│       │   ├── campaign/         # Era campaign start/progress/advance
│       │   ├── daily/            # Daily challenge create/join/leaderboard
│       │   ├── matchmaking/      # Ranked queue (Glicko-2, three time buckets)
│       │   └── store/            # Cosmetics catalog, gold-based purchases, loadout
│       ├── sockets/
│       │   └── gameSocket.ts     # Socket.io real-time game server
│       └── game-engine/
│           ├── combat/           # Dice resolver, card bonuses, reinforcements
│           ├── state/            # Game state initializer and mutators
│           ├── ai/               # AI bot (minimax + alpha-beta, timeout worker)
│           ├── eras/             # Factions, tech trees, wonders per era
│           ├── events/           # Event card decks + effect applicator
│           ├── victory/          # Secret mission assignment + evaluation
│           ├── achievements/     # Achievement unlock evaluator
│           ├── rating/           # Glicko-2 update logic
│           ├── tutorial/         # Tutorial game builder
│           └── validation/       # Map graph + connection validator
│
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── index.html
│   └── src/
│       ├── main.tsx              # React entry point
│       ├── App.tsx               # Router + route guards
│       ├── pages/
│       │   ├── LandingPage.tsx   # Public marketing page
│       │   ├── LoginPage.tsx     # Authentication
│       │   ├── RegisterPage.tsx  # Account creation
│       │   ├── LobbyPage.tsx     # Game browser + create game
│       │   ├── GamePage.tsx      # Main game view (map + HUD)
│       │   ├── ReplayPage.tsx    # Turn-by-turn replay viewer
│       │   ├── MapEditorPage.tsx # Custom map creation tool
│       │   ├── MapHubPage.tsx    # Community map browser
│       │   ├── ProfilePage.tsx   # User stats, achievements, and history
│       │   ├── FriendsPage.tsx   # Friends list, pending requests, game invites
│       │   ├── StorePage.tsx     # Cosmetics catalog + loadout equip
│       │   ├── CampaignPage.tsx  # Single-player era campaign progress
│       │   ├── DailyChallengePage.tsx # Daily seeded challenge + leaderboard
│       │   ├── TutorialPage.tsx  # Auto-starts an interactive tutorial game
│       │   ├── PrivacyPage.tsx
│       │   └── NotFoundPage.tsx
│       ├── components/
│       │   └── game/
│       │       ├── GameMap.tsx           # PixiJS WebGL 2D map renderer
│       │       ├── GlobeMap.tsx          # react-globe.gl 3D globe renderer
│       │       ├── GameHUD.tsx           # Phase controls, player list, cards
│       │       ├── TerritoryPanel.tsx    # Territory action panel
│       │       ├── BuildingPanel.tsx     # Economy: build / upgrade structures
│       │       ├── TechTreeModal.tsx     # Research tech nodes
│       │       ├── EventCardModal.tsx    # Draw and apply event cards
│       │       ├── ActionModal.tsx       # Confirm attack / fortify actions
│       │       ├── BonusesModal.tsx      # Region bonuses inspector
│       │       ├── GameChat.tsx          # In-game live chat
│       │       ├── EraModifierBadge.tsx  # Active era modifier display
│       │       ├── TutorialOverlay.tsx   # In-map tutorial guidance slides
│       │       ├── InviteFriendsModal.tsx # Invite friends to open game
│       │       └── AtomBombAnimation.tsx # Cold War / Modern special effect
│       ├── store/
│       │   ├── authStore.ts      # Zustand auth state
│       │   └── gameStore.ts      # Zustand game state + replay snapshots
│       └── services/
│           ├── api.ts            # Axios instance with interceptors
│           └── socket.ts         # Socket.io singleton
│
├── database/
│   ├── migrations/               # 12 sequential PostgreSQL migrations
│   ├── seeds/                    # Initial achievements, medals, cosmetics
│   ├── maps/                     # Era + community map JSON files (10 total)
│   └── seedMaps.ts               # MongoDB map seeder
│
└── docker/
    ├── docker-compose.yml        # Local dev: PostgreSQL + MongoDB + Redis
    └── docker-compose.prod.yml   # Production: nginx + backend + databases
```

---

## Prerequisites

Before running Eras of Empire locally, ensure the following are installed:

| Tool | Version | Install |
|---|---|---|
| **Node.js** | v22+ | https://nodejs.org |
| **pnpm** | v9+ | `npm install -g pnpm` |
| **Docker Desktop** | Latest | https://www.docker.com/products/docker-desktop |
| **VS Code** | Latest | https://code.visualstudio.com |

**Recommended VS Code Extensions:**
- ESLint
- Prettier
- TypeScript and JavaScript Language Features
- Tailwind CSS IntelliSense
- Docker
- REST Client (for testing API endpoints)

---

## Quick Start

Follow these steps in order. Each step must complete successfully before proceeding.

### Step 1 — Clone and Install Dependencies

```bash
# From the project root directory
pnpm install
```

This installs dependencies for both `backend/` and `frontend/` workspaces simultaneously.

### Step 2 — Configure Environment Variables

```bash
# Backend
cp backend/.env.example backend/.env

# Frontend (optional — Vite proxy handles API routing automatically)
cp frontend/.env.example frontend/.env
```

Open `backend/.env` and update the following:
- `JWT_ACCESS_SECRET` — Replace with a long random string (min 64 chars)
- `JWT_REFRESH_SECRET` — Replace with a different long random string (min 64 chars)

All other values match the Docker Compose defaults and do not need changing for local development.

### Step 3 — Start Databases with Docker

```bash
docker-compose -f docker/docker-compose.yml up -d
```

This starts PostgreSQL (port 5432), MongoDB (port 27017), and Redis (port 6379) as background services. Verify they are running:

```bash
docker-compose -f docker/docker-compose.yml ps
```

All three services should show `Up` status.

### Step 4 — Run Database Migrations

```bash
cd backend
pnpm run migrate
```

This creates all PostgreSQL tables (users, games, game_players, etc.).

### Step 5 — Seed Initial Data

```bash
cd backend
pnpm run seed
```

This inserts initial achievements and cosmetic items into PostgreSQL.

### Step 5b — Seed Historical Era Maps (**Required for gameplay**)

```bash
# Still in the backend/ directory
pnpm run seed:maps
```

This seeds all **8 historical era maps** (Ancient, Medieval, Age of Discovery, WWII, Cold War, Modern, American Civil War, Italian Unification) plus 2 community maps into MongoDB. This step is **required** — without it, no games can be started as the map data will not exist. You should see output like:

```
✓ INSERTED: Ancient World (200 AD)          — 28 territories · 40 connections · 8 regions
✓ INSERTED: Medieval World (1200 AD)        — 29 territories · 41 connections · 8 regions
✓ INSERTED: Age of Discovery (1600 AD)      — 34 territories · 51 connections · 8 regions
✓ INSERTED: World War II (1939–1945)        — 35 territories · 53 connections · 8 regions
✓ INSERTED: Cold War (1947–1991)            — 44 territories · 72 connections · 8 regions
✓ INSERTED: The Modern Day                  — 43 territories · 94 connections · 8 regions
✓ INSERTED: American Civil War (1861–1865)  — 18 territories · 37 connections · 6 regions
✓ INSERTED: Italian Unification (1859–1871) — 14 territories · 23 connections · 6 regions
✅ Done.
```

Re-running this command is safe — it updates existing maps without resetting play counts or ratings.

### Step 6 — Start the Backend

```bash
# From the backend/ directory
pnpm run dev
```

The backend starts on **http://localhost:3001**. You should see:

```
🚀 Eras of Empire backend running on http://localhost:3001
   Environment: development
   Frontend URL: http://localhost:5173
```

### Step 7 — Start the Frontend

Open a new terminal:

```bash
# From the frontend/ directory
pnpm run dev
```

The frontend starts on **http://localhost:5173**. Open this URL in your browser.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3001` | Backend server port |
| `FRONTEND_URL` | `http://localhost:5173` | CORS allowed origin |
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `erasofempire` | Database name |
| `POSTGRES_USER` | `chronouser` | Database user |
| `POSTGRES_PASSWORD` | `chronopass` | Database password |
| `MONGO_URI` | `mongodb://...` | MongoDB connection string |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `JWT_ACCESS_SECRET` | **CHANGE THIS** | Access token signing secret |
| `JWT_REFRESH_SECRET` | **CHANGE THIS** | Refresh token signing secret |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token lifetime |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost |

---

## Database Setup

### PostgreSQL Schema

Twelve sequential migrations build the full schema:

| Table | Purpose |
|---|---|
| `users` | Player accounts, stats, MMR, XP, gold balance, equipped cosmetics, guest flag |
| `refresh_tokens` | JWT refresh token store (rotation + revocation) |
| `games` | Game sessions with settings, status, turn timer, ranked flag, join code, async mode |
| `game_players` | Player slots within each game, including faction assignment |
| `game_states` | Serialized game state snapshots per turn (used for reconnection and replays) |
| `achievements` | Achievement definitions |
| `user_achievements` | Player achievement unlocks |
| `friendships` | Friend relationships with direction tracking |
| `game_invites` | Per-game friend invitations (consumed on join) |
| `cosmetics` | Cosmetic item catalog (banners, frames, unit skins, dice skins, map themes, markers) |
| `user_cosmetics` | Player cosmetic ownership |
| `user_ratings` | Glicko-2 `mu` / `phi` / `sigma` per player per rating type (solo, ranked) |
| `ranked_queue` | Active matchmaking queue entries with era, bucket, and socket ID |
| `daily_challenges` | One row per date — era, map, deterministic seed |
| `daily_challenge_entries` | Per-player daily entries (won, turn count, territory count) |
| `gold_transactions` | Audit log for every gold credit/debit |
| `async_notifications` | Email/in-app turn notifications for async game mode |
| `map_reports` | Community map moderation reports |
| `user_campaigns` | Single-player campaign state (current era index, prestige points) |
| `campaign_entries` | Per-era result rows tied to a campaign |

### MongoDB Collections

| Collection | Purpose |
|---|---|
| `custommaps` | Full map data (territories, polygons, connections, regions, projection bounds) |

### Redis Keys

| Key Pattern | Purpose |
|---|---|
| `leaderboard:{era}` | Sorted set of MMR scores per era |
| `session:{userId}` | Active session metadata |

### Migrating from legacy chronoconquest database names

Older setups used PostgreSQL database `chronoconquest` and MongoDB `chronoconquest_maps`. Defaults now use `erasofempire` and `erasofempire_maps`.

- **Keep existing data without moving files:** In `backend/.env`, `.env.production`, and Docker env, set `POSTGRES_DB=chronoconquest` and point `MONGO_URI` at `.../chronoconquest_maps?...` so the app connects to your existing databases.
- **Move to the new names:** Use `pg_dump` / `pg_restore` into `erasofempire`, and `mongodump` / `mongorestore` into `erasofempire_maps`, then update env vars. Docker-only: you can also start fresh volumes with the new names (loses old data unless you dump first).
- **Container renames:** Compose `container_name` values were updated for consistency; data stays in named volumes. After changing env, run `docker compose down` / `up` as needed.

---

## Running the Application

### Development (Recommended)

Run both servers simultaneously using the root workspace script:

```bash
# From project root
pnpm run dev
```

Or run them individually in separate terminals as described in Quick Start.

### Available Scripts

| Location | Command | Description |
|---|---|---|
| Root | `pnpm run dev` | Start both frontend and backend concurrently |
| `backend/` | `pnpm run dev` | Start backend with hot reload (tsx watch) |
| `backend/` | `pnpm run build` | Compile TypeScript to `dist/` |
| `backend/` | `pnpm run migrate` | Run all PostgreSQL migrations |
| `backend/` | `pnpm run seed` | Seed achievements and cosmetics into PostgreSQL |
| `backend/` | `pnpm run seed:maps` | Seed all era maps into MongoDB (**required for gameplay**) |
| `backend/` | `pnpm run test:backend` | Vitest unit tests (combat resolver, missions, map validation) |
| `frontend/` | `pnpm run dev` | Start Vite dev server |
| `frontend/` | `pnpm run build` | Build for production |
| `frontend/` | `pnpm run preview` | Preview production build |
| Root | `pnpm run validate:maps` | Validate all `database/maps/*.json` connection graphs |

### Production (friends beta on the internet)

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for Docker Compose (nginx + API + databases), environment variables, HTTPS, and smoke testing.

---

## Game Mechanics Reference

### Turn Structure

Each player's turn consists of three sequential phases:

1. **Reinforcement (Draft)** — Place new units on owned territories.
   - Base units = `max(3, floor(territories_owned / 3))`
   - Continent bonus added if player controls all territories in a region
   - Card set bonus added if player redeems a valid set of 3 cards

2. **Attack** — Attack adjacent enemy territories any number of times.
   - Attacker rolls up to 3 dice (must leave 1 unit behind)
   - Defender rolls up to 2 dice
   - Highest die compared: higher wins; defender wins ties
   - Capturing a territory earns 1 territory card (once per turn)

3. **Fortify** — Move units along a connected path of owned territories (once per turn, or more with certain tech unlocks).

### Combat Dice Resolution

| Attacker Dice | Defender Dice | Comparisons |
|---|---|---|
| 3 (≥4 units) | 2 (≥2 units) | 2 pairs compared |
| 2 (3 units) | 2 (≥2 units) | 2 pairs compared |
| 1 (2 units) | 2 (≥2 units) | 1 pair compared |
| Any | 1 (1 unit) | 1 pair compared |

All dice rolls use server-side `crypto.randomInt()` — clients never influence outcomes.

### Card Sets

Cards are earned by capturing at least one territory per turn. Valid sets of 3:
- Three of the same symbol (Infantry, Cavalry, or Artillery)
- One of each symbol
- Any two + one Wild card

### Card Set Bonus Schedule

| Redemption # | Bonus Units |
|---|---|
| 1st | 4 |
| 2nd | 6 |
| 3rd | 8 |
| 4th | 10 |
| 5th | 12 |
| 6th | 15 |
| 7th+ | +5 each |

---

## Population & Stability System

Each territory now tracks two new stats:

- **Stability (0–100%)**: Low stability reduces production income, caps unit placement, and risks rebellion. High stability enables population growth and maximizes income.
- **Population (1–10)**: Higher population increases production output (up to 1.5× at max population, 0.5× at minimum). Population grows when stability is high, shrinks when stability is low, and is halved (min 1) when a territory is captured.

**Key mechanics:**

- **Deploy Cap:** If stability < 30%, you may only place 1 unit per draft action on that territory; if < 50%, max 3 units; otherwise, unlimited.
- **Rebellion:** If stability ≤ 10%, each turn there is a 25% chance the territory loses a unit (or revolts if empty).
- **Stability Recovery:** Territories recover stability each turn, with bonuses for garrisoned units and select factions.
- **Population Growth:** If stability ≥ 50%, population may grow (1-in-4 chance per turn); if < 30%, population may shrink (10% chance per turn).
- **Faction Bonuses:** One faction per era (e.g., Rome, Byzantine, Ming, UK, USA, Western Bloc, Union, Papal States) gains +3 stability recovery per turn.
- **Event Cards:** New event cards can increase or decrease stability globally or for a single player.

All stability and population effects are visible in the territory panel. The system is fully server-authoritative and persists in replays and campaign.

---

## Factions & Asymmetric Gameplay

Each era includes 4–6 selectable factions. Factions are chosen at game creation and give each player a distinct identity with:

- **Passive attack or defense bonuses** — e.g., Rome's Testudo negates attacker losses on one exchange; Maurya's war elephants add an extra attack die
- **Extra reinforcement income** — e.g., Han Dynasty (+2/turn), Union Army (+1/turn)
- **Once-per-turn special ability** — activated during the appropriate phase

Example factions per era:

| Era | Factions |
|---|---|
| Ancient | Roman Republic, Parthian Empire, Han Dynasty, Maurya Empire, Carthaginian Republic, Germanic Tribes |
| American Civil War | Union Army, Confederate Army |
| Italian Unification | Kingdom of Sardinia, Austrian Empire, Papal States, Kingdom of the Two Sicilies |
| Modern Day | Western Bloc, Eastern Coalition, Rogue State, Emerging Economy, Petrostate |

All eight eras have complete faction definitions with passive bonuses and unique special abilities.

---

## Technology Tree

Each era has a 4-tier technology tree. Players accumulate tech points each turn and spend them to research nodes. Trees are era-specific and include nodes that grant:

- **+attack or +defense dice**
- **+reinforcement income per turn**
- **+tech point income per turn**
- **Building unlocks** (requires economy mode)
- **Special ability unlocks**
- **Prerequisite chains** across tiers

Each era also has one unique **Wonder structure** — a globally-unique building that only one player per game can construct, providing a powerful passive effect (e.g., global defense bonus, halved tech costs, or extended influence range).

---

## Economy & Buildings

When economy mode is enabled, players earn production points and can construct buildings on owned territories:

| Category | Tier I | Tier II | Tier III |
|---|---|---|---|
| Production | Camp (+1 unit/turn) | Barracks (+2 units/turn) | Arsenal (+4 units/turn) |
| Defense | Palisade (+1 def die) | Fort (+2 def die) | Citadel (+3 def die) |
| Tech | Workshop (+1 TP/turn) | Academy (+2 TP/turn) | University (+3 TP/turn) |
| Special | Port (sea connections) | Lighthouse (coastal bonus) | — |

Higher tiers require the previous tier and specific researched tech nodes.

---

## Event Cards

Each era has a dedicated shuffled event card deck. At configurable intervals, the active player draws a card and resolves its server-computed effect. Effect types include:

- **Units added / removed** — bonus reinforcements or attrition losses
- **Territory transfer** — a neutral or contested territory changes hands
- **Temporary modifiers** — attack/defense bonuses lasting N turns
- **Gold awards** — instant gold for store purchases
- **Stability change** — new event cards can increase or decrease stability globally or for a single player (e.g., Golden Age, Great Famine)

Cards are era-thematic (e.g., plague in Medieval, nuclear tension in Cold War, diplomatic protest in Modern). All effects are resolved server-side.

---

## Victory Conditions

Games support multiple simultaneous victory modes configured at creation:

| Mode | Win Condition |
|---|---|
| **Domination** | Control 100% of all territories |
| **Threshold** | Control a configured percentage of territories |
| **Capital Capture** | Capture all other players' capital territories |
| **Secret Mission** | Complete a privately-assigned secret objective |

### Secret Missions

When enabled, each player is assigned one deterministic (game-id-seeded) objective at game start:

- Capture two specific territories
- Eliminate a specific opponent
- Control a specific region
- Hold a territory count threshold

Missions are hidden from opponents and evaluated server-side each turn.

---

## Map Editor Guide

The Map Editor (`/editor`) allows you to create fully custom maps:

1. **Select the Draw tool** (pencil icon) from the left toolbar
2. **Click on the canvas** to place polygon vertices for a territory
3. **Double-click** to close and save the territory (minimum 3 points)
4. **Click a territory** with the Select tool to rename it and assign a region
5. **Select the Connect tool** (chain icon) and click two territories to draw a border connection (land or sea)
6. **Add Regions** in the right panel — regions group territories and provide army bonuses
7. **Save** your map — it is saved privately and can be submitted for moderation to publish publicly

**Requirements for a valid map:**
- Minimum 6 territories
- Minimum 5 connections
- At least 1 region
- All territories must belong to a region

Published maps appear in the **Community Map Hub** where players rate them and flag inappropriate content. Globe geometry for custom maps is derived from `projection_bounds` and `geo_polygon` in the map document.

---

## Architecture Overview

```
Browser (React + PixiJS / react-globe.gl)
        │
        ├── HTTP (REST)  ──→  Fastify API  ──→  PostgreSQL (users, games, rankings, campaign)
        │                                   ──→  MongoDB (maps)
        │                                   ──→  Redis (cache, leaderboards)
        │
        └── WebSocket  ──→  Socket.io Server  ──→  In-Memory Game State
                                               ──→  AI Bot Engine (worker + timeout guard)
                                               ──→  PostgreSQL (snapshots for reconnection + replay)
```

**Key Design Decisions:**

- **In-memory game state:** Active game states are held in server memory for low-latency real-time updates. State is snapshotted to PostgreSQL at the end of each turn for persistence and reconnection recovery.
- **JWT rotation:** Refresh tokens are rotated on every use and stored as bcrypt hashes, preventing token theft via database compromise.
- **Server-authoritative combat:** All dice rolls occur on the server using `crypto.randomInt()` — clients never control combat outcomes. Event card effects, tech benefits, and faction abilities are all resolved server-side.
- **Fog of War filtering:** When enabled, the server filters the game state before broadcasting to each player, hiding enemy unit counts in non-adjacent territories.
- **AI workers:** Bot turns are executed in a timeout-guarded worker (`runAiWithTimeout.ts`) so a slow AI search never stalls the game loop.
- **Globe rendering:** Territory polygons must follow GeoJSON RFC 7946 winding rules. Canvas coordinates are converted via `projection_bounds` and `geo_polygon` from the MongoDB map document.

---

## Pages & Features

| Page | Route | Description |
|---|---|---|
| Landing | `/` | Public marketing page with feature overview |
| Register | `/register` | Account creation |
| Login | `/login` | Email + password login with JWT refresh cookie |
| Lobby | `/lobby` | Browse open games, create a game, configure era / settings |
| Game | `/game/:id` | Live game: 2D map or 3D globe, HUD, tech tree, buildings, chat |
| Replay | `/game/:id/replay` | Step through all saved turn snapshots at variable playback speed |
| Campaign | `/campaign` | Single-player linear era progression; earn prestige points per victory |
| Daily Challenge | `/daily` | Date-seeded challenge with daily leaderboard |
| Tutorial | `/tutorial` | Interactive tutorial with in-map overlay guidance slides |
| Map Editor | `/editor` | Create custom maps with D3 polygon drawing tools |
| Map Hub | `/maps` | Browse, rate, and report community maps |
| Friends | `/friends` | Add friends, manage pending requests, send game invites |
| Store | `/store` | Browse cosmetics catalog; purchase with gold; equip loadout |
| Profile | `/profile/:id` | Stats, achievements, match history, equipped cosmetics |
| Privacy Policy | `/privacy` | Privacy policy |

### Ranked Matchmaking

Three time buckets: **Blitz (2 min/turn)**, **Standard (5 min/turn)**, and **Long (20 min/turn)**. The queue uses Glicko-2 ratings — players are matched within a dynamic threshold that widens over wait time. Ratings update after each ranked game completes.

### Async / Play-by-Email Mode

Games can be created in async mode with per-turn deadlines. When it is a player's turn the system dispatches `async_notifications` (email channel) so participants can play at their own pace.

### Guest Play

Players can start games as guests without registering. Guest accounts are fully functional in-game but are blocked from ranked queues, the store (purchases), and the campaign via the `rejectGuest` middleware.

### Join Codes

Every game optionally has an 8-character join code. Share it with friends to bypass the lobby browser. In-game friend invitations are tracked via `game_invites` and consumed on join.

---

## Troubleshooting

| Symptom | Things to check |
|--------|-------------------|
| API calls fail or CORS errors | `FRONTEND_URL` and optional `CORS_ORIGINS` in `backend/.env` must include your web origin (e.g. `http://localhost:5173`). |
| `401` on `/api/auth/refresh` | Refresh cookie `SameSite`/HTTPS: see `REFRESH_COOKIE_SAME_SITE` in `backend/.env.example`. Ensure frontend uses the Vite proxy or matching API URL. |
| Socket disconnects or "Game not found" | Socket auth requires a valid access token in the handshake; URL `gameId` must match a Postgres game row. Rejoin is sent automatically on reconnect (see `GamePage.tsx`). |
| Map not rendering | Run `pnpm run seed:maps` from `backend/` so MongoDB has map documents. For custom geometry issues on the globe, see [docs/GLOBE_2D_CHECKLIST.md](docs/GLOBE_2D_CHECKLIST.md). |
| Globe polygons appear black or corrupt | Avoid extremely low `polygonCapCurvatureResolution`; verify GeoJSON exterior ring winding and that `projection_bounds` / `geo_polygon` are correct in the map document. |

## Automated Checks

From the repository root:

- `pnpm run test:backend` — Vitest unit tests (combat resolver, secret missions, map connection validation).
- `pnpm run validate:maps` — validates all `database/maps/*.json` connection graphs.

Snapshot and restart behavior for ops: [docs/OPERATIONS.md](docs/OPERATIONS.md).

---

## Development Notes

### Adding a New Historical Era

1. Create a map JSON in `database/maps/` and run `pnpm run seed:maps`
2. Add faction, tech tree, and wonder definitions in `backend/src/game-engine/eras/<era>.ts` and export from `index.ts`
3. Add an event card deck in `backend/src/game-engine/events/decks/<era>.ts` and register it in `eventCardManager.ts`
4. Register the era ID in `frontend/src/constants/` and `frontend/src/pages/LobbyPage.tsx`
5. (Optional) Add era-specific background music and card artwork in `frontend/src/assets/`

### Adding a New AI Difficulty Level

Edit `backend/src/game-engine/ai/aiBot.ts`:
1. Add the new level to `DIFFICULTY_CONFIG`
2. Adjust `depth` (search depth) and `randomFactor` (0.0 = deterministic, 1.0 = random)

### Extending the Game Engine

The game engine is fully decoupled from the socket layer:
- `combat/combatResolver.ts` — Pure functions, no side effects, fully unit tested
- `state/gameStateManager.ts` — Immutable-style state mutations
- `ai/aiBot.ts` — Stateless heuristic evaluation; wrapped by `runAiWithTimeout.ts`
- `events/eventCardManager.ts` — Deck drawing and server-side effect application
- `victory/missions.ts` — Deterministic seeded mission assignment and evaluation
- `eras/index.ts` — Barrel export for era factions, tech trees, and wonders

---

## License

This project is proprietary. All rights reserved.

---

*Eras of Empire — April 2026*
