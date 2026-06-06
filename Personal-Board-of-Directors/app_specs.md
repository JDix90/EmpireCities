# Personal Board of Directors — App Specifications

**Author:** Manus AI  
**Version:** 1.0  
**Date:** June 2026

---

## 1. Onboarding Flow

The onboarding experience must accomplish three things in under 3 minutes: demonstrate the core value, create emotional connection, and get the user to their first board meeting. Every screen earns the next screen.

### Flow Diagram

```
[1] Welcome → [2] Sign Up → [3] "What's on your mind?" → [4] Pick Your Board → [5] First Meeting Demo → [6] Dashboard
```

### Screen-by-Screen Specification

**Screen 1: Welcome**
- Headline: "You already know the answer. Let's help you hear it."
- Subtext: "Meet your Personal Board of Directors — AI advisors who debate your decisions so you don't have to do it alone."
- Single CTA: "Build Your Board"
- Tone: Warm, intriguing, slightly mysterious

**Screen 2: Account Creation**
- Options: Google OAuth, Apple OAuth, Email/Password
- Minimal fields — name and email only
- No onboarding survey, no demographic questions (reduces friction)

**Screen 3: Initial Decision Prompt**
- Prompt: "What's one decision that's been living in your head rent-free?"
- Text input with placeholder examples that rotate: "Should I ask for a raise?", "Is it time to move?", "Should I start that project?"
- Skip option available (but discouraged through design — the input is prominent)
- Purpose: Creates immediate investment and demonstrates the app responds to *their* life

**Screen 4: Board Selection**
- Display: 5 advisor cards (MVP library) with name, one-line description, and visual avatar
- Instruction: "Choose 3–5 advisors for your board. You can change these anytime."
- Each card has a brief personality preview on tap/hover
- Recommended starter boards suggested: "The Balanced Board" (CFO + Adventurer + Therapist + Future Self)

**Screen 5: First Board Meeting (Demo)**
- If user provided a decision in Screen 3: Run a shortened debate (1 round + votes) using their actual input
- If user skipped: Show a pre-generated example meeting with a relatable decision
- Purpose: Immediate "aha moment" — user sees the product working on something real

**Screen 6: Dashboard Landing**
- Brief tooltip tour (3 points max): "Start a new meeting here", "Your past decisions live here", "Your insights grow here"
- Immediate access to start a new board meeting

### Onboarding Principles

| Principle | Implementation |
|-----------|---------------|
| Show, don't tell | Demo meeting in onboarding uses real or user-provided content |
| Progressive disclosure | Advanced features (custom advisors, insights) revealed over time |
| Emotional hook first | The decision prompt creates personal investment before any feature explanation |
| Minimal friction | 2 taps to account creation, 1 tap per advisor selection |
| Tone consistency | Every screen maintains the "useful, slightly weird, emotionally intelligent" voice |

---

## 2. User Stories

### Epic 1: Core Decision Loop

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-01 | As a user, I want to submit a decision with context and options so my board can debate it | Text fields for question (required), context (optional), and 2–5 options (required). 500-char limit per field. |
| US-02 | As a user, I want to watch my advisors debate my decision so I can see multiple perspectives | Debate generates in 2–3 rounds. Each advisor speaks 2–4 sentences per round. Debate completes in <30 seconds. |
| US-03 | As a user, I want to see each advisor's vote and rationale so I understand their recommendation | Vote display shows: advisor name, vote (Yes/No/Abstain), confidence level, one-sentence rationale. |
| US-04 | As a user, I want to record my final decision so I can track what I chose | Single selection from original options + optional "I chose something else" with text input. |
| US-05 | As a user, I want to track the outcome of past decisions so my board can learn | Outcome options: Successful, Mixed, Unsuccessful. Satisfaction: 1–5 scale. Optional reflection text. |

