# HYPEBOUND — Technical Architecture Contract

> **Status: CANONICAL.** All code must conform to this contract. The companion
> rules document is `docs/design/00-core-rules.md`. The TypeScript source of
> truth for shared shapes is `src/engine/types.ts` — if this doc and types.ts
> ever disagree, **types.ts wins** and the disagreement must be reported.

## 1. Stack

- **Language:** TypeScript, `strict: true`, ESM only.
- **Build/dev:** Vite. **Tests:** Vitest. **3D:** three.js (battle scene only). **Validation:** zod.
- Runtime dependencies are exactly: `three`, `zod`. Nothing else without explicit approval.
- Targets: desktop browsers (mouse primary) + mobile browsers in **landscape only** (touch). One responsive codebase; pointer events abstraction, no separate mobile build.

## 2. Directory layout (fixed)

```
data/                     # ALL game content & tuning — JSON only, no code
  cards/<faction>.json    # card definitions per faction, INCLUDING that faction's leaders and faction-specific tokens (+ neutral.json, tokens.json for shared tokens). Files in data/cards/ are auto-discovered via import.meta.glob — adding a file requires no code change.
  currents.json           # 8 Currents: ids, names, icons refs, advantage graph, resonance effects
  keywords.json           # keyword ids, names, canonical reminder text
  confluences.json        # 9 confluence definitions
  statuses.json           # canonical status definitions
  factions.json           # 10 factions + neutral: identity, colors, currents
  balance.json            # every tunable number (see rules doc tables)
  ai-profiles.json        # AI difficulty configs
  audio-manifest.json     # music/sfx slots → file paths under public/assets/audio
  missions.json, events.json, progression.json
public/assets/
  art/                    # user-supplied card art (referenced by card id; placeholder fallback)
  audio/                  # user-supplied music/sfx files (referenced by audio-manifest)
src/
  engine/                 # DETERMINISTIC RULES ENGINE — pure TS. May import ONLY from src/engine/** and zod. NO three, NO DOM, NO Math.random, NO Date.
    types.ts              # shared type contract (canonical)
    rng.ts                # seeded PRNG (mulberry32); ALL randomness flows through this
    content.ts            # loads+validates data/*.json into a ContentIndex (injectable, so tests can pass fixtures)
    validation.ts         # zod schemas for all data files; used by tests and `npm run validate`
    state.ts              # createMatch(config) → MatchState; zone helpers
    intents.ts            # PlayerIntent union + legality checks (canPlayCard, legalTargets, canAttack, …)
    reducer.ts            # applyIntent(state, intent) → { state, events } — THE only way state changes
    effects.ts            # effect-op interpreter (DSL executor)
    triggers.ts           # trigger queue, ordering (§5.5 of rules), trigger cap
    combat.ts             # attack resolution, elemental bonus, statuses interaction
    currents.ts           # advantage lookup, confluence detection/resolution, resonance tracking
    keywords.ts           # keyword-specific runtime logic (viral copy, trending cost, …)
    statuses.ts           # status application/expiry
    obsession.ts          # obsession gain/spend/thresholds
    victory.ts            # win/loss/draw evaluation
    predict.ts            # damage/heal/lethal previews for UI (pure, no state mutation)
    replay.ts             # MatchRecord = { seed, decks, intents[] } ⇒ re-simulation; verify()
  ai/                     # AI opponents. May import engine only.
    ai.ts                 # chooseIntent(state, profile, rng) — evaluates legal intents
    evaluator.ts          # board scoring heuristics
    profiles.ts           # loads ai-profiles.json (beginner…boss)
  game/                   # client match orchestration: LocalMatchDriver (vs AI), seat handling, timers
  net/                    # the seam the online build slots into. BUILT.
    transport.ts          # MatchTransport, EventBatch, MatchSnapshot, MatchClocks, Legality
    localTransport.ts     # wraps LocalMatch; emits REDACTED batches and a sanitized, cloned view even offline
    viewReducer.ts        # EngineEvent[] -> PlayerView between snapshots; presentation only, never decides an outcome
    viewToState.ts        # rebuild a MatchState-shaped object from a view so the legality helpers work unchanged
    protocol.ts           # wire envelopes + zod schemas, validated on BOTH ends; unused by the local path
  save/                   # versioned localStorage persistence: profile, collection, decks, settings, progression
  audio/                  # AudioManager: channels (music/voice/ui/battle/ambient), manifest-driven, graceful missing-file fallback
  i18n/                   # t(key) + en.json; ALL user-facing strings go through i18n
  ui/
    shell.ts              # screen router (hash-based), screen lifecycle
    theme/                # CSS custom properties: colors, spacing, type scale; current/faction palettes
    components/           # shared DOM components (buttons, dialogs, card renderer, meters)
    cardRenderer/         # DOM/canvas premium card frame renderer (used by collection, deck builder, hand)
    screens/              # one file per DOM screen: lobby, collection, deckBuilder, modes, settings, profile, …
    battle/               # three.js battle scene ONLY
      scene.ts            # renderer, camera (slight top-down ~38° pitch), lighting, quality tiers
      board.ts            # board mesh, slots, layout
      cardMesh.ts         # card meshes: frame per Current, art plane, stat chips
      handBar.ts          # the player's hand — DOM, NOT 3D (see §5)
      targeting.ts        # arrows, legal-target highlighting, previews
      vfx.ts              # per-Current effect language, confluence flourishes; respects reduced-motion
      hud.ts              # DOM overlay: health, hype, obsession, timers, history, end turn, emotes, inspection
      presenter.ts        # consumes EngineEvent[] → animation queue; THE only bridge engine→visuals
tests/                    # vitest: engine rules, keywords, currents, confluences, cards, replay determinism, AI sanity
docs/                     # design + tech docs
```

