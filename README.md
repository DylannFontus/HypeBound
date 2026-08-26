# HYPEBOUND

A comedic internet-culture collectible card game. Deterministic TypeScript rules
engine, three.js battle board, browser-first (desktop mouse + mobile landscape
touch).

> **Working title.** The folder name is historical; the game is called HYPEBOUND
> everywhere in code and docs.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Full test suite (engine rules, data validation, AI) |
| `npm run validate` | Validate every card and data file only — run this after editing `data/` |
| `npm run typecheck` | TypeScript only, no emit |
| `npm run verify:ui` | Headless-browser smoke test: walks every screen, plays a real match vs the AI, fails on any console error, writes screenshots to `scripts/screenshots/` |

`npm run verify:ui` needs the dev server already running in another terminal.

---

## The three things you will do most

### 1. Add or change a card — no code required

Card behaviour is **data**, interpreted by the engine. Open the faction file in
[`data/cards/`](data/cards/) and add an object to the array:

```jsonc
{
  "id": "idols-fan-chant",          // kebab-case, faction-prefixed, globally unique
  "name": "Fan Chant",
  "faction": "neon-idols",
  "current": "halo",                 // must be one of the faction's Currents
  "type": "action",
  "rarity": "common",
  "cost": 1,
  "tags": ["performance"],
  "keywords": [],
  "effects": [
    {
      "trigger": "onPlay",
      "target": { "select": "choose", "side": "friendly", "zone": "board" },
      "ops": [{ "op": "buff", "target": { "select": "triggering" }, "attack": 2, "health": 1 }]
    }
  ],
  "text": "Give a friendly character +2/+1.",
  "flavor": "Eight thousand people. One syllable. Perfectly on the beat."
}
```

Then run `npm run validate`. The validator checks the schema, the faction's
Current legality, stat budgets, keyword requirements, and that every `summon`
and `transform` points at a card that exists. Errors name the offending card id.

A new card appears in the collection, the deck builder and the AI's card pool
automatically — nothing else to touch.

The full field-by-field reference is [`docs/tech/01-card-schema.md`](docs/tech/01-card-schema.md);
the authoritative source is [`src/engine/types.ts`](src/engine/types.ts).

**Adding a whole new faction:** drop `data/cards/<faction>.json` in place and add
the faction to `data/factions.json`. Card files are auto-discovered — there is no
index to update.

### 2. Add your card art

Drop an image at:

```
public/assets/art/<card-id>.png     (or .webp / .jpg)
```

That's it. The renderer picks it up on next load. Until a file exists, the card
shows generated placeholder art (a Current-themed composition derived from the
card's name) so the game always looks finished.

Source art should be **512×680**. The frame crops differently per Current — see
[`docs/art/01-art-requirements.md`](docs/art/01-art-requirements.md) for the
safe-frame diagram.

### 3. Add music and sound

Drop audio files under `public/assets/audio/`, then point the slot at them in
[`data/audio-manifest.json`](data/audio-manifest.json):

```jsonc
"music.battle.neon-idols": "music/neon-idols-battle.ogg",
"sfx.card.play.cinder":    "sfx/cinder-play.ogg",
```

Slots left as `null` are silent no-ops — the game runs perfectly with zero audio
files. Five channels (music, voice, interface, battle, ambient) each have their
own volume slider in Settings. No code changes, ever.

---

## Project layout

```
data/                  ALL game content and tuning — JSON only, no code
  cards/               one file per faction (leaders and tokens live with their faction)
  currents.json        the 8 Currents: advantage graph, Perfect Resonance effects
  confluences.json     the 9 two-Current combos
  balance.json         every tunable number in the game
  keywords.json  statuses.json  factions.json  ai-profiles.json  audio-manifest.json
public/assets/
  art/                 your card art, keyed by card id
  audio/               your music and sfx
src/
  engine/              deterministic rules engine — pure TS, no DOM, no randomness
                       outside the seeded RNG. This is the source of truth.
  ai/                  AI opponents (6 difficulty tiers). Scores positions from
                       public information only — enforced by tests/ai-hidden-info.test.ts,
                       which records every field the evaluator reads off the
                       opponent and fails if one is not in RedactedOpponent
  game/                match drivers (local vs AI today, network later)
  save/                versioned localStorage: profile, collection, decks, settings
  audio/               manifest-driven AudioManager
  ui/
    cardRenderer/      procedural premium card frames (shared by DOM and 3D)
    battle/            three.js board, HUD, VFX, presenter
    screens/           lobby, collection, deck builder, settings, battle
    theme/             CSS design system
docs/                  design + technical documentation
tests/                 vitest suites
scripts/verify-ui.mjs  headless browser smoke test
```

### The one architectural rule

`src/engine/` is **pure and deterministic**. It has no DOM access, no `Math.random`,
no `Date`. All randomness flows through a seeded RNG stored in the match state,
so the same seed plus the same list of player actions always reproduces the exact
same match — byte for byte. That is what makes replays, and a future
server-authoritative multiplayer build, possible without rewriting the game.

The UI never computes rules. It sends `PlayerIntent` objects to the engine and
renders the `EngineEvent` stream that comes back. Damage previews come from the
engine's `predict` API, so what you see before you attack is exactly what happens.

Add `?seed=12345` to a battle URL to replay an identical match — invaluable for
reproducing a bug.

---

## Where the design lives

| Document | Contents |
|---|---|
| [`docs/design/00-core-rules.md`](docs/design/00-core-rules.md) | **Canonical rules.** Every number and keyword. Wins any conflict. |
| [`docs/tech/00-architecture-contract.md`](docs/tech/00-architecture-contract.md) | **Canonical architecture.** Module boundaries and the effects DSL. |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | The full original brief — the completeness checklist. |
| [`docs/PROJECT-STATUS.md`](docs/PROJECT-STATUS.md) | What is built, what is designed-but-unbuilt, what is next. |
| `docs/design/` | Game design document, gameplay loop, screens, factions, keywords, Currents, economy, progression, modes, story, AI. |
| `docs/tech/` | Card schema, UI components, multiplayer design, testing plan, performance. |
| `docs/art/`, `docs/plan/` | Art, animation and audio requirements; development milestones. |

If a document and `src/engine/types.ts` ever disagree, **types.ts wins** — it is
what actually runs.

---

## Deployment

### The client — GitHub Pages

Pushing to `main` builds and publishes automatically
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). The job runs
the test suite and the typecheck first, because everything past that point is a
public URL.