### Epic 2: Board Management

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-06 | As a user, I want to select advisors for my board so I get perspectives I value | Select 3–5 from available library. Visual cards with personality previews. |
| US-07 | As a user, I want to swap advisors on my board so I can experiment with different perspectives | Add/remove from board settings. Changes apply to future meetings only. |
| US-08 | As a premium user, I want to create a custom advisor so I can add perspectives unique to my life | Define: name, core values, reasoning style, communication tone. 200-char description. |

### Epic 3: Insights and Learning

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-09 | As a user, I want to view my decision history so I can reflect on past choices | Chronological list with: date, decision summary, vote outcome, user choice, tracked outcome (if available). |
| US-10 | As a user, I want to see advisor accuracy over time so I know which perspectives serve me best | Per-advisor stats: total votes, accuracy rate, alignment with user choices. |
| US-11 | As a user, I want to see patterns in my decisions so I understand my tendencies | Category breakdown, decision frequency, outcome trends, satisfaction trends. |

### Epic 4: Engagement

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-12 | As a user, I want to receive gentle reminders to track outcomes so the system can learn | Push notification or email 7 days after decision, then 30 days. Max 2 reminders per decision. |
| US-13 | As a user, I want to see how my board has evolved so I feel the system is growing with me | "Board Evolution" view showing recalibration history and accuracy improvements. |

---

## 3. Feature Specifications

### 3.1 Board Meeting Engine

The core feature that orchestrates the AI debate and voting process.

**Technical Requirements:**

| Requirement | Specification |
|-------------|--------------|
| LLM Provider | OpenAI GPT-4o or equivalent (configurable) |
| Response time | Full debate (3 rounds + votes) completes in <30 seconds |
| Streaming | Advisor responses stream in real-time for perceived speed |
| Concurrency | Support 100 simultaneous board meetings |
| Token budget | Max 4,000 tokens per full meeting (input + output) |
| Retry logic | 3 retries with exponential backoff on LLM failures |
| Fallback | Graceful degradation message if LLM unavailable |

**Functional Requirements:**

- Each meeting produces: opening statements, 1–2 cross-examination rounds, final positions, and votes
- Advisors reference each other's arguments (not isolated responses)
- Debate quality degrades gracefully with fewer advisors (minimum 3)
- Meetings are saved immediately and can be re-read at any time

### 3.2 Outcome Tracking System

**Tracking Triggers:**
- 7-day reminder after decision recorded
- 30-day reminder if no outcome tracked
- User can track outcome at any time from decision history

**Outcome Schema:**
- Outcome: Successful | Mixed | Unsuccessful | Too Early to Tell
- Satisfaction: 1 (regret) to 5 (very satisfied)
- Reflection: Optional free-text (500 chars max)
- Follow-up decision: Optional link to a new decision spawned from this outcome

### 3.3 Insights Dashboard

**MVP Insights:**
- Total decisions made
- Outcome distribution (pie chart)
- Average satisfaction score
- Most-used advisors
- Decision category breakdown

**V1 Insights (Premium):**
- Advisor accuracy leaderboard
- Decision velocity trends (time from submission to choice)
- Satisfaction trends over time
- Category-specific patterns
- "Your board's biggest disagreements" highlight reel

---

## 4. Data Model

### Entity Relationship Overview

```
User (1) ──── (M) UserBoard ──── (M) AdvisorArchetype
  │                                        │
  │                                        │
  └──── (M) Decision ──── (M) BoardMeetingLog
                │
                └──── (1) DecisionOutcome
```

### Table Definitions

**users**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, NOT NULL | Unique user identifier |
| email | VARCHAR(255) | UNIQUE, NOT NULL | User email |
| password_hash | VARCHAR(255) | NULLABLE | Null for OAuth users |
| display_name | VARCHAR(100) | NOT NULL | User's display name |
| auth_provider | ENUM('email','google','apple') | NOT NULL | Authentication method |
| subscription_tier | ENUM('free','premium') | DEFAULT 'free' | Current subscription |
| created_at | TIMESTAMP | NOT NULL | Account creation time |
| last_active_at | TIMESTAMP | NOT NULL | Last activity timestamp |