**Import rules (enforced by review):** `engine` imports nothing outside itself (+zod). `ai` imports `engine` only. `ui` never imports `reducer` internals — it sends `PlayerIntent`s to a driver and consumes `EngineEvent`s. `data/` is never imported as TS modules — always loaded via `content.ts` (JSON import with validation is fine).

## 3. Engine model (deterministic core)

```
applyIntent(state: MatchState, intent: PlayerIntent): { state: MatchState; events: EngineEvent[] }
```

- **MatchState** is a plain serializable object (JSON-safe; no classes, no Maps). Cloned via structuredClone at intent boundaries; reducer may mutate its local clone.
- **PlayerIntent** (player-initiated): `mulligan`, `playCard` (with slot/targets/choices), `attack`, `useFixation`, `activateLocation`, `activateConfluence`, `endTurn`, `concede`, `emote`.
- **EngineEvent** (engine-emitted, the ONLY animation/UI feed): granular facts — `CardPlayed`, `CharacterSummoned`, `DamageDealt {amount, elementalBonus, targetId, sourceId}`, `Healed`, `StatusApplied/Removed/Triggered`, `KeywordTriggered`, `ConfluenceActivated`, `ResonanceAdvanced/Activated`, `ObsessionChanged`, `CardDrawn/Burned`, `FatigueDamage`, `CharacterDefeated`, `ComebackScheduled/Returned`, `TurnStarted/Ended`, `TriggerQueued/Resolved`, `MatchEnded`, etc. Events carry everything the UI needs; the UI must never re-derive rules outcomes.
- **Determinism:** the ONLY randomness source is the seeded rng inside MatchState (`state.rngState` advances with use). `Math.random`/`Date` are banned in `src/engine` (lint/test enforced). Replay = `{ seed, deckLists, intents[] }` re-applied ⇒ identical final state (asserted in tests).
- **Queries are read-only, and that includes the RNG.** Anything the UI may call to decide what to draw — `checkPlayable`, `attackableBy`, `legalChooseTargets`, `legalFixationTargets`, `canUseFixation`, `canActivateLocation`, `availableConfluences`, `predict` — takes a `MatchState` it must not write to. This used to be assumed rather than stated, and two of them were breaking it: `resolveTargets`' `select:"random"` branch advances `rngState` **in place**, and both `legalChooseTargets` and `auraModifiersFor` handed it the live state. Asking "what could this target?" therefore moved the RNG that `replay()` reproduces the match from — a hover, or in the aura case a redraw, would have desynced a replay from the match still being played. Enforced by `tests/query-purity.test.ts`, which hashes the whole state around every one of them.
- **Hidden information:** full MatchState is authoritative; `redact(state, seat)` produces the per-player view (opponent hand/deck/facedown Reactions hidden). UI only ever sees redacted views — this keeps the local architecture server-shaped.
- **predict(state, action)**: pure preview API returning damage/heal/lethal/confluence-availability annotations for the UI. Never mutates.

## 4. Card data & effects DSL