Three properties of the build make static hosting work with no configuration:

- **Content is bundled, not fetched.** Every card, encounter and balance number
  is a build-time import ([`src/engine/content.ts`](src/engine/content.ts)), so
  there are no runtime requests to get the paths wrong.
- **Routing is hash-based.** Pages 404s on unknown deep paths, but `#gauntlet`
  never reaches a server, so no SPA fallback or rewrite rule is needed.
- **`base: "./"`.** Assets resolve relative to the document, so the bundle works
  unchanged at a user page, a project page (`/hypebound/`) or a custom domain.

One requirement worth stating plainly: **the repository must be public.** Pages
from a private repository is a paid feature.

### The server — separate, and not on Pages

Pages serves static files. It cannot hold a WebSocket, run code, or keep a
secret, so accounts and matchmaking necessarily live somewhere else:

| Concern | Where it runs |
|---|---|
| Client bundle | GitHub Pages |
| Authoritative match rooms | Cloudflare Durable Objects — one object *is* one room |
| Matchmaking queue, results | Cloudflare Workers |
| Accounts, sign-in, password reset | Supabase Auth; the Worker only verifies the JWT, it never issues one |

The design this implements is
[`docs/tech/03-multiplayer-architecture.md`](docs/tech/03-multiplayer-architecture.md).
Until a service actually exists, the mode it powers is listed as *coming online*
rather than stubbed — see the architecture contract §7.

### The desktop app — Windows

`npm run desktop:build` produces `HYPEBOUND.exe` and an NSIS installer. The
shell is [Tauri](https://tauri.app) ([`src-tauri/`](src-tauri/)), which renders
in **WebView2 — the Chromium that Edge ships**. That is the whole argument for
it over Electron: it is the exact engine every screenshot and `verify:*` script
in this project has been measured against, so the desktop build renders what has
already been checked. Electron would pin its own Chromium and put all of that
back in question. It is also ~6 MB of shell against Electron's ~150 MB, on a
game that is already 86 MB of art.

| Command | What it does |
|---|---|
| `npm run desktop` | Opens the app against the **already-running** Vite server on 5173. It does not start one. |
| `npm run desktop:build` | Runs `npm run build`, then compiles the release exe and the installer. |

Two artefacts land under `src-tauri/target/release/` (gitignored — it grows to
about 2.3 GB):

- `HYPEBOUND.exe` — ~87 MB, and **standalone**. The whole of `dist/` is embedded
  in the binary, so it needs no folder beside it and no installation. This is
  the file to copy onto a stick.
- `bundle/nsis/HYPEBOUND_<version>_x64-setup.exe` — ~85 MB. Installs per-user,
  so it never asks for an administrator prompt; nothing here writes outside the
  user's own profile.

Both need the WebView2 runtime, which ships with Windows 10 1803 and later — so
in practice, present.

The web build is untouched by all of this: nothing under `src/` imports a Tauri
API, `vite.config.ts` is unchanged, and the desktop shell exposes no commands
for the page to call. Both builds run identical JavaScript.

Three things a desktop player finds different, none of them bugs:

- **The save starts empty.** WebView2 gives the app its own storage partition,
  so `localStorage` is not shared with the browser. A player who has been
  playing on the web arrives at a fresh collection. *Export my data* on the
  privacy screen and the cloud save behind an account are the two ways across.
- **The window remembers its size**, which no browser tab does. That state lives
  in the OS app-data folder, not in `localStorage`, so it is deliberately
  outside both the `hypebound:` export and the privacy screen's delete sweep.
- **No fullscreen key.** The window maximises; it does not go fullscreen. See
  the note in [`src-tauri/tauri.conf.json5`](src-tauri/tauri.conf.json5) for why
  a half-working F11 was rejected.

Signing in works exactly as it does on the web, because it was already the one
design that ports without trouble: `src/auth/account.ts` posts an email and a
password straight to Supabase's REST endpoint. There is no OAuth provider and no
magic link, so there is no redirect that a desktop origin would break.

---

## Product principles (non-negotiable)

- **No pay-to-win.** Every gameplay-affecting card is obtainable by playing.
  Money buys cosmetics, with published exact probabilities, duplicate protection,
  visible pity progress and spending controls.
- **Readable first.** No information depends on colour alone — every Current and
  status has a distinct silhouette and a written label. Reduced-motion,
  colour-blind, high-contrast and text-scaling modes are built in, not bolted on.
- **Deterministic.** Same seed plus same actions equals the same match, always.
- **Data-driven.** Cards, factions, keywords, balance, missions and events are
  JSON. Content should never require an engine change.
