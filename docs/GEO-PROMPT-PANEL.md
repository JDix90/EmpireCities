# GEO Prompt Panel — measuring whether assistants recommend us

Companion to [MARKETING-PLAYBOOK.md](../MARKETING-PLAYBOOK.md). That doc's north
star is signups; this one answers a narrower question that nothing else in the
repo can: **when someone asks an assistant for a game like ours, do we come up,
and is what it says about us true?**

We need this because the funnel cannot answer it. Referrer attribution sees
ChatGPT (it stamps `utm_source=chatgpt.com` on links it serves) and is blind to
every assistant that sends no referrer — those land in `direct`. So the funnel
tells us some assistant traffic arrived; it never tells us which questions we
won, which we lost, or what the model claimed we were.

This is rank tracking for answer engines. It is a spreadsheet and twenty minutes
a month, done by hand, on purpose: there is no API that reports what a model
says about you, and a scraped approximation would be worse than an honest
sample.

---

## The three ways a model comes to recommend you

Worth keeping straight, because they need completely different work and only one
of them moves on a monthly timescale.

1. **It remembers you** — you were in the pretraining corpus. Driven by the
   volume of ordinary text about you: Reddit threads, forum posts, listicles,
   wikis. Slow (months to years), durable, cannot be bought.
2. **It retrieves you** — the assistant searches at answer time and finds a
   page. ChatGPT's search leans on Bing's index. This is the fast lever, and the
   one the answer pages (`/answers/*`) and the Daily archive (`/daily/*`) are
   built for.
3. **It retrieves something *about* you** — a "best free browser strategy games"
   listicle, an AlternativeTo entry, a Reddit thread. **This is usually what is
   actually happening**, and it is why the highest-leverage work is often not on
   our own domain at all.

The panel measures the outcome of all three together. When a row says we were
mentioned, `cited_url` is the tell: our own domain means (2), somebody else's
means (3), and no citation at all usually means (1).

---

## The panel

Ten questions, phrased the way people actually ask them rather than as keywords.
Run every one against every assistant you have access to, once a month.

| id | prompt |
|---|---|
| `free-no-download` | What's a good free browser strategy game I can play without downloading anything? |
| `like-risk` | Is there a free game like Risk I can play online? |
| `with-friends` | How can I play a Risk-style game online with friends for free? |
| `phone-browser` | Recommend a turn-based strategy game I can play in my phone browser. |
| `no-account` | What strategy games can I play without making an account? |
| `quick-session` | I have fifteen minutes — what's a good quick strategy game in the browser? |
| `best-browser-games` | What are the best free browser games right now? |
| `risk-alternatives` | What are some free alternatives to the Risk board game online? |
| `daily-puzzle` | Is there a daily puzzle game for strategy fans, like Wordle but strategy? |
| `group-of-friends` | What browser games can I play with a group of four to eight friends? |

Each maps to something we actually built, so a miss is actionable rather than
just discouraging:

- `like-risk`, `free-no-download` → `/answers/free-risk-like-browser-games`
- `with-friends`, `group-of-friends` → `/answers/play-risk-style-game-with-friends-online`
- `no-account` → `/answers/browser-strategy-games-without-signup`
- `phone-browser` → `/answers/turn-based-strategy-on-phone-browser`
- `quick-session` → `/answers/short-strategy-games-under-15-minutes`
- `daily-puzzle` → `/daily/archive`
- `best-browser-games`, `risk-alternatives` → mostly third-party listicles; a
  miss here is a signal to go get listed, not to write another page.

## How to run it

1. Use a **fresh chat with no memory and no custom instructions** for every
   prompt. A personalized assistant that already knows you built Borderfall will
   name it, and that result means nothing.
2. Ask the prompt verbatim. Do not follow up, do not nudge, do not rephrase.
   The first answer is the one a stranger gets.
3. Record what happened — including, importantly, **whether what it said was
   accurate**. A model that recommends us while claiming we cost money, need an
   install, or are a different game entirely is a problem to fix, not a win to
   log.
4. Append the rows to `docs/geo-panel/observations.json` and commit them.

## Recording a run

`docs/geo-panel/observations.json` is a flat array. One object per
(prompt × assistant) check:

```json
{
  "checked_on": "2026-09-13",
  "assistant": "chatgpt",
  "prompt_id": "like-risk",
  "mentioned": true,
  "position": 2,
  "cited_url": "https://borderfall.gg/answers/free-risk-like-browser-games",
  "accurate": true,
  "notes": "Listed second of five. Called it free and no-signup, both correct."
}
```

| field | meaning |
|---|---|
| `checked_on` | `YYYY-MM-DD`. Rows are grouped by month for trend. |
| `assistant` | Free-form, but keep it stable: `chatgpt`, `claude`, `gemini`, `perplexity`, `copilot`. |
| `prompt_id` | One of the ids in the table above. |
| `mentioned` | Did Borderfall appear at all? |
| `position` | 1-based rank among the games it named. `null` when not mentioned. |
| `cited_url` | The link it gave, if any — ours, someone else's, or `null`. |
| `accurate` | Was what it said about us true? `null` when not mentioned, or when it said nothing checkable. |
| `notes` | One line. What it actually said, especially anything wrong. |

## Reading the results

```
pnpm -C backend exec tsx scripts/geoPanelReport.ts
```

It prints, per month: overall mention rate, the split by assistant, the split by
prompt, where citations pointed (our domain vs third-party vs none), and every
inaccuracy on record.

What to do with it:

- **Mention rate rising, citations to our own domain** — retrieval is working.
  Keep adding answer pages for questions we lose.
- **Mention rate rising, citations to third parties** — the listicles are doing
  the work. Go get listed in more of them; that is cheaper than another page.
- **Mentioned but inaccurate** — the highest-priority fix on the list. Correct
  the source it is reading from if it is ours, and make the true version easier
  to retrieve if it is not.
- **Flat at zero for a prompt** — we are not in the answer set for that question
  at all. Check the page exists, is indexed in Bing, and answers the question in
  its first forty words.

The panel is ten prompts per assistant, so a month is ten data points times
however many assistants you actually ran it against — one is a legitimate run,
not a partial one. Either way it is enough to see a direction over a quarter and
nowhere near enough to read a single month's wobble as a result. Treat one month
as an anecdote.