Cards are JSON conforming to zod schemas in `validation.ts`. A card's behavior is data, interpreted by `effects.ts` — **new cards of existing mechanic types require zero engine changes.**

Shape sketch (canonical in types.ts):

```jsonc
{
  "id": "idol-encore-diva",            // kebab-case, prefixed by faction
  "name": "Encore Diva",
  "faction": "neon-idols",             // or "neutral"
  "current": "halo",
  "type": "character",                  // leader|character|action|reaction|equipment|location|transformation|event
  "rarity": "rare",
  "cost": 4, "attack": 3, "health": 4,
  "tags": ["idol", "performer"],
  "keywords": ["spotlight"],
  "text": "auto",                       // "auto" = generated from effects via templates; or explicit string
  "effects": [
    { "trigger": "onPlay",
      "target": { "select": "choose", "side": "friendly", "zone": "board", "filter": { "tag": "idol" } },
      "ops": [ { "op": "buff", "attack": 1, "health": 1 },
               { "op": "applyStatus", "status": "shielded" } ] },
    { "trigger": "inspire", "ops": [ { "op": "draw", "count": 1 } ] }
  ],
  "art": "idol-encore-diva",            // resolves to public/assets/art/<id>.png else placeholder
  "flavor": "The show ends when SHE says it ends.",
  "variantOf": null
}
```

- **Triggers:** `onPlay`, `onDefeat` (Comeback family), `afterparty` (end of own turn), `startOfTurn`, `onAttack`, `onDamaged`, `onHealed`, `inspire`, `flow`, `rushwind`, `onTargeted` (parasocial), `onCardPlayed` (filtered via `playedFilter`), `growComplete`, `aura` (continuous), `reaction` (with `reactionOn`, optionally filtered via `playedFilter`), `onConfluenceActivated`, `activate` (locations), `onReturnToHand`, `onDiscard`, `eventTick`.
- **Ops (interpreter opcodes):** `damage`, `heal`, `buff`, `setStats`, `summon`, `draw`, `discard`, `returnToHand`, `applyStatus`, `removeStatus`, `destroy`, `transform`, `copyCardToHand`, `stealCopy`, `banish`, `cancel`, `destroyEquipment`, `gainHype` (temp/perm), `lockHype` (overload), `gainObsession`, `removeObsession`, `addKeyword`, `removeKeyword`, `modifyCost`, `chooseOne` (branches), `randomOp` (bounded picks via rng), `forEach`, `if` (conditions on state), `scheduleDelayed` (N turns), `disableAuras` (eclipse), `resurrect`, `mill`, `scry` (Algorithm Syndicate — `mode: "reorder" | "bottomOne"`), `swapAttackHealth`, `refract`, `attackAgain`, `addCounter`/`setCounter` (Finale + archetype trackers), `winMatch` (alternate victory), `repeatAfterpartyThisTurn` (Afterparty Crew), `aura` (read-time modifier, only under `trigger: "aura"`).
  Refraction is engine state (`PlayerState.refractionCurrent`), not an op.
- **Effect gating:** `once` (once per game per instance) and `oncePerTurn` ("the first time each turn…"), both tracked on `CharacterInstance.firedOnce` / `firedThisTurn`.
- **Counters:** `PlayerState.counters` is a public `Record<string, number>` mirrored into the redacted view, so Finale progress is always visible to both players as canon requires.
- **Targets:** `{select: choose|all|random|self|source|adjacent|leader, side, zone, filter{current,faction,tag,type,costMax,hasKeyword,hasStatus,…}, count}`.
- **Amount expressions:** literal number or `{count: <selector>}`, `{perTurnCardsPlayed}`, `{obsession: friendly|enemy}`, `{hypeSpentThisTurn}` — a tiny closed expression set, NOT a scripting language.
- The validator rejects: unknown ops/triggers/targets/keywords, stat-less characters, costed tokens missing `token:true`, text/template mismatches, current/faction combos not permitted by `factions.json`.

## 5. UI architecture

