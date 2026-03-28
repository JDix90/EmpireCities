# ChronoConquest

> A browser-based historical world map strategy game inspired by Risk — featuring five playable eras, a custom map editor, real-time multiplayer, AI opponents, and a full JWT authentication system.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Prerequisites](#prerequisites)
5. [Quick Start](#quick-start)
6. [Environment Variables](#environment-variables)
7. [Database Setup](#database-setup)
8. [Running the Application](#running-the-application)
9. [Game Mechanics Reference](#game-mechanics-reference)
10. [Map Editor Guide](#map-editor-guide)
11. [Architecture Overview](#architecture-overview)
12. [Development Notes](#development-notes)
13. [Roadmap](#roadmap)

---

## Project Overview

ChronoConquest is a full-stack web application where players command armies across historically accurate maps spanning five eras:

| Era | Period | Key Feature |
|---|---|---|
| Ancient World | 3000 BC – 400 AD | Egyptian, Roman, Persian empires |
| Medieval Era | 400 – 1400 AD | Feudal kingdoms, Mongol expansion |
| Age of Discovery | 1400 – 1800 AD | Colonial empires, sea routes |
| World War II | 1939 – 1945 | Axis vs. Allies, theatre-based play |
| Cold War | 1945 – 1991 | NATO vs. Warsaw Pact, proxy wars |

Players draft reinforcements, attack adjacent territories, and fortify positions each turn. Victory is achieved through domination (controlling all territories), threshold control, or capital capture, depending on game settings.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + TypeScript + Vite + TailwindCSS |
| **Map Rendering** | PixiJS v7 (WebGL canvas) |
| **Map Editor** | D3.js v7 (SVG-based polygon drawing) |
| **State Management** | Zustand |
| **Real-time** | Socket.io v4 (WebSockets) |
| **Backend API** | Node.js 22 + TypeScript + Fastify |
| **Authentication** | Custom JWT (access + refresh token rotation) |
| **Relational DB** | PostgreSQL 16 |
| **Document DB** | MongoDB 7 (custom maps) |
| **Cache** | Redis 7 (sessions, leaderboards) |
| **ORM** | Drizzle ORM (PostgreSQL) + Mongoose (MongoDB) |
| **AI Bots** | Server-side heuristic Minimax with Alpha-Beta Pruning |
| **Dev Environment** | Docker Compose + VS Code |

---

## Project Structure

```
chronoconquest/
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
│       │   └── authenticate.ts   # JWT auth middleware
│       ├── modules/
│       │   ├── auth/             # Register, login, refresh, logout
│       │   ├── users/            # Profile, achievements, leaderboard
│       │   ├── games/            # Game CRUD, lobby, join
│       │   └── maps/             # Custom map CRUD, publish, rate
│       ├── sockets/
│       │   └── gameSocket.ts     # Socket.io real-time game server
│       ├── game-engine/
│       │   ├── combat/           # Dice resolver, card bonuses, reinforcements
│       │   ├── state/            # Game state initializer and mutators
│       │   └── ai/               # AI bot heuristic engine
│       ├── types/                # Shared TypeScript interfaces
│       └── utils/
│           └── jwt.ts            # Token sign/verify utilities
│
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── index.html
│   ├── .env.example              # ← Copy to .env if needed
│   └── src/
│       ├── main.tsx              # React entry point
│       ├── App.tsx               # Router + route guards
│       ├── index.css             # Tailwind + global styles
│       ├── pages/
│       │   ├── LandingPage.tsx   # Public marketing page
│       │   ├── LoginPage.tsx     # Authentication
│       │   ├── RegisterPage.tsx  # Account creation
│       │   ├── LobbyPage.tsx     # Game browser + create game
│       │   ├── GamePage.tsx      # Main game view (map + HUD)
│       │   ├── MapEditorPage.tsx # Custom map creation tool
│       │   ├── ProfilePage.tsx   # User stats and history
│       │   ├── MapHubPage.tsx    # Community map browser
│       │   └── NotFoundPage.tsx
│       ├── components/
│       │   └── game/
│       │       ├── GameMap.tsx       # PixiJS WebGL map renderer
│       │       ├── GameHUD.tsx       # Phase controls, player list, cards
│       │       └── TerritoryPanel.tsx # Territory action panel
│       ├── store/
│       │   ├── authStore.ts      # Zustand auth state
│       │   └── gameStore.ts      # Zustand game state
│       └── services/
│           ├── api.ts            # Axios instance with interceptors
│           └── socket.ts         # Socket.io singleton
│
└── docker/
    └── docker-compose.yml        # PostgreSQL + MongoDB + Redis
│
├── database/
    ├── migrations/
    │   └── 001_initial_schema.sql  # All PostgreSQL tables
    ├── seeds/
    │   └── 001_seed_data.sql       # Initial achievements + cosmetics
    ├── maps/
    │   ├── era_ancient.py          # Ancient World territory generator
    │   ├── era_medieval.py         # Medieval World territory generator
    │   ├── era_discovery.py        # Age of Discovery territory generator
    │   ├── era_ww2.py              # WWII territory generator
    │   ├── era_coldwar.py          # Cold War territory generator
    │   ├── validate_and_export.py  # Validates and exports all maps to JSON
    │   ├── era_ancient.json        # Generated map data (170 total territories)
    │   ├── era_medieval.json
    │   ├── era_discovery.json
    │   ├── era_ww2.json
    │   └── era_coldwar.json
    └── seedMaps.ts                 # MongoDB map seeder (run via pnpm seed:maps)
```

---

## Prerequisites

Before running ChronoConquest locally, ensure the following are installed:

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

This seeds all **5 historical era maps** (Ancient, Medieval, Age of Discovery, WWII, Cold War) into MongoDB. This step is **required** — without it, no games can be started as the map data will not exist. You should see output like:

```
✓ INSERTED: Ancient World (200 AD)    — 28 territories · 37 connections · 8 regions
✓ INSERTED: Medieval World (1200 AD)  — 29 territories · 42 connections · 8 regions
✓ INSERTED: Age of Discovery (1600 AD)— 34 territories · 49 connections · 8 regions
✓ INSERTED: World War II (1939–1945)  — 35 territories · 48 connections · 8 regions
✓ INSERTED: Cold War (1947–1991)      — 44 territories · 61 connections · 8 regions
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
🚀 ChronoConquest backend running on http://localhost:3001
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
| `POSTGRES_DB` | `chronoconquest` | Database name |
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

The migration creates the following tables:

| Table | Purpose |
|---|---|
| `users` | Player accounts, stats, MMR, XP |
| `refresh_tokens` | JWT refresh token store (rotation + revocation) |
| `games` | Game sessions with settings and status |
| `game_players` | Player slots within each game |
| `game_states` | Serialized game state snapshots per turn |
| `achievements` | Achievement definitions |
| `user_achievements` | Player achievement unlocks |
| `friendships` | Friend relationships |
| `cosmetics` | Cosmetic item catalog |
| `user_cosmetics` | Player cosmetic ownership |

### MongoDB Collections

| Collection | Purpose |
|---|---|
| `custommaps` | Full map data (territories, polygons, connections, regions) |

### Redis Keys

| Key Pattern | Purpose |
|---|---|
| `leaderboard:{era}` | Sorted set of MMR scores per era |
| `session:{userId}` | Active session metadata |

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
| Root | `pnpm run dev` | Start both frontend and backend |
| `backend/` | `pnpm run dev` | Start backend with hot reload (tsx watch) |
| `backend/` | `pnpm run build` | Compile TypeScript to `dist/` |
| `backend/` | `pnpm run migrate` | Run PostgreSQL migrations |
| `backend/` | `pnpm run seed` | Seed initial data |
| `frontend/` | `pnpm run dev` | Start Vite dev server |
| `frontend/` | `pnpm run build` | Build for production |
| `frontend/` | `pnpm run preview` | Preview production build |

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

3. **Fortify** — Move units along a connected path of owned territories (once per turn).

### Combat Dice Resolution

| Attacker Dice | Defender Dice | Comparisons |
|---|---|---|
| 3 (≥4 units) | 2 (≥2 units) | 2 pairs compared |
| 2 (3 units) | 2 (≥2 units) | 2 pairs compared |
| 1 (2 units) | 2 (≥2 units) | 1 pair compared |
| Any | 1 (1 unit) | 1 pair compared |

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

## Map Editor Guide

The Map Editor (`/editor`) allows you to create fully custom maps:

1. **Select the Draw tool** (pencil icon) from the left toolbar
2. **Click on the canvas** to place polygon vertices for a territory
3. **Double-click** to close and save the territory (minimum 3 points)
4. **Click a territory** with the Select tool to rename it and assign a region
5. **Select the Connect tool** (chain icon) and click two territories to draw a border connection
6. **Add Regions** in the right panel — regions group territories and provide army bonuses
7. **Save** your map — it is saved privately and can be submitted for moderation to publish publicly

**Requirements for a valid map:**
- Minimum 6 territories
- Minimum 5 connections
- At least 1 region
- All territories must belong to a region

---

## Architecture Overview

```
Browser (React + PixiJS)
        │
        ├── HTTP (REST)  ──→  Fastify API  ──→  PostgreSQL (users, games)
        │                                   ──→  MongoDB (maps)
        │                                   ──→  Redis (cache, leaderboards)
        │
        └── WebSocket  ──→  Socket.io Server  ──→  In-Memory Game State
                                               ──→  AI Bot Engine
                                               ──→  PostgreSQL (state snapshots)
```

**Key Design Decisions:**

- **In-memory game state**: Active game states are held in server memory for low-latency real-time updates. State is snapshotted to PostgreSQL at the end of each turn for persistence and reconnection recovery.
- **JWT rotation**: Refresh tokens are rotated on every use and stored as bcrypt hashes, preventing token theft via database compromise.
- **Server-authoritative combat**: All dice rolls occur on the server using Node.js `crypto.randomInt()` — clients never control combat outcomes.
- **Fog of War filtering**: When enabled, the server filters the game state before broadcasting to each player, hiding enemy unit counts in non-adjacent territories.

---

## Development Notes

### Adding a New Historical Era

1. Create a new map document in MongoDB with `era_theme` set to the new era ID
2. Add the era ID to the `ERAS` array in `frontend/src/pages/LobbyPage.tsx`
3. Add era-specific territory card artwork in `frontend/src/assets/cards/`
4. (Optional) Add era-specific background music tracks

### Adding a New AI Difficulty Level

Edit `backend/src/game-engine/ai/aiBot.ts`:
1. Add the new level to `DIFFICULTY_CONFIG`
2. Adjust `depth` (search depth) and `randomFactor` (0.0 = deterministic, 1.0 = random)

### Extending the Game Engine

The game engine is fully decoupled from the socket layer:
- `combatResolver.ts` — Pure functions, no side effects, easy to unit test
- `gameStateManager.ts` — Immutable-style state mutations
- `aiBot.ts` — Stateless heuristic evaluation

---

## Roadmap

### Phase 1 — MVP (Current)
- [x] JWT authentication (register, login, refresh, logout)
- [x] Game creation and lobby system
- [x] Real-time multiplayer via Socket.io
- [x] Full turn-based game engine (draft, attack, fortify)
- [x] AI bot opponents (Easy, Medium, Hard, Expert)
- [x] Territory card system with escalating bonuses
- [x] Custom map editor with D3.js polygon drawing
- [x] Community map hub with ratings
- [x] Player profiles with game history

### Phase 2 — Enhancement
- [ ] Built-in historical maps for all 5 eras (SVG polygon data)
- [ ] Fog of War visual implementation on PixiJS canvas
- [ ] Diplomacy system (alliances, truces, trade)
- [ ] Secret mission victory cards
- [ ] Asynchronous (play-by-email) game mode
- [ ] In-game chat with profanity filter

### Phase 3 — Community
- [ ] Ranked matchmaking with MMR-based pairing
- [ ] Tournaments and seasonal leaderboards
- [ ] Map moderation dashboard
- [ ] Replay system (turn-by-turn game replay)
- [ ] Mobile-responsive layout improvements

### Phase 4 — Monetization
- [ ] Cosmetic store (territory themes, unit skins, dice skins)
- [ ] Battle Pass seasonal content
- [ ] Premium map packs

---

## License

This project is proprietary. All rights reserved.

---

*Built with ChronoConquest v1.0.0 — March 2026*