**advisor_archetypes**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, NOT NULL | Unique archetype identifier |
| name | VARCHAR(50) | UNIQUE, NOT NULL | Display name (e.g., "The CFO") |
| slug | VARCHAR(50) | UNIQUE, NOT NULL | URL-safe identifier |
| description | TEXT | NOT NULL | Full persona description |
| reasoning_profile | JSONB | NOT NULL | Structured reasoning profile |
| is_premium | BOOLEAN | DEFAULT false | Premium-only flag |
| sort_order | INTEGER | NOT NULL | Display ordering |

**user_boards**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, NOT NULL | Unique record identifier |
| user_id | UUID | FK → users.id, NOT NULL | Board owner |
| archetype_id | UUID | FK → advisor_archetypes.id, NOT NULL | Selected advisor |
| custom_prompt | TEXT | NULLABLE | Custom persona override (premium) |
| recalibration_data | JSONB | NULLABLE | Accumulated learning data |
| added_at | TIMESTAMP | NOT NULL | When advisor was added |
| is_active | BOOLEAN | DEFAULT true | Currently on board |

**decisions**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, NOT NULL | Unique decision identifier |
| user_id | UUID | FK → users.id, NOT NULL | Decision owner |
| question | TEXT | NOT NULL, max 500 chars | The decision question |
| context | TEXT | NULLABLE, max 2000 chars | Background context |
| options | JSONB | NOT NULL | Array of option strings |
| category | VARCHAR(50) | NULLABLE | Auto-classified category |
| final_choice | TEXT | NULLABLE | What user decided |
| created_at | TIMESTAMP | NOT NULL | Submission time |
| decided_at | TIMESTAMP | NULLABLE | When user recorded choice |

**decision_outcomes**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, NOT NULL | Unique outcome identifier |
| decision_id | UUID | FK → decisions.id, UNIQUE, NOT NULL | Related decision |
| outcome | ENUM('successful','mixed','unsuccessful','too_early') | NOT NULL | Result |
| satisfaction | INTEGER | NOT NULL, CHECK 1–5 | User satisfaction |
| reflection | TEXT | NULLABLE, max 500 chars | Optional reflection |
| tracked_at | TIMESTAMP | NOT NULL | When outcome was recorded |

**board_meeting_logs**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, NOT NULL | Unique log entry identifier |
| decision_id | UUID | FK → decisions.id, NOT NULL | Related decision |
| archetype_id | UUID | FK → advisor_archetypes.id, NOT NULL | Speaking advisor |
| phase | ENUM('opening','cross_exam','final','vote') | NOT NULL | Debate phase |
| round_number | INTEGER | NOT NULL | Round within phase |
| content | TEXT | NOT NULL | Advisor's statement |
| vote | ENUM('yes','no','abstain') | NULLABLE | Vote (only in vote phase) |
| vote_confidence | ENUM('high','medium','low') | NULLABLE | Vote confidence |
| vote_rationale | TEXT | NULLABLE | One-line vote explanation |
| created_at | TIMESTAMP | NOT NULL | Generation timestamp |

---

## 5. API Endpoints (V1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/signup | Create account |
| POST | /api/auth/login | Authenticate |
| GET | /api/advisors | List available archetypes |
| GET | /api/board | Get user's current board |
| PUT | /api/board | Update board composition |
| POST | /api/decisions | Submit a new decision |
| POST | /api/decisions/:id/meeting | Generate board meeting |
| PUT | /api/decisions/:id/choice | Record final choice |
| POST | /api/decisions/:id/outcome | Track outcome |
| GET | /api/decisions | List decision history |
| GET | /api/insights | Get insights/analytics |

---

*This specification document provides the technical foundation for development. All features should be implemented incrementally, with the core decision loop (US-01 through US-05) as the first development sprint.*