- **Hybrid rendering:** three.js exclusively for the battle board (and lobby background scene). Everything else is DOM/CSS — menus, collection, deck builder, dialogs, HUD overlays. DOM gives us accessibility, text scaling, and rapid iteration; the board gives premium 3D feel.
- **The player's hand is DOM, not 3D.** It occupies a reserved strip below the board (`--hand-bar-height`, default 30vh) and the 3D viewport stops above it, so the hand can never obscure the play area. This is deliberate: with the steep top-down camera, anything near the viewer compresses into the bottom of the frustum, so an in-scene hand is forced to be both small and overlapping. As DOM the cards render large, stay pixel-crisp, and inherit text scaling. Dragging starts in `handBar.ts` and finishes on the board via `BattleView.externalDrag*`, which owns every rules decision. Attacks still drag entirely within the 3D canvas.
- **Battle presentation:** `presenter.ts` consumes the EngineEvent stream into an animation queue. Animations are cancellable/fast-forwardable (config: full → fast → instant after first view, per user setting + per-event-type memory). Engine never waits on animations; the presenter owns pacing.
- **Board look:** slight top-down (~35–40° camera pitch, subtle perspective), Hearthstone-like layout per the reference: enemy hand top, leaders top/bottom center with health orbs, two character rows center, hand fan bottom, End Turn right, history rail left, Hype crystals bottom-right, Obsession meters beside each leader, Reaction/Event zones flanking leaders, location slots at row ends.
- **Card frames:** procedural premium frames per Current (shape language per rules doc §8.2) rendered by `cardRenderer` to a canvas texture, shared by DOM screens and three.js card meshes. Art layer = user-supplied image by card id with a stylish generated placeholder (current-colored gradient + icon + name) when missing.
- **Input:** unified pointer abstraction (mouse + touch). Drag-to-play, drag-to-attack with arrow; tap-tap fallback on touch; full keyboard navigation layer; remappable bindings in settings.
- **Press-and-hold peek (binding):** holding on any card, in hand or on the board, enlarges it after `HOLD_MS` (`battle/gestures.ts` — hand and board must share these constants). A press arms a drag *and* a peek, because at pointerdown the two are indistinguishable, so the peek is required to be **non-destructive**: it renders with `pointer-events: none`, moving past `HOLD_TOLERANCE_PX` dismisses it and the drag proceeds untouched, and only releasing without ever moving counts as a look. Pausing before a drag must never cost the player the play or the attack. Right-click keeps the older persistent inspect.
- **Responsive:** landscape layout scales 1280×720 → 4K; mobile landscape enforced with a rotate-your-device overlay in portrait.
- **Accessibility (binding):** scalable UI text (DOM), reduced-motion mode (presenter switches to fades), colorblind-safe status/current iconography (shape+label always), high-contrast theme, screen-shake toggle, animation-speed control, audio cues for turn start/lethal/timer.

## 6. Audio

`AudioManager` with 5 channels (music, voice, ui, battle, ambient), each with independent volume + master, persisted in settings. All content resolved through `data/audio-manifest.json` slots (e.g. `music.battle.neon-idols`, `sfx.card.play.cinder`). Missing files log once and no-op — the game must run silently with zero audio assets present. User drops files into `public/assets/audio/` and edits the manifest; no code changes.

## 7. Persistence & future server

- `save/` wraps localStorage with a versioned envelope `{version, data}` + migration functions. Stores: profile, settings, collection, decks, progression, match history summaries.
- Multiplayer: **the client half is built, the server does not exist.** `net/MatchTransport` is the only way the battle screen reaches a match, and `LocalTransport` is one implementation of it rather than the only way to play. Per-seat event redaction, the §5.2 view sanitization, the view reducer and the wire schemas all run in the **offline** build, so a hidden-information leak surfaces in tests instead of in production against a real opponent — which it did, repeatedly (see `docs/tech/03-multiplayer-architecture.md` §5.1.1, §5.1.2, §5.3, §7.7, §2.1). A future `WsTransport` plus an authoritative room implements the same interface. No fake online UI: modes that need a server are shown as "coming online" in the mode list, not stubbed with lies.

## 8. Conventions

- Naming: kebab-case ids in data; camelCase TS; PascalCase types. One module = one responsibility; files ≤ ~400 lines preferred.
- Every user-facing string via `i18n.t()`. Every tunable number via `balance.json`.
- Errors: engine throws typed `RulesError` on illegal intents (UI prevents these; driver surfaces gracefully).
- Tests: every keyword, every status, every confluence, every resonance, elemental advantage matrix, trigger ordering, fatigue, hand limit, replay determinism, validator rejection cases, plus per-faction interaction tests.
- `npm run` scripts: `dev`, `build`, `preview`, `test`, `validate` (card/data validation CLI), `typecheck`.
```
