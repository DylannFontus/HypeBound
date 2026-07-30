# HYPEBOUND — Project Status

**Last updated:** 2026-07-29

This is the honest state of the project: what actually runs, what is designed but
not built, and what to do next. Read this before picking the work back up.

---

## TL;DR

The game is **playable end to end right now**. You can launch it, browse a
collection, build a legal deck, and play a complete match against an AI opponent
on a 3D board with premium card frames, targeting arrows, damage previews,
Confluences, Obsession and a victory/defeat sequence.

Every **single-player** mode in the brief is now playable: the tutorial, Puzzle
Rush, the Weekly Boss, the Doomscroll, all ten Story Chapters, the Lab, Replay
Theater, Merch Drops and the Grand Tour — and a new account can reach every one
of the ten factions by playing for them. **Daily and weekly missions** pay the
§3.5 income contract, and **Faction, Leader and Character Mastery** now give
every match a second thing to move — so playing has somewhere to go both today
and over a season.

The **cosmetics layer** ships too — card backs, titles, profile frames, portrait
badges and emotes, all earned by playing, worn on a new profile screen, and
rendered in a real match. That closes most of what Mastery could previously only
promise. **Achievements** ship on top of it: twenty-six one-time objectives
across §9's seven categories, an achievement-point score with milestone frames,
and a trophy room at `#achievements`. The **profile hub** it sits in is finished
too: a statistics dashboard, match history with filters and replays, a character
gallery, and a leaderboards screen that explains itself rather than faking a
ladder. The **Hype Wave** — the seasonal battle pass — ships on top of all of
it: fifty tiers fed by the account's own XP, Wave Rebound, an Archive Pass that
never expires, and a Backstage Pass bought with Glimmer the pass itself pays out.
**Headliner Banners** and the **Stream Check-In** close the economy: a three-week
featured banner with published odds, a fifty-pull Encore Meter, a wishlist,
Backstage Tokens and a rerun calendar — plus a ten-step monthly login track with
no streaks anywhere in it. The **Inbox** closes the loop on all of it: system
mail derived from the facts the save already holds, so a season ending, a banner
opening and a returning-player package all say so rather than happening quietly.
**News and patch notes** finish the set: a local feed whose every number is read
from live data rather than typed, and a versioned record that the build refuses
to let drift from the balance it describes. The **system hub** closes the last
NOW-marked gap: probability disclosures, privacy, legal and support — including
the screen policy F1 names by name and which did not exist until now.
**Accessibility** has its own surface at last, the two settings that were
switches attached to nothing now do what they say, and **the board is playable
with no pointer at all** — §13's keyboard model and §16's Board Mirror, verified by a
script that fails if it ever clicks anything. **The Gauntlet** is the
newest and the first new *gameplay* in seven blocks: draft a deck one pick at a
time from the whole card pool, then ride it to 12 wins or 3 losses against an
opponent that drafted its own deck through the same offers.

The game is also **deployed**: <https://dylannfontus.github.io/HypeBound/>
builds and publishes on every push to `main`, behind the full test suite.

**The online foundation has started.** The battle screen now talks to a
`MatchTransport` rather than to `LocalMatch`, so the offline game is one
implementation of the interface a `WsTransport` will implement rather than the
only way to play; and per-seat event redaction runs in the offline build too, so
hidden-information leaks surface in tests instead of in production against a
real opponent. Implementing it immediately found one the design document had
missed. The stack is settled -- GitHub Pages for the client, Cloudflare Durable
Objects for authoritative rooms, Supabase Auth for accounts -- and all of it is
free to run. See "Going online: the deployment, and the seam".

What is *not* built is the server itself (casual, ranked, matchmaking,
spectating, replay sharing, tournaments, friends, guilds), which is deliberately
absent rather than faked. **Every mode in the brief that does not need one is
now playable.**

---

## Verified working

Everything in this section has been executed and checked, not just written.

Test runs were deferred for a stretch while the last features went in — written
alongside the code, run all at once afterwards. **That pass has happened** (see
*The big pass*): typecheck, build, the full suite and all 28 `verify:*` scripts
were run together, ten failures were found and every one is fixed. Sections that
were previously marked *"written but not yet run"* are covered by the figures
below.

**Test suite — 1,404 tests passing** (`npm test`)
- 9 data-validation tests: every card and data file parses, the Current
  advantage cycle is a closed loop, all 9 Confluences exist, every Current has a
  Perfect Resonance effect, faction/Current legality holds, stat budgets hold,
  every faction with cards has a leader, leader ability costs match canon.
- 16 engine tests: deck construction and its rejection cases, opening hands and
  the second-player Borrowed Clout, mulligan not redrawing discarded cards, Hype
  progression and cap, 8 full random matches played to completion with board and
  hand invariants asserted every time, **replay determinism** (same seed + same
  intents produce an identical state hash), state immutability, redaction hiding
  the opponent's hand, victory and concede.
- 5 AI tests: never submits an illegal intent, finishes matches at every
  difficulty, deterministic for a given seed, **Expert beats Beginner above 60%
  across 24 alternating-seat matches**, and mulligans sensibly.
- 13 match-setup tests: setup is byte-identical for a given config (replays
  decode to the same match), diverges on seed, honours `firstSeat`, deals
  canonical opening hands plus the second player's Borrowed Clout, the mulligan
  handoff reaches `main` only after both players act, an empty mulligan keeps
  your hand while still reshuffling deterministically, and scripted-encounter
  leaders are never selectable. This is the surface the scripted modes bend, so
  it is pinned before they land.
- 42 rules tests against fixture cards (immune to content churn): the full
  elemental advantage matrix including Halo↔Veil and Prism neutrality, Shielded
  / Armor / Scorched / Weakened, Spotlight enforcement, summoning sickness vs
  Raid, Viral copies, the Trending discount and its floor, Overload debt,
  Comeback, Grow, Inspire, Parasocial, `oncePerTurn` gating, all four Obsession
  rules (support cap, Obsessed penalty, Fixation once-per-turn, Full Fixation
  reset, Ultimate once-per-match), Confluence availability and the one-per-turn
  cap, Burnout escalation, hand-limit burn, attack refresh, and counter-driven
  alternate victory with public progress.

- 68 Doomscroll tests: the data file cross-checks against real content (and
  rejects a Sponsor Drop placed on a fixed floor, an act that never reaches a
  boss, a token leader, a boss whose twist is only a blurb, and a Signal Fragment
  gate no run could ever satisfy); generated maps are fully connected in both
  directions, never cross an edge, honour the floor plan and the weight table,
  and are a pure function of (seed, act); a run is walked to completion on twelve
  seeds without ever stranding the player; the shop charges once, refuses what you
  cannot afford and never bills a cancelled removal; every event choice resolves;
  each of the fourteen artifacts is asserted to do what its tooltip says; and the
  optional finale is proved from both sides — routing through every act's Elite
  opens it, and skipping them still finishes the run.
- 41 boss-twist tests: every new trigger and op against fixture cards (a defeat
  cancelled mid-resolution and the same instance standing back up with its buffs;
  `oncePerTurn` gating, proved by an ungated control that saves both; draw
  triggers scoped to the right seat and not firing for the opening hand; the
  costliest-character selector and its tie-break; a leader Current rotating and
  the *attack preview* changing with it; the enemy-turn window opening before the
  draw, proved by which card lands in the discard) — and then all ten shipped
  twists, plus the Doomscroll superboss, asserted against real content to produce
  the effect their own card text promises.
- 142 puzzle tests: **all 40 puzzles**, each re-simulated in both directions —
  the intended line wins, and the plausible wrong line does not. The mode spec
  requires exactly this ("solutions are validated by re-simulation; every puzzle
  asserts its solution in the test suite"), because the numbers that make a line
  exact are the same numbers a balance pass moves.
- 56 rules tests now include **Flow, clause by clause** — returned, replayed,
  healed and exchanged, plus the two things the glossary says must NOT fire it
  (a buff and a shield are Inspire's clauses) and the controller ruling that an
  enemy bouncing your character pays your Flow rather than theirs.
- 20 engine-core tests now include **every playable leader building a legal
  30-card deck**, and a second test that independently derives which pools are
  too small and asserts that set is exactly the (empty) exception list.
- 32 mission tests: the pool's printed numbers match what it enforces; every
  statistic a shipped mission depends on is played until it moves; a thirty-day
  absence tops up to three dailies rather than thirty and loses none of them;
  rerolling changes the goal without throwing away the day; a claim pays the
  published rate once; and §3.5's weekly total reconciles line by line with what
  ships. Twelve deliberate breakages, all caught — see *Missions*.
- 26 Grand Tour tests: the loaner deck is the deck the win pays out, card for
  card; a win unlocks and a second win pays nothing; the free Drops come once;
  a won deck never steals the active slot; the collection never goes above the
  playable cap, asserted both arithmetically and by walking all ten stops; and
  the completion reward is refused four different ways before it is paid, and is
  still refused after a year of weekly boss clears has filled the claim ledger.
  Ten deliberate breakages, all caught — see *The Grand Tour*.
- 16 wave tests: reinforcements that arrive mid-match — the two cues, strict
  ordering, one arrival per turn, summoning sickness on landing, a full board
  counted rather than trimmed, and a replay that rebuilds every wave. Every
  claim was checked by breaking the reducer to watch the test fail; one of them
  did not fail, and was rewritten (see *Waves* below).
- 65 deck-tool tests: the diff (counts rather than ids, both sizes reported, an
  unsaved slot distinguished from "thirty cards added", a card the build no
  longer ships surviving); the suggestion engine (never a card you do not own,
  never more copies than the rules and the collection allow, only cards legal for
  the leader, a reason on every row, and a curve reason only when that bucket
  really is short); the craft list; replacements that keep the curve; and
  **auto-complete run for every one of the twenty leaders**, which is the test
  that caught the bug below. Plus a guard that `validateDeck` still says nothing
  about ownership, because six shipped systems hand out decks of cards you do not
  own.
- 30 keyboard and Board Mirror tests: §13.1's zone order, tabbing that skips
  empty zones without reordering them, empty board slots that are unreachable
  until you are placing something, §13.3's state machine walked forward
  (Browsing → CardSelected → SlotPicking → a `playCard` intent) and unwound one
  Esc at a time, attack targeting that cycles **only** the engine's legal targets
  and wraps, a card the engine calls unplayable being refused with a reason, and
  every mode carrying a banner that names its escape. Plus the mirror: that it
  describes the whole visible state, that it is a tree rather than a wall of
  text, that it re-derives from the view — and that **it cannot leak**, asserted
  by checking no card in the opponent's hand or deck is ever named in it.
- 15 save-durability tests: a payload written at one schema version is carried
  forward rather than discarded (the regression that would have wiped every
  account on the first version bump); defaults fill at every depth; a saved array
  is never merged and a saved `null` is never replaced; and a realistic
  pre-inbox, pre-news, pre-banner save loads with everything earned intact and
  every field added since at its default. Both behaviours were confirmed by
  breaking `storage.ts` and watching the tests fail — 1,200 Clout became 0.
- 8 income tests: what a match pays is read from `economy.missions.match` rather
  than from two literals; the daily allowance is **derived** from it
  (`aiDailyCapWins × winClout`) rather than copied from §3's prose; a run of
  matches is paid in full to the ceiling and then paid what is left, reporting
  the difference; the first-win-of-the-day bonus sits outside the cap; XP,
  missions, Mastery and the match record are never capped; the ledger resets on a
  calendar day; and the Gauntlet's run payout spends against the same one.
- 15 cue tests: every row of §11's table is either built or deferred with a
  reason; no two cues are the same sound; each has a visual twin, as §11's
  binding rule requires; and — the load-bearing one — **rendering a cue really
  builds sources**, at the frequencies the table asked for, rising where the spec
  says rising, stacked where it says a chord, and ramped in rather than clicking.
  A cue that validates, fires and emits silence is the exact bug the block was
  closing.
- 38 Gauntlet tests: **every leader's whole draft** — 20 leaders × 30 picks × 3
  cards, asserted to be three *distinct* cards each legal for that leader by the
  deck builder's own rule; the Prism cutoff in both directions (it closes at the
  canonical splash limit, and never closes for a Prism-native leader); an offer
  that survives a reload and changes after a re-draft; the rolled rarities
  matching the published table across 4,000 seeds; a drafted deck whose **only**
  `validateDeck` complaint is `tooManyCopies`, which is the one rule §8.1(4)
  waives; the Practice payout derived from §8.3's row rather than restated; and
  the AI daily Clout cap resetting on a calendar day and reporting what it
  withheld. It also asserts the finding below — that no leader can fill a
  Legendary offer — so a card pool that later can makes the test fail and say so.
- 70 story tests: the chapter script format, its compiler, and the runner —
  including **the error messages**, tested as carefully as the happy path,
  because a complaint that does not name the line is a bug in a feature whose
  whole purpose is that a non-programmer can fix their own mistakes. Plus every
  episode of every real chapter walked **down every combination of choices**, and
  a check that the writer's guide still lists every rule, leader, boss and
  faction a script may name.

> Writing that suite found and fixed two real engine bugs: Comeback scheduled
> its return one seat-turn too late, and a self-buffing Inspire re-triggered
> itself until it hit the cascade cap. Both are now covered by tests.
>
> The Doomscroll suite found two of its own — one of them in a test. A map test
> called "never crosses an edge" only checked that the target *bounds* advanced,
> which is a weaker claim: source 0 → target 1 alongside source 1 → target 0
> satisfies it and still draws an X. The rendered map showed the crossings the
> test was blind to. Separately, `pickWeightedIndex` treats a non-positive weight
> as 1, so an act saying "no Elites on floor 1" was still rolling them about one
> time in ninety; excluded kinds are now dropped from the candidate list instead.

> Authoring the puzzles produced the sharpest example of a test suite agreeing
> with itself. **Eleven Survival puzzles completed the instant they were dealt.**
> Their objective was `turnAtLeast 2`, and a puzzle that buys Hype with
> `{ op: "turn", value: 3 }` *opens* on turn 3 — so the win condition was already
> true before the player touched anything, and the mode skipped straight to the
> next puzzle. Every one of those puzzles passed its unit tests, because the
> solutions really were correct: the stage simply never asked for them. Only the
> browser walk, which loads each puzzle by index and checks it dealt the board its
> own data describes, noticed it was being handed the *next* puzzle each time.
>
> The encounter validator already refused the mirror-image mistake — a `failIf`
> that is true on the opening turn, which loops forever — and now refuses this one
> too. It is the quieter of the two: a loop is obvious, whereas "you win, well
> done" for doing nothing looks like success.

> Writing the boss-twist suite found a third shipped bug, in the oldest boss in the game.
> **A conditional aura never checked its condition.** Prisma's Standing Ovation
> says "while the boss controls 3 or more characters" and `auraModifiersFor`
> simply never read `effect.condition`, so it had been an unconditional +1 attack
> from the first character onwards since the mode shipped. The existing boss test
> asserted `passive.length > 0`, which is true of a passive that does nothing.

> **Flow fired on one of its four channels.** Canon §6 and
> `05-keyword-glossary.md` §3.12 define the keyword as "returned to your hand,
> replayed, healed, or exchanged" — a closed, enumerated list with per-channel
> rulings — and only "returned" was implemented. Every card printed with **Flow**
> was promising three triggers it did not have, including the whole of Cassia
> Cache's recursion kit, which is the Algorithm Syndicate's only archetype.
> Nothing caught it because **Flow had no test at all**: the keyword existed, so
> it looked finished. All four now fire, including the glossary's controller
> ruling — an enemy bouncing your character pays *your* Flow, not theirs,
> "because bouncing a Tide board is a real cost" — and each channel has a test
> that fails if it is removed.

> Building `cardOverrides` turned up three more, all in trigger dispatch and all
> in shipped content:
>
> 1. **`afterparty` and `startOfTurn` fired on both players' turns.** Both are
>    defined in types.ts as "controller's turn" and the Afterparty keyword's own
>    reminder text is "triggers at the end of *your* turn" — so every card with
>    either resolved twice per round. That is an entire faction's mechanic at
>    double rate, and Juniper Vale's "deal 2 damage at the start of your turn"
>    dealing 4. `eventTick` had it too, ticking event cards down twice as fast as
>    their stated duration.
> 2. **`onCardPlayed` fired for both seats.** Ashvyre's Overclock granted Raid and
>    Scorched to the *enemy's* character, Chairperson Nobody copied cards the
>    opponent played into her own hand, and the Con Crunch Artisan drew whenever
>    the opponent played Equipment. All three cards say "you play".
> 3. **`once` / `oncePerTurn` did nothing on a leader passive.** The bookkeeping
>    lived on the character instance and a leader has no instance, so three
>    shipped leaders whose text says "the first … each turn" fired every time.
>
> Nothing in the 198-test suite caught any of them, which is the more useful
> finding: the suite tested that triggers fire, never that they fire *once*, or
> *for whom*. It does now.
>
> Building the remaining boss twists turned up two more, both in shipped cards
> and both invisible to any test that reads a card's data rather than playing it:
>
> 1. **"Gain max Hype permanently" lasted one turn.** A turn start *recomputes*
>    `hypeMax` from the turn counter rather than incrementing it, so a permanent
>    grant written onto `hypeMax` was wiped the following turn. Two cards make
>    that promise — Brand Partnership, and Annual Shareholder Meeting, a
>    7-Obsession Ultimate. Permanent grants now live in `bonusHypeMax` and are
>    added back on every recompute.
> 2. **Banish returned a character on the wrong player's turn.** The return turn
>    was computed from the *caster's* seat, and `returnBanished` only runs on the
>    owner's turn, so banishing an enemy stranded it an extra round. Touch Grass
>    banishes your own characters, where the two coincide, which is why it
>    survived until a boss twist banished across the table.
>
> Adding the optional fourth act surfaced one more of the same shape: the run
> summary reported `data.acts.length` acts cleared for **any** win. That was true
> while every act was mandatory, and became a lie the moment one was not — a run
> turned away at act 4 claimed to have cleared it, in the summary and in the
> saved best-run record. Three of these six bugs were correct code that a later
> feature quietly invalidated, which is the argument for tests that assert the
> rule rather than the current shape of the data.

**Browser smoke test — 12 steps passing, zero console errors** (`npm run verify:ui`)

Walks the lobby, collection, card detail, deck builder, settings and mode select,
then plays a real match: mulligan → board → drags cards from hand onto the board
through the actual pointer interaction → cancels a drag back to hand → attacks
through the same drag interaction → plays turns → reaches a result.
Screenshots land in `scripts/screenshots/`.

Per-mode browser verifications, each following that mode's own rules rather than
a generic click-through: `verify:tutorial`, `verify:stages`, `verify:puzzles`,
`verify:replays`, `verify:lab`, `verify:boss`, `verify:doomscroll`,
`verify:story`, `verify:cards`, `verify:shop`, `verify:tour`, `verify:missions`,
`verify:mastery`, `verify:cosmetics`, `verify:achievements`, `verify:screens`,
`verify:pass`, `verify:banner`, `verify:inbox`, `verify:news`, `verify:fairness`, `verify:a11y`,
`verify:gauntlet`, `verify:mobile`, `verify:keyboard`, `verify:decks`.

Data checks that are not browser walks: `npm run cards` (every card against its
own rules text — see *The card-text audit*), `npm run lore`, `npm run story`, and
`tests/dsl-coverage.test.ts` (every op and optional field in the effects DSL
proved to do something — see *The DSL coverage sweep*).

`verify:puzzles` solves the first puzzle through real pointer drags, then fails it
on purpose to prove the retry re-deals, then **opens all 40** and checks each one
dealt the board its own JSON describes — enemy health, opening Hype and character
count. That last part is not decoration: it is what caught eleven puzzles being
skipped, because the check that loads puzzle *n* and finds puzzle *n+1* is the
only one that can see it.

`verify:boss` walks **all ten** bosses, not just the one this week's rotation
lands on, and plays real turns against each. That needed a `#boss?boss=<id>`
route: with only the rotation, nine twists would go unrendered until their week
came round, and a presenter that could not draw one of the new events would
surface as a "random" console error months later. The unit suite proves each
twist's rules; the browser proves it survives the renderer, the event presenter
and the AI.

`verify:doomscroll`
plays a Doomscroll fight for real — opens it, checks the board was dealt from the
run's 15-card deck at the run's health, concedes, and leaves through the battle
screen's own exit — then walks a second run from the first floor **to the optional
finale**, answering every shop, Break, Notification, Sponsor Drop and reward with
real clicks, and checks the summary pays the profile at the published rate.

Two things about that walk are worth copying elsewhere. It **types a fixed run
seed** into the field a player would type it into, because on the random default
it walked a different map every invocation and so passed or failed by luck — a
flaky check is worse than no check, since it teaches you to re-run until green.
And its routing has to satisfy two goals at once: beeline for Elites and it
reaches the finale but stops visiting the Merch Table; take the leftmost node and
it covers everything but clears three acts and stops, *still printing "cleared
the run end to end"*. It now prefers an unvisited node kind that still leaves an
Elite reachable. The required node kinds are listed by name rather than counted,
so a future routing change that trades one kind of coverage for another fails
with the name of what it dropped.

The same trap caught the upgrade path a second time. The walk's Break handler was
written to Remaster "when at full health, since healing would be a no-op" — which
reads as smarter play and meant the branch only fired if the walk happened to
arrive undamaged. On the fixed seed it never did, so the picker went unrendered
while the check still reported OK. It now spends the *first* Break on a Remaster
regardless: a coverage walk should cover deterministically, not opportunistically.

**Balance harness** (`npm run balance`) — opt-in, skipped by `npm test`. Plays a
full round robin and reports win rates by leader and faction, match length,
first-seat advantage, and a census of how often each trigger fires per match.
That last table is the reason it exists: Afterparty and start-of-turn effects
resolved twice per round for months and no win-rate number would have made that
visible. `--only mirror` runs just the deck-builder comparison, `--only tour`
answers whether a Grand Tour loaner deck can win its own match, and `--rounds n`
and `--ai expert` scale any of them.

Focused diagnostics alongside it, each provable rather than eyeballed:
`debug-hover`, `debug-drag`, `debug-makeroom`, `debug-hold`, `debug-hold-board`,
`debug-ready`, `debug-peek-style`, `zoom-board-card`, `capture-anim`,
`preview-cards`, `preview-leaders`.

**Production build succeeds** (`npm run build`) — ~1,234 KB JS (312 KB gzipped)
plus lazy-loaded bloom passes.

### Systems built

| System | State |
|---|---|
| Rules engine | Complete for all canonical mechanics. Intent → event, seeded RNG, per-seat redaction, replay, `predict()` previews, 20-deep trigger cascade cap. |
| Effects DSL | ~44 opcodes, 24 triggers, filtered targeting, amount/condition expressions. Cards are pure data. |
| Boss twists | All 10 faction bosses, each twist a passive on its own leader card. The ops the last eight needed are general, not boss hooks: `revive` (cancel a defeat in progress), `rotateLeaderCurrent`, `modifyTriggeringCardCost`, `highestCost`/`lowestCost` selectors, `scry` with a stated pick rule, and the `onFriendlyDefeated` / `onCardDrawn` / `onEnemyCardDrawn` / `enemyStartOfTurn` triggers. |
| The Eight Currents | Advantage cycle, Halo↔Veil mutual, Prism/Refract, all 9 Confluences, Perfect Resonance per Current, pure-vs-dual deck rules. |
| Obsession | Support gain, Parasocial, Fixation (3) and Ultimate (7), Obsessed danger zone at 8+, Full Fixation at 10. |
| AI | 6 tiers, board evaluator, bounded lookahead, style profiles, no hidden-information cheating. **A pure function of match state**: its randomness is derived per decision from seed + `intentCount` + seat + profile id rather than carried in a stream, so the same prefix always draws the same reply — the prerequisite for rewind and sandbox undo. |
| Boss / weekly modifiers | `MatchConfig.balanceOverrides` applies dotted paths into `balance.json` (`"hype.cap"`), re-validated on apply, resolved once per match and carried through `replay()`. |
| Per-copy card variants | `MatchConfig.cardVariants` clones a card under a new id (variantId → baseId) so one copy of a card can differ from another — the Doomscroll's "Remastered" upgrades. It only clones and re-labels; the stat change, the clamping and the re-validation are left to `cardOverrides`, because two ways to bend a card would eventually disagree about what "cost −1 on a 0-cost card" means. In config, so `replay()` rebuilds the same pool. |
| Per-player card patches | `MatchConfig.cardOverrides` patches individual cards for one match — cost, stats, keywords, added leader passives, Fixation/Ultimate cost. Numbers are **deltas**, so patches compose in any order; the result is re-validated against the card schema, and a patch that cannot apply (stats on an Action, a passive on a non-leader) is refused rather than dropped. This is the per-*player* lever balance overrides cannot be: one rulebook is shared by both seats, but a leader card belongs to one. Carried in config, so it survives `replay()`. |
| Card renderer | Procedural premium frames with a **distinct silhouette per Current**, cost gem, badge with written label, stat chips, rarity gems, faction crest, holo foil, rich card text. |
| Placeholder art | Deterministic per-card composition so the game looks finished with zero art assets. |
| 3D battle board | three.js, **orthographic** camera ~10° off vertical, lit table, drag-to-play, drag-to-attack with arcing arrows, drag-cancel, press-and-hold peek, damage previews, particle VFX, optional bloom, 3 quality tiers. Layout derived from frame-by-frame measurement of reference footage — see `docs/art/04-battle-layout-reference.md`. |
| Leader medallions | Landscape struck discs with a per-Current rim profile, art edge-to-edge, health and armour clamped to the rim as lugs. Deliberately not card-shaped; the eight rims stay separable in greyscale. |
| Battle HUD | Leader plates, health orbs, Hype crystals, Obsession dials with danger styling, deck/discard counts, turn timer with rope, action log, trigger rail, Confluence bar, emotes, toasts, floating combat numbers. |
| Screens | Lobby, mode select, **twelve deck slots with covers, validity badges and a working active-deck switch**, collection (search + 6 filter axes + craft/dismantle/favourite/lock, and a card inspector with 3D angled art, Story/Effect tabs and prev/next), deck builder (curve, validation, import/export codes, **compare-versions, collection-aware suggestions with a stated reason each, replacements for what you cannot field, craft targets, auto-complete, build-around and Test vs AI**), settings, battle, starter picker, Merch Drops, the Grand Tour, Missions, Mastery (faction and leader tracks, the Bias Board, and the lore they unlock), and the player Profile. |
| Save | Versioned localStorage with a **carry-forward migration chain and defaults filled at every depth**: profile, collection, decks, settings, match history. A version mismatch used to return `defaults()` for any store without a `migrate`, which made bumping the profile version a silent whole-save wipe. **Two shapes of progress, deliberately different**: missions are *derived* from a pruned log of finished matches, so a claim can be re-scored and audited; mastery is a lifetime *accumulator*, because the log it would have to be derived from does not go back far enough. |
| Audio | 5-channel manifest-driven manager. Runs silently and correctly with no files present. |
| Cosmetics | Card backs, titles, profile frames, portrait badges and emotes. Earned from Mastery, worn on the profile, rendered in a match. **Zero art assets**: a card back is its faction's colour and a procedural emblem, a frame is its crest ring, a badge is the character's own art — so a new faction gets cosmetics the moment it gets a colour. Per-leader and per-character titles are generated from the content index rather than catalogued, because §13 asks for several hundred and each hand-written one is a chance to name a card that does not exist. |
| Achievements | Twenty-six one-time objectives across §9's seven categories, achievement points with milestone frames, and `#achievements`. An **accumulator**, like Mastery and unlike missions: the 200-match evidence log cannot answer "complete 500 matches". Four requirement kinds and no filter language. The one entry that needs a server says so, by name, on the row. |
| Profile hub | Statistics dashboard (win rates by faction, Current, deck and matchup; per-deck averages; trend; CSV export), match history with filters and replays, a 138-strong character gallery, and a leaderboards screen that explains itself instead of faking a ladder. Every average reports the sample it was computed from. |
| Hype Wave | The seasonal battle pass: 50 tiers fed by the account's own XP, Wave Rebound (+50% when behind), an Archive Pass that never expires, endless Encore tiers, and a Backstage Pass bought with Glimmer the pass itself pays out. Its pacing is a **release-blocking calibration** re-derived from shipped XP, not a copied constant. |
| Headliner Banners | A three-week featured banner: published per-rarity odds, a rolling Epic-or-better window, a fifty-pull Encore Meter aimed at a Target Card of your choosing, a ten-slot wishlist, Backstage Tokens that buy any card outright, an exportable pull history and a published rerun calendar. It concentrates odds and **gates nothing** — every card on it is already in Drops and crafting. |
| Accessibility | Seven interface sizes, three colour-blind palettes fitted against a dichromacy simulation, hatch fills on Currents, focus-ring sizing, the Rules Lens, dyslexia-friendly text and written labels — on a dedicated screen where every control previews live and every unbuilt one says why. **The board is playable by keyboard** (§13's zone model and state machine as a pure reducer) and **mirrored for a screen reader** (§16's Board Mirror: a visually-hidden landmark rebuilt from the redacted view, so it cannot drift and cannot leak). Plus **28 of §11's 34 audio cues, synthesised** from oscillators and filtered noise, so they work in a build holding no audio files at all: no two may be the same sound, each has the visual twin §11 requires, and each is previewable with the spec's own description printed beside it. |
| The Gauntlet | Draft, offline. A leader from three factions, then 30 picks of 3 from the whole card pool regardless of what you own; run to 12 wins or 3 losses against an opponent that **drafted its own deck through the same offers**. Offers are derived from (seed, pick, deck so far), so a reload is not a reroll. §8.1's rarity table cannot be kept by this build's card pool, so the shortfall is measured, printed per leader, and filled from the rarity below rather than fudged. |
| Probability disclosures | The page policy F1 names: both rate tables, every published guarantee, the conversion and craft table, computed worked examples of the pity maths, and a rate-change log derived from the patch notes. Contains no numbers of its own — a test asserts it prints the same table as the shop and the banner. |
| Privacy, legal, support | What is and is not collected, with a real export of the whole save and a typed-confirmation delete; open-source attributions joined to `package.json` in both directions; a searchable FAQ and a PII-free diagnostic export shown in full before it is written. Terms and an EULA are marked not-written rather than faked. |
| News | A local article feed with category chips, unread markers, a reader and deep links. Every figure in an article is a token resolved from live balance data, so an article cannot quote a rate the game does not use. |
| Patch notes | A versioned record: cards changed (before → after on real card frames), the `economy.*` diff between releases, rules, systems and fixes, with search and a "new since you last played" band. The newest release's economy snapshot must equal the shipped balance, which is how policy F4 is enforced rather than merely stated. |
| Inbox | System mail derived from facts the save already holds — season starts and endings, banner runs opening and closing with their published return dates, the month's check-in, and §10.5.4's Welcome Back package as a claimable attachment. Thirty-day retention, except that a message owing you something never expires. |
| Stream Check-In | §11's ten-step monthly track. One step per calendar day you open the game, no streaks and no consecutive-day requirement anywhere in it. Pays Clout, Signal, Glimmer, a Drop, working mission-reroll tokens, and the month's card back. |
| Accessibility | Text scaling, reduced motion, high contrast, colour-blind modes, screen-shake toggle, animation speed, written labels everywhere, 44px touch targets. |

---

## Content status

**296 cards across all 10 factions, 20 playable leaders — every file validates.**

| Source | Cards | Leaders |
|---|---|---|
| Neon Idols | 20 | 2 |
| Gothic Royalty, Viral Influencers, Corporate Creators, Digital Demons, Cosplay Champions, Afterparty Crew, Touch-Grass Order, Algorithm Syndicate, Meme Collective | 19–22 each | 2 each |
| Neutral | 10 | — |
| Shared tokens | 6 | — |
| Faction bosses + the Doomscroll superboss | — | 11 (never selectable) |

195 of these are collectible (the rest are summon-only tokens and the boss
leaders, which are marked `token` so they can never reach a deck or the
collection). Neon Idols is the gold-standard reference set — copy its structure
when adding cards.

Every faction also has a design document in `docs/design/factions/` with leaders,
archetypes, matchup notes and example cards.

### The card inspector, and where card lore goes

Opening a card in the gallery gives it a page rather than a tooltip: the card
itself, large and angled in 3D against a ring tinted to its Current, with a panel
beside it that switches between **Effect** (what it does, scanned) and **Story**
(what it is, read). Arrows and the arrow keys walk the filtered grid, so reading
through a faction never means closing and reopening.

Lore is **one hand-edited file**, `data/cards/lore.txt`, and it already holds a
block for all 296 cards, so nobody ever has to add one:

```
=== grass-trailhead-novice
TITLE: Week One
She complained about the incline for six days. On the seventh she overtook
two people on the switchback and said nothing about it.

"Ask her about drainage. Go on. Ask her."
```

`TITLE:` is optional and defaults to the card's name, a blank line makes a
paragraph, and a line wholly in quotes becomes the pull quote. Leave the quote
out and the card's **printed flavour text** is used instead — which every
collectible card already has, so an untouched file still reads well on every card
in the game. Blocks are keyed by id because three cards share a name, and each
one carries the card's name as a comment above it so it can be found by eye.
An unwritten card shows a placeholder plus the exact line to add.

`npm run lore` checks it: every block names a card that exists (a mistyped id is
reported by name rather than silently never showing), every card resolves to
something printable, and the format's promises still hold. `npm run verify:cards`
walks the inspector in a browser — both tabs, the fallbacks, the arrows.

> The underline marking the active tab was **on the wrong tab on screen while the
> DOM said it was right**, and the first check asserted the class name, so it
> passed. The underline is a transitioned `border-color`, and a transition that
> never advances in a headless browser leaves the mark on the tab you just left.
> The transition is gone — a state indicator should not fade in — and the check
> now measures the lit pixels rather than the class. Same lesson as the eleven
> auto-completing puzzles: assert the thing the player sees.

---

## Scripted encounters (tutorial, puzzles, boss, story, sandbox)

The shared machinery behind five modes is built and covers the tutorial today.

| Piece | Where | State |
|---|---|---|
| Scenario setup | `MatchConfig.scenario` in `engine/types.ts`, applied by `createMatch` | Ordered decks, no-deal, no Borrowed Clout, skip-mulligan, and setup ops for hand, deck order, board, leader health, armour, Hype and Obsession. Lives in `MatchConfig` because `replay()` rebuilds from config — setup arranged anywhere else would not exist on replay. |
| Opening a scripted match | `beginScriptedMatch` in `engine/reducer.ts` | Runs the exact transition the mulligan would have, so the player gets Hype and an opening draw. Called by the driver **and** by `replay()`, so a scripted match and its replay open identically. |
| Encounter data | `data/encounters/*.json`, parsed by `engine/encounters.ts` | Auto-discovered by glob like card files, zod-validated, with referential checks against real card ids. Rejects a stage that fixes deck order while allowing a normal mulligan, because the mulligan reshuffles. |
| Stage runner | `game/stageRunner.ts` | Walks beats, speaks coach lines, reveals HUD widgets cumulatively, and produces the gate predicate. No rules, no rendering — testable headlessly. |
| Gating | `LocalMatch.submit` | Refused intents never reach the reducer. A gate that only greys out buttons is not a gate. Legality stays the engine's call; this is only whether the lesson permits a legal move. |
| Coach | `ui/battle/coach.ts` | Speaking panel plus a pointer-transparent spotlight, so the highlighted control stays clickable. Warns once per selector that matches nothing, since selectors live in JSON where a typo cannot be typechecked. |
| Progressive reveal | `.tutorial-active` classes in `battle.css` | The HUD gains widgets as the coach explains them. Opt-in, so a real match is untouched. |

**Interactive Tutorial — 7 stages authored.** Stage 1 verified playable end to end
in a browser (`npm run verify:tutorial`); all stages parse and cross-check in
`tests/encounters.test.ts`. Rewards and completion tracking are not wired yet.

Reusable beyond the tutorial: puzzles need scripted boards plus an objective,
boss fights need `balanceOverrides` (see gaps) plus a leader-health op, The Lab
needs both seats controllable. All three are the same machinery.

**Puzzle Rush — all 40 puzzles authored**, which is the count the spec asks for
at launch. They cover the five named categories: Lethal 11, Currents 11,
Survival 8, Combo 7, Economy 3.

Each one teaches a *named* mechanic rather than being a different arrangement of
the same arithmetic — the advantage cycle including the Halo↔Veil mutual pair and
Prism's neutrality, six of the nine Confluences, Spotlight, Raid, Trending,
Rushwind, Repost, Viral, Chain, Collab, Inspire, Flow, Parasocial, Scorched,
Shielded, Armor, Cancel, Weakened, Equipment, the hand limit, Burnout, Obsession
and Full Fixation, and delayed Last Call damage.

Two things about how they are authored are worth keeping:

- **The numbers came from the engine, not from arithmetic.** Every puzzle was
  probed by playing candidate lines through the real reducer and reading the
  result, then tuning the board to it. Several designs that were obviously
  correct on paper were wrong in play: Scorched burns at the end of *its owner's*
  turn rather than yours, a one-card draw frees its own hand slot so the limit
  never bites, a body with no Spotlight blocks nothing at all, and the `board`
  setup op made `maxHealth` follow `health` — so a *damaged* character, the
  premise of any healing puzzle, was inexpressible until it gained an explicit
  `maxHealth`.
- **`tests/puzzleKit.ts` resolves a line one step at a time.** Building the whole
  intent list against the opening state looks equivalent and is not: "the first
  card called X in hand" resolves to the same instance twice, so playing two
  copies of a card silently addresses one of them. That bug is invisible in the
  intent list and obvious in the failure.

---

## Story Chapters

**All ten chapters are written and playable end to end**, one per faction —
*Encore, Please* (Neon Idols), *The Server Is Closing* (Gothic Royalty), *Ratio*
(Viral Influencers), *Deliverables* (Corporate Creators), *Render Unto* (Digital
Demons), *Best in Show* (Cosplay Champions), *Last Call* (Afterparty Crew),
*Log Off* (Touch-Grass Order), *The Update* (Algorithm Syndicate) and *Repost*
(Meme Collective). Six episodes and six battles each, plus the optional **Side
Cut** the design asks of every chapter: **3,794 lines of script, 70 battles,
24 tracked decisions, 10 side cuts, zero chapters that fail to compile.** But the
chapters are the demonstration; the deliverable is the **authoring system**,
which was built to a single requirement: *somebody with no knowledge of this
project can add a chapter without help.*

Chapters 2 through 5 were the real test of that claim, and the trend is the
point: each compiled clean on the first run, and each needed less of the engine
than the last. Chapter 2 needed three new entries in the rule library — the "ask
for a rule that doesn't exist" path the guide describes. Chapter 3 needed one
feature the design had always specified and the system did not have, **flags that
cross chapters**. Chapter 4 needed nothing at all. Chapter 5 needed one more rule
in the library and, again, no code. Four chapters in a row written entirely inside
the format is the evidence the claim was missing.

Chapter 8 asked for one thing the library could not express, and the interesting
part is *why*. The design specifies its Episode 2 rule as
`balanceOverrides { "obsession.fixationCost": 5 }` — but that path is **inert**:
the price a leader's Fixation actually charges comes off the leader card, and the
`balance.obsession` number only decided where the mark sat on the Obsession
track. Shipping it as written would have moved the mark without moving the cost —
a rule that lies to the player. So `StoryRule` gained `fixationCost`/`ultimateCost`
deltas applied as an ordinary `CardPatch`, which is how it reaches one seat rather
than both; and the HUD's Obsession track now reads its marks off the leader card
too, so the mark and the price can no longer disagree. The test that guards it
follows the rule all the way to the resolved leader, because asserting the patch
exists is exactly the assertion that would have passed on the broken version.

**Chapters 9 and 10 are the strongest evidence the claim was ever going to get.**
Both compiled clean on the first run. Chapter 9 needed nothing at all — no rule,
no code, no format change — and it is the chapter with the most moving parts in
the campaign: a change-log spine across five versions, a staggered rollout in
three bands, and a payoff that reaches into Chapter 4 and quotes it exactly.
Chapter 10 asked for one rule the library did not have, **It Came Back**, which
is *Nobody Really Dies Here* pointed the other way — the thing across the table
is the one that will not stay down. That is the "ask for a rule that doesn't
exist" path the guide describes, used for the last time, by the last chapter,
and it took one entry in `rules.json` and one row in the guide.

### Side Cuts, and what the format was missing

Every chapter in §3 is specified with an optional extra episode — a **Side Cut**
unlocked by the Episode 3 decision — and for five chapters running the answer was
a header note saying the format had no way to express it. That is now built. A
writer types a different heading and one line:

```
=== SIDE CUT: The Long Walk
UNLOCKED BY: waited for a better time
```

`UNLOCKED BY:` reads a memory the same way `IF` does, and the writer's own words
are what the player is shown on the locked row — so the flag is written to read
well in a sentence, which is the same discipline the format already asks for
everywhere else. The design wants these **visible and greyed with the condition
printed** rather than hidden, and they are: a dashed row in the episode list
saying *opens if you waited for a better time*. Being able to see the road you
did not take is most of the value of a decision you only get one of per save.

Optional is enforced in both directions. `chapterComplete` and `nextEpisode`
ignore side cuts, so a player who took the other option can still reach 100% and
is never nagged toward a detour; and the progress counts read "3 of 5", not
"3 of 6". Progress was already keyed by **episode id rather than index**, which
is the only reason inserting an episode into the middle of ten shipped chapters
did not disturb a single existing save.

All ten Side Cuts are written — *Merch Table Confessional*, *Inventory*,
*Collab Request (Read 3:41 A.M.)*, *Day 401*, *Style Transfer*, *The Stairwell
Workshop*, *The Long Walk*, *Two Years of Unread*, *Source Unverified*,
*Mod Application* — and all ten compiled clean on the first run, which is the
part worth noticing: the node was exercised ten times by the same person who
built it and needed no second pass.

A side cut fails silently in a way nothing else in the format does, so it gets
its own check. Unlock it with a flag some line writes unconditionally and it is
always open; unlock it with a flag nothing writes and it never opens — and
neither is a parse error. `npm run story` now walks each choice's compiled option
body and asserts every side cut's unlock is written **inside one**, which was
verified by pointing one at an unconditional flag and watching it fail.

### Waves, and the last thing §3.10 asked for

Every chapter but one is expressible in the format as shipped. The exception was
Chapter 9's Episode 4, which §3.10 specifies as *"a panicking ecosystem
(multi-wave board)"* — and for the whole of the campaign's writing that shipped
as an opponent who keeps drawing, flagged in the chapter's header as an
approximation. It is now built, and the shape it took is worth recording,
because the first two designs were both wrong.

The effects DSL already has `summon`, so the obvious move is a leader passive
that refills the board. That is what `RULE: clip farm` already approximates and
it is not what the design asks for: a wave encounter is a **finite, ordered,
announced** sequence, and the value of it is that the player can count it down.
A passive that keeps summoning is a surprise that happens repeatedly. Expressing
"wave 2 of 3" in the DSL would need per-match sequence state, counters and
nested conditions, and would still have nothing to put on screen.

So a wave is a scripted-encounter concept, not card text — the split
`SetupOp` already draws (*"a SetupOp never appears on a card"*). `EncounterSetup`
gained `waves`, and it lives in `MatchConfig` for the same reason `setup` does:
`replay()` rebuilds a match from its config, so reinforcements arranged anywhere
else would not exist on re-simulation.

| Decision | Why |
|---|---|
| **One check, at the start of the wave seat's turn**, after banished and Comeback returns and before the turn's triggers | After the returns because a character walking back on means the board is not actually empty, and "the board is empty" is one of the two cues. Before the triggers because a `startOfTurn` passive that counts characters should count the ones standing in front of it. |
| **Two cues: `onBoardClear` and `onTurn`.** Both set means whichever comes first | Board-clear is what makes a wave a wave — you clear it, more arrive — and it is self-limiting, because it can only fire on a board the player has already won. `onTurn` is the backstop: without it, a player who ignores the board and races the leader meets one wave instead of three. |
| **Strictly ordered, at most one per turn** | Only `waves[wavesLanded]` is ever considered, so "wave 2 of 3" counts arrivals rather than conditions. Two landing at once would be one big wave to the player and would skip a number in the log. |
| **Dealt, not played** — one shared code path with the `board` setup op | If a wave were "they play three cards for free", every on-play effect, Rushwind, Afterparty and cards-played counter in the game would fire off the encounter's furniture. The two go through `dealCharacter` so a field added to one cannot silently miss the other. |
| **Arrives summoning-sick by default**, the opposite of `{ op: "board" }` | An opening board has been standing there since before the match; a wave has visibly just walked in. A wave that could attack on arrival is unanswerable — the player never gets a turn between seeing it and being hit by it. |
| **A wave with nowhere to stand is counted and announced** | Silently delivering four of six bodies is a balance change nobody wrote down. The event carries `dropped`, the log prints it, and the story library refuses a wave larger than the board outright. |

For the writer it is one line — `WAVES: the support queue` — and the library is
`data/story/waves.json`, next to `rules.json` and following the same rule: the
writer gets the mechanics *and* the sentence the player reads, and never opens
`data/cards/`. The one difference is what the file is made of. A rule is a
program, so `rules.json` speaks in card ids and effect ops; a wave is a cast
list, so `waves.json` speaks in card **names**, checked against real content, and
a typo is reported as *"there is no character card called X, did you mean Y"*
rather than arriving as one body fewer than the author counted on.

Chapter 9's three waves are the chapter's own prose: band one at nine, band two
at noon, band three on Thursday, two days after everybody has stopped watching
for it. Band one is scheduled only; bands two and three lead with the board-clear
cue and keep their date as a backstop.

**The whole schedule is printed on the brief before a card is dealt** — every
wave, what is in it, and what brings it. That is not decoration: it is the
difference between a wave encounter and an opponent who will not stop.

`tests/waves.test.ts` covers the timing (16 tests), and each of its claims was
checked by breaking the reducer on purpose to see the test fail. One of them did
not: **"lands strictly in order, at most one per turn" passed against a reducer
deliberately changed to land every due wave at once**, because it compared the
flattened list of arrivals and that list is identical either way. It now asserts
per turn. `npm run verify:story` plays a fixture chapter's wave battle in a real
browser and checks the board grew, the log said so, and nothing in the wave could
attack the turn it landed.

### The Archive, and the one payoff §3.12 was still owed

Every chapter epilogue ends on an artifact recovered from **GLIMMR**, the dead
platform Part 2 takes place inside, and §3.12 unlocks the lore entry *The First
Signal, Annotated* at ten. Both now exist. The Archive is a panel on the story
screen listing ten slots with the gaps drawn rather than hidden, because "four of
ten recovered" is the feeling the connective tissue was designed for.

The fragment a save holds is **the artifact that save actually saw**, recorded by
the runner as the epilogue plays — four chapters put theirs inside a branch, so
which one you got is a fact about your playthrough, not about the file. Chapters
cleared before this shipped fall back to the file's own last `POST:`.

Building it turned up a content gap that had been invisible: **Chapter 9 had no
GLIMMR artifact at all**, and Chapter 1's was the only one not attributed on the
POST itself. Both fixed, and `npm run story` now asserts every chapter's last
episode ends on a post naming GLIMMR, so an eleventh chapter cannot quietly leave
a permanent hole in a list of ten.

### The format is plain text, on purpose

A chapter is one `.story.txt` file in `data/story/`. Drop it in the folder and it
is in the game — nothing registers it, nothing imports it, no code changes. File
name decides order; the chapter's **title** decides its save id, so renaming a
file to reorder the campaign never wipes anyone's progress.

```
TITLE: Encore, Please
FACTION: Neon Idols

=== EPISODE: Soundcheck for Nobody

NARRATION: There are no positions. There is no one to take them.
Lumi Starcall (smiling): Poppy. From the top. Track nine — the encore.

CHOICE: What do you say to that?
  * Then you're late for rehearsal.
      REMEMBER: tone is warm
      Lumi Starcall: Warm-ups. Eight counts. Go.
  * There is no unit left to understudy.
      REMEMBER: tone is guarded

IF tone is warm:
  Nova Encore: I heard you were kind about it.

BATTLE: Vex Klipp
  PLAYS: Cyra Swipe
  DIFFICULTY: beginner
  RULE: clip farm
  IF YOU LOSE:
    Lumi Starcall: Again.
```

That is the entire language: eight statements, no ids, no punctuation to
balance, no schema. `docs/design/11-story-and-roguelike.md` §4.2 specifies a JSON
scene graph with node ids, `goto` edges and i18n keys instead. **This is a
deliberate divergence and the runtime concepts are unchanged** — scenes, lines,
choices, flags, battles and resume all exist exactly as specified. What changed
is who has to type them. A missing comma should not be able to break the game,
and nobody should have to know what a `cardId` is to write a scene.

### What the design bought

| Decision | Why |
|---|---|
| **Names, never ids.** `PLAYS: Cyra Swipe`, `PLAYS: Neon Idols`, `RULE: clip farm` | A writer never opens `data/cards/`. Everything is matched against display names first, ids second, and anything unmatched is reported with the closest name that *would* have worked. |
| **Battle rules are a menu, not code.** `data/story/rules.json` holds 17 named rules; a script picks one by name | The mechanics are ordinary `EffectDef`s validated by the same schema as every card, authored once by somebody who knows the DSL. The writer gets the mechanics *and* the sentence the player reads, and never touches the effects DSL. |
| **Flags cross chapters, with no new syntax.** Chapter 1 writes `REMEMBER: invited vex`; Chapter 3 writes `IF invited vex:` and it works | Canon §3.12 pays off decisions between chapters. Each chapter still *owns* its flags — that is what keeps "start this chapter over" a clean delete — but can read every other chapter's, layered underneath its own. The compiler is given every script's flags before it compiles any of them, so the feature the design asks for is not reported as a typo, and a misspelling still is. |
| **Nested blocks, not jumps.** Choices and conditions own their lines by indentation | Removes two whole classes of writer error by construction: there is no dangling `goto` and no unreachable node, because there are no labels. |
| **Compiled flat, run by one integer.** Each episode becomes a numbered list of steps with jumps | The runner's entire position is `pc: 41`. That is what makes the battle handoff cheap: leaving for the battle screen and coming back needs no tree to walk into and no stack to serialise. |
| **A broken chapter cannot break the game.** | Card data is different — a typo there is a rules error and the app refuses to boot. A story script is prose, edited by non-programmers, and half-finished is a normal state for one to be in. A chapter that does not compile becomes a **card on the story screen carrying its own report** — file, line, the line's text, what is wrong, and the fix — while every other chapter still plays. |

`npm run story` runs the same check in a terminal; the guide is
`data/story/HOW-TO-WRITE-A-CHAPTER.md` and the starting point is
`data/story/TEMPLATE.story.txt`, next to the chapters themselves rather than in
`docs/`.

### Errors are the feature

Every complaint names the file, the line, quotes the line, says what is wrong in
one sentence of plain English, and says what to do. Where a name is misspelled it
offers the closest one that works. A sample of what is refused:

- a line inside a `CHOICE` that is not indented under any option — the mistake
  the format most invites, and one that would otherwise play whichever option was
  picked. Reported **once**, and the line is given to the option above it, so one
  missing indent produces one complaint instead of a cascade about missing
  options and a choice that does nothing;
- a choice whose options all do nothing, so the story plays out identically
  whichever the player picks;
- an `IF` reading a flag nothing ever remembers (with the closest flag that *is*
  written — this catches typos before a player ever sees one);
- a line that is neither clearly dialogue nor narration; it refuses rather than
  silently inventing a character called "The sign reads";
- a battle naming somebody who has no cards of their own, saying which line to
  add.

Complaints are collected, not thrown at the first one: a battle with a misspelt
opponent *and* a misspelt difficulty reports both, on their own lines, in one
pass.

### 70 story tests, and a browser walk

`tests/story-format.test.ts` tests the **error messages as carefully as the happy
path** — an error that does not name the line, or explains the problem in terms
of the parser rather than the script, is a bug in this feature.
`tests/story-scripts.test.ts` (`npm run story`) walks every episode of every real
chapter **down every combination of choices**, because walking each episode once
would leave the far side of every decision — which is most of what a branch buys
— never executed. It also asserts the guide lists every rule, wave set, leader,
boss and faction a writer can name, so none of those lists can grow without the
documentation following, and it walks every `WAVES:` line all the way to the
reinforcements the match will actually deal.

`npm run verify:story` plays the chapter in a real browser: the mode card, the
list, an episode, **one battle for real** — through the brief, the battle screen,
and the route back — then every remaining episode. It checks that a decision's
flags survive the trip through the battle screen, that a loss plays the episode's
own loss lines and returns to **the same step** rather than past it, and that
Story Assist is offered afterwards. Finally it writes a chapter with a deliberate
mistake into `data/story/`, confirms the report names the file, the line and the
fix, and confirms the real chapter is still playable beside it.

That walk found three real bugs that no unit test could:

1. **A hidden overlay was eating every click.** `[hidden]` loses to an author
   `display` rule, so the invisible battle-brief overlay was laid out over the
   whole scene and swallowed every click on it. (The project has hit this before;
   the three new hideable blocks now say `display: none` for themselves.)
2. **Complaints pointed at the wrong line.** A misspelt opponent was reported on
   the `BATTLE:` line rather than the `PLAYS:` line below it — and a writer told
   "line 5" about a mistake on line 6 reads line 5 and finds nothing wrong with
   it. Every battle property now carries its own line number.
3. **A failed battle made its episode look empty.** An episode whose only content
   failed to compile also reported "this episode is empty", sending the writer to
   the heading to look for a mistake that was four lines below it.

### What the orchestrated pass on Chapters 6 and 7 caught

Chapters 6 and 7 were each designed by a fan-out (five researchers, three
independent outlines from different angles, three judges on separate lenses),
drafted by hand from the winning outline, then attacked by five review lenses
whose serious findings were each handed to a *separate* agent instructed to
refute them.

The refutation step is the part worth keeping. Across Chapters 6 and 7 it saw
**20 serious findings and confirmed 5** — the other 15 were built on truncated
quotes, on lines that were correct inside the block they actually appear in, or
on authorities that did not say what they were said to say. Acting on all 20
would have made both chapters worse.

What survived was almost entirely **arithmetic**, and it is the same failure
every time: numbers that are house-palette decoration rather than sums a reader
can check.

| Chapter | Confirmed defect |
|---|---|
| 6 | "Forty-one hours to prejudging" — the stamps say twenty-two |
| 6 | A repair "nineteen hours old" — the stamps say forty-seven |
| 6 | Staying to the end of the photo line finished *before* leaving early did |
| 6 | Vera retired "nine years" ago and hands the trophy over in 2019 — six |
| 7 | Six people in a room containing five, contradicted nine lines apart |
| 8 | The forum argument runs on a laptop the generator switched off sixteen hours earlier |
| 8 | The Coach puts his own watch in the tub *after* counting it, so 27 go in and 28 come out |
| 8 | Eleven miles of ridge walked in fifty minutes — 13 mph, uphill, in the dark |
| 8 | A summit register of six hundred names, on a hill one man has signed nine hundred people off |

Chapter 6's self-check had verified the stamps were strictly *increasing* and
never checked the stated durations *against* them — the same shape as the eleven
auto-completing puzzles: the easy invariant checked, the load-bearing one
skipped. Chapter 7 was checked the other way first and shipped with one count
error instead of four.

Chapter 8's four are a **different failure and a worse one**: every stated
duration in that file was verified against its own clock before review, and all
of them held. What the clock could not catch is a *mechanism* — the generator
goes off for the night in Episode 2 and the chapter keeps using the power it
took. The lesson the arithmetic lens actually teaches is broader than arithmetic:
anything the chapter switches off has to stay off, and the header clock is now a
list of mechanisms as well as times.

**Chapters 9 and 10 were written without a review pass**, so their self-check is
the only check they had, and it is recorded here at the same standard rather than
quietly omitted. It found nine things, and the two classes it found are the two
classes that keep recurring:

| Class | Instances |
|---|---|
| A number that does not survive being counted | "Four words" over a three-word change-log entry; "eleven words" over a seven-word log line; the same 41,206 used for replies in one episode and reposts in the next; a board of 400 voting 312 with nothing said about the gap; the Truce Thread declared to contain eleven words and then given a prose post |
| A line outside an `IF` that only makes sense inside one | Chapter 10's pile-on arriving "on the fork" on the branch where nobody forked; the Vault's nightly entry implying a post that exists on one path; "It doesn't know it's over" on the path where it is not over; and, in Chapter 9, the boss recommending a Chapter 4 video that only exists if the player bought out that contract |

### The branch-truth check, and what it found in Chapter 1

The second class above was a real hole: the compiler proves every branch
**reaches an ending** and the tests walk all of them, but nothing checked whether
a line *outside* a branch was **true** on every branch. `tests/story-branch-truth.test.ts`
closes it. A test cannot read for meaning, so it reads for vocabulary: a phrase
that appears in exactly **one** line that always plays, and otherwise only inside
branches, is a line borrowing something it did not establish. Phrases used
unconditionally more than once are the chapter's shared vocabulary and are
ignored, which is what keeps the signal usable.

Getting there took three passes and both wrong turns are worth recording, because
each was the test lying rather than the chapters being clean. Including speaker
names turned every recurring character into a false positive and buried the real
findings under 58 rows. Treating a **Side Cut** as unconditional was worse: its
lines carry no `IF`, but the whole episode is gated, so everything in one is
branch-owned.

It found two genuine defects on its first honest run, one of them in the oldest
chapter in the game:

| Chapter | Defect |
|---|---|
| 1 | The reunion's house lights come up on "twelve thousand seats" in a line that always plays — but a player who **kept the name** played to nine hundred and forty, and the chapter says so eleven lines earlier |
| 8 | A narration picked up "Everyone always is" from a line that only plays **if you lose the battle**, so on a win it answered nothing |

Both fixed, plus a duplicated "eleven years" given to two different characters in
Chapter 6. The fifteen surviving findings are echoes rather than defects and each
sits in an `ALLOWED` list **with its reason written down** — the same
assert-against-a-justified-list pattern the deck-pool invariant uses. A warning
nobody reads is not a test; new leaks now fail `npm run story`.

The design pass also found two bugs in already-written chapters: **Half-Four Mari
was "a man… himself" in Chapter 3 and "she" throughout Chapter 4**, and Chapter
6's own header note described its Side Cut deviation inaccurately.

One finding was a real engine defect rather than a writing one. Chapter 8's
finale shipped a draft `GOES FIRST: them`, on the reasoning that a man who has
walked the ridge for forty years should move first. Tracing it through
`state.ts` showed it does the opposite of what it reads like: the seat that does
*not* go first is dealt an extra card and a Borrowed Clout token, and the
Groundskeeper's printed *Log Off* — banish the costliest enemy character at the
start of his turn — is a no-op against an empty board on turn one. The flourish
was handing the player two advantages and disarming the boss's signature. It was
cut. `GOES FIRST` remains documented and unused by every shipped chapter.

### The trap writing Chapter 2 found

`REMEMBER: manners held is false` stores the *word* "false", and `IF manners
held:` read any non-empty string as set — so the branch that was meant to be
excluded ran, and both sides of the choice played the same lines. Silently, and
only down the path nobody reads back.

It is worth recording how it was found, because no test caught it: the branch
walk proves every combination of choices reaches an ending, which this did. It
was found by re-reading the chapter after writing it. The fix treats `false`,
`no`, `none`, `never` and `off` as no, because "remember that it did not happen"
is the natural phrasing — it was written that way by the first person to draft a
chapter against the format, which is the only evidence that matters here.

### Deliberate limits

- Seven of the ten chapters recast a "proposed" leader the design names onto the
  one that actually shipped (Astra Vox → Lumi Starcall, Delia Marque → Cressida
  Vale, Vaska Nullbyte → Ashvyre, Dez Threehours → Half-Four Mari, Prior Wend and
  Sister Fen → Juniper Vale and Rhett Halloran, Don Vittore Feed and Auntie
  Metric → Don Sortino and Cassia Cache, Anon Prime and Lil Gremlin →
  Chairperson Nobody and Skree Nine-Tabs), which the faction guides always said
  they owned. Every recast is named in its own file's header.
- ~~**§3.10's Episode 4 asks for a multi-wave board.**~~ **Built** — see *Waves*
  below. Chapter 9's Episode 4 is the campaign's one multi-wave encounter and
  no longer approximates it.
- Chapter 8 is the campaign's first use of `DIFFICULTY: advanced`; the seven
  before it run beginner, casual, intermediate ×3, boss without exception.
  Chapters 9 and 10 use it too, and all three flag it, because the deviation
  block is the only audit trail a later editor gets.
- Chapter 6 could not deliver the design's **Side Cut** ("The Stairwell
  Workshop", an optional seventh battle unlocked by Branch A) because the format
  is six episodes with one battle each and has no optional slot. It ships as a
  scene inside Episode 4 whose content varies by Branch A — smaller than the doc
  asks for. Flagged in the file's header rather than absorbed silently.
- Portraits are procedural: a stable hue from the character's name plus their
  initials. The game must look finished with zero character art, and a writer
  inventing a character in a line of dialogue gets a portrait for them
  immediately without asking anybody for anything.
- No i18n keys. The design spec routes every string through `i18n/en.json`; a
  writer typing lookup keys instead of dialogue is the opposite of the goal here.
  Localisation of story text is deferred rather than half-built.
- Rewards are flat per episode (75 Clout, first clear only, every branch equal)
  per the canon rule that branches buy story and never power.

---

## The DSL coverage sweep

`tests/dsl-coverage.test.ts`. Five bugs in this project have had one shape: **a
thing that exists, validates, is used by shipped content, and does nothing.**
Flow fired on one of four channels. `balanceOverrides "obsession.fixationCost"`
bent a number nothing charged. `{ op: "destroy" }` had never destroyed anything.
`buff.permanent` was read by no code. `resurrect` ignored the filter on its own
target. Each was found separately, by accident, while looking for something else.

So the class is now hunted on purpose. The suite reads the effects DSL **out of
the zod schema** — 44 ops and every optional field on each — and asks one
question per entry by running the engine: *does the outcome differ when this is
there?* An op that changes nothing, or a field that changes nothing when set,
fails by name.

**The coverage tests are the point.** A new op, or a new optional field, that
nobody has proved does something fails the suite — so the class cannot come back
quietly. Exemptions are allowed and have to be written down with a reason
(`aura` is never executed; `once`/`oncePerTurn` need the same effect offered
twice and are proved on a leader passive in `boss-twists.test.ts`, which is
exactly where they once did nothing). Three further guards keep the lists honest:
an exemption that stops naming a real field fails, and so does a case for a field
the schema does not actually make optional.

### What it found: nothing new, and that is the result

Every op and every optional field in the DSL does something. After the three
fixes from the card-text audit — which is what prompted this — the surface is
clean, and it is now clean *provably* rather than by assumption.

The sweep's own false positives were the interesting part, because each is a way
this kind of test lies:

| Reported inert | Actually |
|---|---|
| `copyCardToHand` | copies the card of a character on the BOARD; a hand card has no `TargetRef`, so the hand-zone spec I gave it resolved to nothing |
| `modifyTriggeringCardCost` | reads `ctx.triggerCard`, and I passed an instance that was not in anybody's hand — so the mutation was real and invisible |
| `refract` | acts on `ctx.sourceCharacter`, which the harness had not set |
| `swapAttackHealth` | swapped a 2/2 into a 2/2, because the fixture body happened to be square |
| `banish.returnAtStartOfYourNextTurn` | defaults to **true**: omitting it banishes temporarily and only an explicit `false` is permanent, so undefined-versus-true is the same banish twice |
| `scry.pick` | is read, but its two values are `random` and `mostPlayable`, and a random pick can land on the card the deliberate one would — so it gets a behavioural test instead of a differential one |

> And one finding was a bug in the test that read as a bug in the engine.
> `if.condition` was written up as an optional field and "proved" with a
> conditionless `{ op: "if" }` — which crashed, and looked like a shipped hole
> until the **typecheck** pointed out that `types.ts` requires the field and only
> my fixture omitted it. The engine was right; the fixture was invalid data that
> the schema would never have accepted. The guard added in haste was reverted,
> and the check that would have caught it in one step — *"tests no field that is
> not actually optional"* — now ships beside the others.
>
> Worth keeping for two reasons. `npm test` alone passed with the type error
> present, because vitest does not typecheck: the project's own working rule to
> run both is load-bearing. And a test that "finds a bug" in code the schema
> protects is worth doubting before it is worth acting on.

---

## Merch Drops, and what a new account owns

The first piece of the progression brief: five-card packs, bought with Clout,
and the duplicate-protection algorithm behind every random card grant.

`07-economy-and-monetization.md` §5 writes that algorithm out as **binding** and
ends with a paragraph headed *"Consequences (stated so QA can assert them)"*.
Those consequences are the tests: no card id twice in one Drop, always a Rare or
better, a Legendary within 40 Drops on every seed tried, never a useless
duplicate while an unowned card of that rarity exists, and conversion to Signal
only once a rarity pool is complete and always at the bonus rate. Each was
confirmed by breaking the algorithm on purpose — removing the unowned tier, the
floor, the pity and the in-Drop de-duplication each fails the suite.

`src/game/economy/drops.ts` is pure: state in, result out, randomness from a
seeded PRNG the caller owns. The account stores the live PRNG state rather than
a seed and a count, because the number of draws a Drop makes depends on the
collection it was opened against — so an opening history can be re-derived and
checked rather than merely believed, which is what the future authoritative
server needs in order to sign it.

The shop panel prints the rates, the Rare floor, the Legendary counter and the
duplicate rule **from `balance.economy.pack` — the same object the algorithm
rolls from**, so an advertised number cannot drift from a rolled one. A test
asserts the printed odds sum to 100% and match the table.

### The bug that building it exposed

`ensureStarterCollection` handed every new account **two copies of every Common
and Rare and one of every Epic and Legendary** — that is, the whole game. Commons,
Rares and Legendaries were therefore at their playable cap on day one, and the
consequence was not subtle:

> **A Merch Drop could never grant a card the player did not already own.** 93.5%
> of every slot converted straight to Signal; the only cards that landed were
> second copies of Epics.

That was not the algorithm misbehaving — it was doing exactly what it promises
against a collection that was already complete. The grant was a placeholder built
when there was nothing to earn, and the progression system arriving is what made
it wrong. The first browser run of the shop showed four of five cards converting,
which is how it was caught.

### Starter decks

The economy doc's own answer (§3.4) now applies: one faction's complete 30-card
starter deck, chosen on a new account's first screen, plus its Leader and five
free Drops. ~~The other nine are meant to be unlocked by playing them — **the
Grand Tour is not built yet**~~ — **it is now built**; see the section below.

The ten lists are generated by `src/game/progression/starterDecks.ts` and frozen
into `data/progression.json`, which is the source of truth: edit a list by hand
and the game uses it. Two things are worth recording about generating them.

- **The starter Leader is each faction's dual-Current one.** A first-by-id rule
  produced five starter decks instead of ten, silently: five factions' pure-Current
  Leaders cannot legally supply seventeen Commons, because a Leader only has two
  of the eight Currents available. Returning a bare `null` hid five different
  failures behind one symptom; the generator now names the faction, the Leader and
  the rarity that ran out.
- **The published 17/9/3/1 mix is not achievable for every faction.** Four of them
  fall one to three Commons short for the same reason and take Rares instead. Every
  list is still 30 cards, legal for its Leader, and holds exactly one Legendary and
  three Epics — which is what the tests assert, rather than a mix the content
  cannot supply.

Existing saves are untouched: an account that already holds a collection keeps it
and never sees the picker. `tests/starter-decks.test.ts` asserts the thing the
whole change exists for — that ten Drops opened by a new account grant more than
twenty cards it did not own and convert nothing — and `npm run verify:shop` walks
it in a browser, from an empty profile to a deck to five free Drops.

> Changing what a new account owns broke **every other browser verification at
> once**: each launches a clean profile, which is now a brand-new account, so all
> eleven landed on the starter picker. They share `scripts/lib/account.mjs`, which
> starts an account through the app's own picker — no second definition of what a
> starter grant is — and then fills the collection, because a Doomscroll
> verification should fail when the Doomscroll breaks and not when onboarding
> changes shape. `verify-shop.mjs` deliberately does not use it: the new-player
> path is the thing it is checking.

---

## The Grand Tour

`07-economy-and-monetization.md` §3.4, in one sentence: *"win 1 match (AI Practice
counts) with each remaining faction's loaner deck to permanently unlock that
faction's starter deck. Completing all 10 grants 1,000 Clout + 10 Merch Drops +
1 Legendary of your choice."*

This closes a loop the starter picker opened and could not finish. An account
chooses one faction on its first screen, and the picker's closing line — *"you
can unlock the other nine by playing them"* — was, until this shipped, **a
promise about software that did not exist**. Nine tenths of the game's content
was unreachable by any means.

A **loaner deck is the faction's starter deck, lent for one match** — the same
thirty cards the win is played for, not an auto-build. That is the whole point of
the mode: you try the deck, and if you win you keep it. `tests/grand-tour.test.ts`
asserts it card for card, because a mode that lends one list and pays out another
would look identical from the outside.

| Decision | Why |
|---|---|
| **`#battle?tour=<faction>` — a parameter on the practice route, not a mode of its own** | §3.4 says *"AI Practice counts"*. A separate route would be a second definition of a practice match, and the first thing to drift would be whichever of the two nobody plays. |
| **The unlock hangs off a win and nothing else** | A draw and a concede leave the tour where it was. `verify:tour` proves it by conceding one on purpose and checking nothing moved. |
| **The grant is `grantStarterDeck`, unchanged** | The tour pays *"that faction's starter deck"*, so it calls the function the starter picker calls. Two functions would eventually disagree about what a starter deck is. |
| **The Drops come once, with the first deck** | §3.4 attaches the five free Drops to the account's first deck, not to each of ten. |
| **A won deck never becomes the active deck** | Unless it is the account's only one. Changing what somebody is playing with because they won a match with something borrowed is not a reward. |
| **No difficulty floor** | §3.4 says only *"win 1 match"*, where §3.5 states a floor explicitly for the daily win. Where the doc wants one it says so, so the absence is read as meaning what it says. Casual is where the panel opens. |
| **Every locked stop is drawn in full**, leader art and all | A tour is a list of places you have not been. Same reasoning as the Archive's empty slots and the story screen's greyed Side Cuts. |
| **The reward is printed from `balance.economy.grandTour`** — the object that pays it | The shop panel's published-odds rule, applied again before it could be broken. |

### The opponent had to change, and the design said so

The practice route's ordinary rival is `autoBuildDeck` over a Leader's whole legal
pool — Epics and Legendaries included. That is a fair opponent for a constructed
deck and **not** one for a list that is seventeen Commons with three Epics and one
Legendary in it.

The browser run that first suggested this is *not* cited as evidence, because it
was taken while the harness was still discarding its own mulligan — the number it
produced was measuring a handicap. The argument is the design's, not the
measurement's, and §3.4's own last line settles it: *"Starter decks are legal in every constructed
mode and are the **baseline used for new-player matchmaking pools**."* The Grand
Tour is that pool, so a tour match is starter against starter — the next faction
on the list, wrapping, so the match seed still rebuilds the whole match.

**`npm run balance -- --only tour` measures it**, which is where a question about
decks belongs: 240 matches in four seconds, both seats played so the first-seat
advantage cancels, same AI on both sides so the number is about decks and not
skill.

```
=== GRAND TOUR — 240 loaner matches, casual AI, 12 round(s) per faction
the loaner deck won 106 (44.2%)
   58.3%  afterparty-crew      vs Algorithm Syndicate     87.5%  digital-demons  vs Gothic Royalty
   29.2%  algorithm-syndicate  vs Corporate Creators      29.2%  gothic-royalty  vs Meme Collective
    4.2%  corporate-creators   vs Cosplay Champions       16.7%  meme-collective vs Neon Idols
   41.7%  cosplay-champions    vs Digital Demons          83.3%  neon-idols      vs Touch-Grass Order
   45.8%  touch-grass-order    vs Viral Influencers       45.8%  viral-influencers vs Afterparty Crew
```

44.2% overall is a real match. **The spread is not**: the pairing rule is
arbitrary, so Corporate Creators drew a 4.2% matchup and Digital Demons an 87.5%
one for no designed reason. Two things are worth being precise about before
anyone tunes it:

- This is **equal skill on both sides**. A human on Beginner — which the tour
  offers and which "misses lethal about half the time" — is not the player this
  number describes. It measures the *matchup*, not the experience.
- It is therefore a playtest question, not a number to fit. The harness guard is
  deliberately wide (20%–80% overall) and exists to catch the mode breaking — a
  stop that becomes impossible, or one that becomes a formality — rather than to
  pin a target the content cannot hold still for.

### What the content cannot currently supply

Two findings, recorded rather than smoothed over:

- **The Legendary choice has one card in it.** The game prints **11 collectible
  Legendaries** and the ten starter decks hand over ten of them — nine factions
  print exactly one, and Viral Influencers prints two. So a player finishing the
  tour today chooses from a shelf holding *Kade Everloud, Always Live*. This is
  content size, not a defect: §10.1 models the launch set at 50 Legendaries and
  the shipped set is 195 collectible cards rather than 500. The reward is
  implemented as written and becomes a real choice as the set grows. A test
  asserts the shelf is never *empty*, which would strand the Clout and the Drops
  behind an impossible pick — and for the account that owns every Legendary, the
  choice pays out as Signal at the published duplicate rate rather than refusing.
- **§3.4 and `08-progression.md` disagree about how the other nine arrive.**
  §3.4 says the Grand Tour; the progression doc's level table says *"2 chosen at
  onboarding, remaining 8 granted at levels 3–17"*. They cannot both be true.
  §3.4 is followed, because it is the more specific of the two and it is the one
  that names `data/progression.json` — which is what was built. Flagged here
  rather than resolved silently.

### A bug this found in code that was already shipped

`grantStarterDeck` incremented the collection with **no cap**. That was invisible
while an account got exactly one starter deck, and is reachable today without the
tour: open Merch Drops until a card in your next starter deck is at the playable
cap, and the grant takes you to three copies of a Common — an amount the deck
builder refuses to play and the collection screen cannot honestly draw. Copies
over the cap now convert to Signal at the published duplicate rate, the same way
a Drop's do. Two tests cover it, one arithmetic and one that simply walks the
whole tour and asserts nothing anywhere ends up above its cap.

### And one the review found in the new code

The completion claim is banked in `claimedRewards`, the existing one-off ledger —
which `claimOnce` trims to its most recent 400 entries. That trim is correct for
what it was written for: a boss first-clear is keyed per boss, per tier, **per
week**, so those keys accumulate at about thirty a week and forgetting an old one
costs nothing. It is wrong for a reward that may only ever be paid once in the
life of an account.

Left alone, the Grand Tour's key would have aged off the front after roughly
three months of ordinary play, and **1,000 Clout, 10 Drops and a choice Legendary
would have become claimable again** — repeatedly. Permanent keys are now retained
by the trim regardless of age, and a test fills the ledger with a year of weekly
boss clears and then tries to claim a second time.

The lesson is not "check your ring buffers": it is that reusing a mechanism means
inheriting the assumptions it was written under, and this one had "these keys are
disposable" written into it in a comment nobody had reason to re-read.

### 26 tests, and ten deliberate breakages

Every claim in `tests/grand-tour.test.ts` was checked by breaking the code that
implements it and watching the test fail — the cap clamp, the idempotency guard,
the Drops-once rule, the active-deck rule, the choice count, the owned-Legendary
refusal, the not-finished refusal, the duplicate-choice refusal, the loaner's
card list and the completion count. All ten were caught.

Two of them were *not* caught on the first pass, and both were the test's fault
rather than the code's:

1. **"a won deck always becomes the active deck"** was mutated to `if (true)`,
   which changed nothing — the block sets index 0, and index 0 is what the test
   asserts. The mutation that matters is the behaviour this replaced,
   `activeDeckIndex = decks.length - 1`, and against that the test fails.
2. **"refuses the same Legendary listed twice"** was vacuous. `legendaryChoices`
   is 1 in the shipped file, so a two-card list is refused by the *count* check
   and the duplicate check never runs — an unreachable branch, which is the
   inert-code smell this project has found five times. The test now drives the
   rule at the value that makes it bite, by handing the grant a content index
   whose balance asks for two.

### `npm run verify:tour`

Plays a loaner match to a real win in a browser, then checks the deck that
arrives is card-for-card the deck the match was won with. Three things about it
are worth copying:

- **Both sides are the game's own AI**, imported from `/src/ai/ai.ts`. A greedy
  policy written in the script would be a second, worse opponent model whose
  losses would read as tour bugs.
- **It plays its mulligan.** Clicking Confirm with nothing selected is not "no
  mulligan" — it is throwing the mulligan away while the opponent takes theirs.
  The first version did exactly that and then reported the loaner deck losing,
  which read as a balance finding and was a handicap the harness had applied to
  itself.
- **The eight remaining unlocks are seeded through the app's own
  `recordTourWin`**, not by editing `localStorage`. Beyond there being no second
  definition of an unlock, the profile store writes on a debounce and flushes its
  in-memory copy on `pagehide` — so a hand-edited save is overwritten by the very
  reload it was made for. That cost a debugging pass.

> And one harness bug is worth recording because it looked exactly like a game
> bug for an hour. The play loop treated "the AI decided to end the turn" and
> "the AI had nothing to decide" as the same thing, and so submitted `endTurn`
> **twice** — the second landing on the following turn, which the player then
> skipped. Every seed lost, and the trace read as a deck too weak to win.

### Two timeouts that were never in force

Adding 26 tests made the suite slower to run in parallel, and that tipped over
**`tests/ai.test.ts`, which had been sitting at ~70% of the default 5-second
budget** with no timeout of its own. Its simulations play whole matches and are
fully deterministic, so a failure there is always real — the budget is now set by
how long the work takes under load rather than how long it takes alone.

Chasing the same symptom in `verify:ui` found the sharper version. Playwright's
signature is `waitForFunction(fn, arg, options)`, and **every one of the 18 call
sites across `scripts/` passed the options object second** — where it is read as
the page function's *argument*. So every explicit timeout in the browser harness
has been silently discarded in favour of the 30-second default, for as long as
those scripts have existed:

| Asked for | Actually got |
|---|---|
| `verify-ui`'s "wait until it is genuinely your turn" — 45s | 30s |
| `verify-boss`, `verify-doomscroll`, `verify-tour` — 40s | 30s |
| `preview-cards`, `preview-leaders` — 15s | 30s |
| ten debug scripts — 30s | 30s (correct by coincidence) |

`verify:ui` step 12 therefore failed whenever the machine was busy and passed
whenever it was not, which is the worst kind of check: it teaches you to re-run
until green. All 18 are fixed. It is the same lesson as the eleven
auto-completing puzzles and the underline asserted by class name — **a limit you
wrote is not a limit that ran.**

The headline from the run:

```
3. Winning the loaner match
   ok: won on attempt 2 (seed 202)
   ok: algorithm-syndicate is unlocked, permanently
   ok: the deck arrived: "Algorithm Syndicate Starter"
   ok: it is card-for-card the deck the match was won with
   ok: the active deck was left alone
   ok: the collection grew by 29 card(s) — the rest were already at the playable cap
4. Back on the tour
   ok: the tour counts the win: "2 of 10 unlocked"
PASS — The Grand Tour
```

That "29" is the cap rule working: the thirtieth copy was a neutral card the
starter deck had already supplied, so it converted to Signal instead of becoming
an unplayable third copy.

---

## Missions, and the income contract

`07-economy-and-monetization.md` §3.5 is titled *"Reliable free weekly income
(**the contract**)"*. Before this, none of it existed: a match paid 35–60 Clout,
a Merch Drop cost 100, and there was no reason to come back tomorrow rather than
play six matches tonight. Drops and the Grand Tour opened that loop; missions
close it.

**18 daily missions and 8 weekly ones**, written out in `data/missions.json` from
§7.1 and §8.1, plus the first win of the day and the Weekly Restock.

### Progress is evidence, not a counter

The design says "defeat 8 enemy characters" and the profile has no idea how many
you defeated. So a finished match is read by **replaying its own record** —
`MatchRecord` is `{config, intents[]}` and `replay()` rebuilds the whole match —
and `src/game/missions/stats.ts` totals twenty statistics out of the event
stream.

| Decision | Why |
|---|---|
| **Derived from the record, not from the live match** | Every mode already produces a record, so the tutorial, puzzles, the Doomscroll, a story battle and a practice match all count without anything being wired per mode. A hook on the battle screen would silently miss the modes that do not use it. |
| **Counted by *target* wherever possible** | `damageDealt` and `healed` carry no seat. Rather than guess an actor from whose turn it is, "damage to enemy leaders" is damage whose target is the other leader. Exact, and indifferent to whether it came from an attack, a card or a Reaction on the opponent's turn. |
| **Progress recomputed from stored outcomes** | A counter cannot be re-derived, so a bug in one is permanent and invisible — and a mission issued today would have to decide what to do about matches already played. Each held mission records `issuedAt` and is scored from the matches after it. |
| **The evidence log is pruned to what is still needed** | Bounded by the oldest held mission's `issuedAt`, so it does not grow without limit. |

Instance-to-controller resolution is seeded from the **opening board** as well as
from events, because a scripted encounter deals its characters through setup ops
— so an events-only map would be blind to every character a puzzle or story
battle starts with, which is most of them.

### The banking rules are policy

§6 makes **F6** binding: *"No unhealthy-playtime pressure. No streak resets, no
lose-it-if-you-miss-it daily grants."* Everything in `rotation.ts` follows from
it, and it is tested rather than described: a rotation handed a **thirty-day
absence** returns three dailies, not thirty, and **the three it was already
holding are still there**. There is deliberately no code path that removes an
unclaimed mission.

The screen says so too, in a sentence at the top. A player cannot tell a banking
system from a hidden timer unless they are told.

### What ships, and what the contract still owes

§3.5 publishes a weekly total of **2,300 Clout**, and its own line items add up to
it exactly — which makes it assertable, so `tests/missions.test.ts` asserts it:

| Source | Weekly Clout | State |
|---|---|---|
| Daily missions (3 × 50) | 1,050 | **ships** |
| First win of the day (7 × 30) | 210 | **ships** |
| Weekly missions (3 × 200) | 600 | **ships** |
| Ranked Weekly Chest | 150 | needs ranked, which needs a server |
| Login cycle | 100 | not built |
| Season pass, free track | 190 | not built |
| **Published total** | **2,300** | **1,860 of it ships** |

Plus the Weekly Restock's 3 free Drops and the Weekly Wrap's 1, both shipping.
The test asserts `1,860 + 150 + 100 + 190 = 2,300`, so the gap is accounted for
line by line rather than absorbed.

### Two documents disagreed, again

§3.5 pays a daily **50 Clout** and a weekly **200**; `08-progression.md` §7 pays
**40** and **150**. §3.5 wins, and the tie-break is not seniority — it is that
**§3.5's table sums to its own published total** and §08's numbers would break
that sum. §08 supplies everything §3.5 does not: the 3-slot structure, the 09:00
UTC reset, the reroll, the slot constraint, the 28 mission sentences and the XP
values. Both are used, each for what it is authoritative about.

~~**Two weeklies from §8.1 are absent**: *Understudy Arc* and *Second Bias* gate
on Leader and Faction Mastery, which §4 specifies and nothing implements.~~
**All ten weeklies now ship** — the Mastery tracks arrived and brought them with
them. See the Mastery section below for how a rank is stamped onto a match.

### 32 tests, twelve deliberate breakages

The coverage test is the important one, and it is the same shape as the DSL
sweep: **every statistic a shipped mission depends on is played for real until it
moves**, or is listed with a written reason. A mission counting something that
never moves does not throw — it just never completes, and looks exactly like a
player who has not got round to it.

All twelve mutations were caught, but **three only after the tests were fixed**,
and all three were the tests being weak rather than the code being right:

1. **The evidence-window test was guarded by `if (view)`** and did nothing at all
   on most seeds, because the mission it looked for was usually not in the
   rotation. It passed against a build that counted every match ever played.
2. **The slot-constraint test could not fail.** The shipped daily pool contains
   exactly *one* deck-specific mission, so "at most one at a time" cannot bind
   against real data — asserting over the real pool passed happily with the
   constraint deleted. It now runs against a fixture pool that *can* violate it,
   and a second test covers the deliberate escape hatch: if every remaining
   mission is deck-specific the constraint yields rather than leaving a slot
   empty, because starving the player is the pressure F6 exists to prevent.
3. **The reroll test rerolled at the instant of issue**, which makes "kept the
   window" and "restarted the window" the same number. It now rerolls five hours
   later.

> And the suite found a real one in passing. `createdAt` was left at 0 until the
> starter deck was granted, and Rookie Road is measured from it — so a brand-new
> account read as "not new" and was quietly paid the **single** daily rate
> instead of the doubled one, for the whole 28-day window it was supposed to
> benefit from. It is stamped at account creation now.
>
> The browser walk then failed twice on a claim that "paid 0 Clout" while the
> second claim correctly paid nothing — the profile store writes on a **250ms
> debounce**, so reading `localStorage` straight after a claim returns the state
> from before it. That is the second time that debounce has produced a false
> failure (the first was `verify-tour` seeding unlocks), so both scripts now
> flush before reading. Worth knowing: **in this codebase, a browser check that
> reads the save immediately after a write is measuring the past.**

---

## Mastery — factions, leaders and the Bias Board

`08-progression.md` §4 (Faction Mastery, 20 ranks × 10 factions), §5 (Leader
Mastery, 10 levels × 20 leaders) and §6 (Character Affinity, the Bias Board).
One screen, three tabs, `#mastery`, and a badge on the lobby button.

Reached for next because two shipped-by-design weeklies were waiting on it, and
because it is the first progression surface that rewards **breadth**: §14 lists
"front-loaded faction mastery" and "leader mastery is cosmetic" as binding
anti-monodeck constraints, and neither existed.

### Mastery accumulates; missions derive

The two systems sit next to each other and look alike, and they are opposites.

Mission progress is **recomputed from a bounded log** of finished matches, so a
claim can be re-derived and audited. Mastery cannot work that way: it is
lifetime, that log is pruned to what the oldest held mission needs, and a track
that had forgotten the first two hundred matches would simply be wrong. So
mastery is an **accumulator** — and the price of an accumulator is that it has to
be right the first time, because there is nothing to re-derive from.

That is why `recordMatch` credits mastery **outside** the `try` that guards the
mission statistics. A record that no longer replays cleanly earns no mission
credit, which is recoverable; it must still earn mastery, which is not. All
mastery needs is the leader that was played and whether the match was won.

### The curve is re-scaled, and the design says to do that

§4.1 prints 400 / 800 / 1,200 / 1,600 XP per rank. Those numbers come from §2.2's
assumption that **a match averages 75 XP**, and the shipped match pays 40 on a
win and 25 otherwise — an average of 32.5. Shipping the printed numbers would
make every track **2.3× longer** than the "~Matches" column in the design's own
table, which is the part that expresses the intent.

The doc settles it in its own preamble: *"If the economy doc diverges, its values
win and reward amounts here are re-scaled."* So the curve is scaled by 32.5/75
and rounded to readable numbers, and what is preserved is the match counts:

| Band | Design ~matches | Shipped XP | Shipped ~matches |
|---|---:|---:|---:|
| Faction 1→5 | 21 | 700 | 21.5 |
| Faction 5→10 | 53 | 1,750 | 53.8 |
| Faction 10→15 | 80 | 2,625 | 80.8 |
| Faction 15→20 | 107 | 3,500 | 107.7 |
| **Faction total** | **261** | **8,575** | **263.8** |
| Leader 2→4 | 12 | 390 | 12.0 |
| Leader 5→7 | 24 | 780 | 24.0 |
| Leader 8→10 | 48 | 1,560 | 48.0 |
| **Leader total** | **84** | **2,730** | **84.0** |

`tests/mastery.test.ts` **re-derives that whole table from the shipped match XP**
and fails if any band drifts more than 5%. Changing what a match pays without
re-scaling the curve now fails immediately instead of silently doubling the
length of every track. Both mutations — raising `matchComplete`, and restoring
§4.1's raw 400 — are caught.

### Most of the reward tables cannot be paid, and say so

§4.2, §5.2 and §6.2 are largely cosmetics: card backs, alternate portraits,
emotes, profile frames, titles, Premium variants, voice lines, intro animations,
leader skins. **None of those systems exist.** Leader Mastery is *entirely*
cosmetic and lore by design — §5 is explicit that "faction mastery already carries
the card value, so trying a new leader never feels like abandoning card
progression."

The rule this project already had, from `grantTutorialReward`, applies: *granting
an invisible reward is worse than not granting it — the player cannot tell they
received it, and it double-pays the day the real system lands.* So:

- every cosmetic stays in `progression.json`, so the track can **show** a player
  what is coming;
- `mastery.ts` refuses to grant one, and a rank whose *whole* payout is deferred
  is **not claimable** — it reads "Earned — waiting on the cosmetics layer"
  rather than offering a button that takes the rank away and hands over nothing;
- `DEFERRED_COSMETICS` carries a written reason per type, and two tests walk it
  both ways: nothing may be deferred without a reason, and **no reason may
  outlive the thing it excuses**.

What *is* paid: Clout, Fragments (the game's Signal), **Faction Packs** and
**picks**, on the Faction track — and **lore**, everywhere.

### Lore had to be built, or two of the three tracks would pay nothing

Since Leader Mastery and the Bias Board are lore-and-cosmetics only, deferring
lore too would have meant shipping tracks that grant literally nothing.

`data/mastery-lore.txt` uses **exactly** the format `data/cards/lore.txt` uses —
the parser was extracted to `src/game/loreFormat.ts` so there is one set of rules
to learn rather than two. Written and shipping:

- **All 40 faction pages** (4 × 10), and they escalate on purpose: I is what
  everybody knows, II is the internal logic, III is what it costs, IV is the
  thing the faction does not say out loud. Mastering a faction should feel like
  being let further in.
- **Leader chapter 1 for all 20 leaders**, so level 2 always pays something real.

Still to write: leader chapters 2–4 (60 pages) and the Bias Board pages. They are
prose, not code — nothing needs to change for them to appear. `npm run lore`
lists exactly which are missing, and a test pins the count so it shrinks rather
than being forgotten. An unwritten page reads as an honest placeholder on the
track, never as an error.

### One replay, two products

Affinity is derived from the same walk over the same events that the mission
statistics come from — `readMatch()` returns both. Replaying a match twice to ask
two questions about it would double the cost of finishing a match for nothing.

Two details worth keeping:

- **Tokens earn nothing.** The Bias Board is drawn from the collection, and a
  Follower token is not in it. AP banked against one would be real state, written
  to the save forever, that no screen can ever display — the invisible-reward
  problem again, only permanent. Premium variants fold into their base card so
  devotion never splits in two.
- **The per-match cap is applied at derivation**, not in the save layer, so the
  number reaching the accumulator is already the number §6.1 promises.

### The two weeklies, and why the rank is stamped on the match

*Understudy Arc* ("win 3 matches with a Leader below Leader Mastery level 5") and
*Second Bias* ("below Faction Mastery rank 10") read `masteryAtPlay` — the ranks
the match **started** at, recorded onto the outcome at play time exactly like
`deckEditedThisPeriod`.

It has to work that way. The rank climbs while you play, so scoring against
today's rank would make finished matches stop counting and a half-finished
mission walk backwards. And an outcome carrying **no** stamp never qualifies:
treating "unknown" as "below rank 10" would pay the mission out of evidence that
cannot answer the question, which is the exact reason it was held back.

### 87 tests, twenty deliberate breakages

All twenty mutations are caught. Three of them only after the tests were fixed,
and — as with missions — all three were the tests being weak:

1. **`seedPlayedAccount` had been silently broken for every browser script.** It
   wrote the collection to `localStorage` and reloaded; the starter grant's
   pending save flushed on `pagehide` during that reload and landed on top. The
   account that was supposed to own everything owned **20 cards** — the ones a
   starter deck happens to contain. Found by asking why the Bias Board listed ten
   characters. It now seeds through `profileStore` and flushes, and throws if it
   grants fewer than 100 cards. Third appearance of the 250ms debounce.
2. **The restricted-pool fallback was never executed.** A Faction Pack draws from
   one faction, and if that pool lacks the rolled rarity the pack would arrive
   short — so `openDrop` substitutes the nearest stocked rarity. Every shipped
   faction stocks all four, so the path was dead code. It is now driven by a
   deliberately impoverished pool (Commons only), where the Rare floor forces the
   substitution on nearly every pack.
3. **The seat-attribution mutation was a no-op — twice.** Affinity ownership is
   guarded in two places that overlap, and no shipped card can tell them apart,
   so removing *either* changed nothing observable. The honest mutation removes
   **both**. The test was also strengthened from "does the other side have this
   card too" (which only collides for cards that were *played*) to a faction
   check, which is exact.

> A fourth was flakiness of my own making: one test forged mission evidence and
> claimed it, and failed one run in five. Two causes, both fixture bugs. The
> three dailies an account holds come from a **clock-seeded RNG**, so evidence
> tuned to one of them depends on the minute the suite runs — it now covers every
> faction against every Current. And a freshly issued mission takes
> `issuedAt: now`, so evidence recorded *before* the sync sits outside its window
> and counts for nothing.

### `npm run verify:mastery`

```
2. What an unplayed account is owed
   ok: no track pays out before a single match — rank 1 costs one match, not zero
3. Playing a match
   ok: the faction track gained 40 XP
   ok: the faction and the leader were paid the same match XP, as §4 requires
   ok: 4 characters earned Affinity from one match
4. Claiming rank 1
   ok: claiming paid exactly what the screen printed
5. The rank that cannot pay
   ok: the deferred rank says what it is waiting for instead of offering a button
6. Picks and Faction Packs
   ok: a pick refuses to pay until a choice is made
   ok: the Faction Pack held 5 cards, all Neon Idols
PASS — Mastery
```

Step 2 exists because of a real bug this found in the design as written. Rank 1
costs no XP and §4.2 hangs 100 Clout on it, so taken literally a brand-new
account is owed **1,000 Clout across the ten tracks for having played nothing**.
A track with no XP now has no ranks: rank 1 is the reward for turning up with a
faction, and it costs one match.

### §4.1 and §4.2 contradict each other

§4.1's prose says ranks 1–10 hold *"all* card-value rewards" and 11–20 are
"cosmetic prestige for people in love" — and §14 restates that as a **binding**
constraint, "100% of the card value". §4.2's table, three paragraphs later, puts
Faction Packs at ranks 14 and 17, 150 Fragments at 15, and Clout at 11, 13, 16
and 19.

The table wins, on the same rule that settled §3.4 against §08's level bands: it
is the more specific of the two, and it is what a player reads on the track. What
§14 is *for* still holds and is what the tests assert instead — every **pick**
sits in the first ten ranks, and the front half stays far more reward-dense per
XP than the back half (1.85× on the shipped numbers).

---

## The cosmetics layer

Card backs, titles, profile frames, portrait badges and emotes — plus `#profile`,
the screen they are worn on, which is `03-screens-and-navigation.md` §4.5.4 and
which the lobby's player chip used to route to Settings for want of anything to
show.

Built because it was not really a new feature: it was the missing half of three
that already existed. Every one of these was already *promised* by a Mastery rank
and every one of those rows read **"Earned — waiting on the cosmetics layer"**.

### What changed on the reward tables

| Track | Rank | Before | Now |
|---|---|---|---|
| Faction | 5 | waiting | its faction's **card back** |
| Faction | 12, 15 | waiting | **emote I** and **emote set II** |
| Faction | 18 | waiting | its faction's **crest frame** |
| Faction | 20 | waiting | §13's **title**, by name |
| Leader | 3 | waiting | that leader's **emote** |
| Leader | 10 | waiting | **"Voice of ⟨Leader⟩"** |
| Bias Board | tier 3, 5 | waiting | **portrait badge**, **"⟨Character⟩'s #1 Fan"** |

`DEFERRED_COSMETICS` went from ten entries to five, and the staleness test is
what listed the five that had stopped being true.

### Art is derived; only the jokes are authored

`data/cosmetics.json` holds the ten §13 titles, an emblem name per faction, and
fifty emote phrases. **Nothing else.** A card back is the faction's colour plus a
procedurally drawn emblem, a frame is its crest ring, a badge is the character's
own art — the same bargain the card renderer already makes, which is why the
whole layer costs **zero art assets** and a new faction gets cosmetics the moment
it gets a colour.

Per-leader and per-character titles are **generated from the content index**, not
catalogued. §13 asks for one per leader and one per character; writing several
hundred by hand would be hundreds of lines saying the same thing, each one a
chance to name a card that does not exist.

### A `ref` is what separates a reward from a promise

The mastery reward tables are shared — one row serves all ten factions — so a
cosmetic reward carries `"ref": "cardBack:faction:{id}"` and `{id}` becomes the
track's own entity at grant time. `isGrantable` is then simply *does it have a
ref*, which is the same fact the granting code acts on, so what a row offers and
what it pays cannot disagree.

The coverage test walks that across every entity: each ref must resolve on **all
ten factions and all twenty leaders**, and land in the slot its reward names. A
ref that resolved for nine factions and not the tenth would be a reward that
silently became a deferral for exactly one faction's players.

### Owning and wearing are separate

You own everything you have earned and wear one per slot, so nothing is ever lost
by changing. Three details worth keeping:

- **The first of a kind equips itself.** The difference between a reward you
  receive and one you receive *and notice* — earn your first card back and the
  next match is played with it, without a trip to a picker you do not know
  exists. Later ones wait, because replacing something a player chose is worse.
- **Emotes are not worn.** Owning one adds it to the wheel. The six starters are
  never taken away: §12 makes the wheel the only communication channel, so gating
  it would gate communication, and a reward that *replaced* "well played" with
  something else would be strictly worse than no reward.
- **Ownership is the authority.** The equipped slot is only a preference — a slot
  naming something un-owned, or something a later build deleted, falls back to
  the default rather than rendering nothing.

### 38 tests, twenty deliberate breakages

All twenty caught. Four only after the tests were fixed, and all four were the
test being weak rather than the code being wrong:

1. **Distinct *emblems* were checked; distinct *assignments* were not.** Ten
   shapes existing does not stop two factions being given the same one — which
   makes the reward for mastering the tenth faction a card back you already had
   in a different colour. Now checked in the data as well as the renderer.
2. **A dropped `case` fell through to the house diamond** and no test compared an
   emblem against the fallback. It does now, which is the direct statement of
   "every emblem has its own case".
3. **The auto-equip test bypassed auto-equip.** It pushed the second cosmetic
   straight into `owned`, which never runs the granting path — so it passed
   against a build that replaced the worn cosmetic every time a new one arrived.
   Both are earned through the claim path now.
4. **The de-duplication test could not fail**, because no two shipped phrases are
   the same. It is driven by a duplicated unlock now — and the better fix went in
   alongside it: `checkCosmeticsData` refuses two emotes that say the same thing,
   so the safety net has something real behind it.

### `npm run verify:cosmetics`

```
2. Earning through Faction Mastery
   ok: five ranks paid 5 cosmetics: cardBack, emote, emote, frame, title:Center Stage
3. Wearing them
   ok: cardBack was put on automatically — cardBack:faction:neon-idols
   ok: the profile frame renders (7992 pixels painted)
   ok: the card-back preview draws its emblem (523 distinct colours)
4. The emote wheel
   ok: the wheel grew to 9
5. Changing a slot
   ok: a cosmetic the account has not earned is refused
6. In a match
   ok: the battle emote wheel shows all 9 unlocked phrases
   ok: the equipped card back is what the match renders with
PASS — Cosmetics
```

The pixel counts in step 3 are the point, not decoration: a cosmetic that
resolves, validates, is granted and is equipped, and then draws an empty
rectangle, is the inert reward with extra steps — and nothing else in the stack
would notice.

---

## Achievements

`08-progression.md` §9, `03-screens-and-navigation.md` §4.2.8. Twenty-six
one-time objectives across seven categories, an achievement-point score with
milestone frames, and `#achievements` — the trophy room, reachable from the
lobby and from the profile.

`npm test` · `npm run verify:achievements`

### Why this one is an accumulator

Missions are **recomputed from evidence**: the profile keeps a bounded log of
finished matches and any claim can be re-derived and audited. That is the better
design and it was not available here. The log holds 200 matches and is pruned to
the oldest held mission's window, and §9 asks for *"complete 500 matches"* and
*"activate all 9 Confluences (lifetime)"* — both reach back further than it goes.

So achievements keep a running tally, credited once per finished match, in the
same shape and for the same reason Faction Mastery does. The cost is the one
mastery already pays: there is nothing to recompute from, so the credit has to be
right the first time. `recordMatch` is the only caller of `creditMatch`, and a
test asserts the count moves by exactly one per recorded match, because
double-crediting an accumulator is permanent and invisible.

Two consequences, both deliberate:

- **Everything is tallied, not only what an achievement reads today.** Twenty-nine
  per-match statistics go into the tally and about a third are read. That looks
  like waste and is the opposite — a statistic not banked today can never be asked
  about retroactively, so an achievement added next month would start every
  existing account at zero. Fifty-eight small numbers in `localStorage` is a cheap
  price for not doing that to people.
- **Four requirement kinds, and nothing else.** `total` (a lifetime sum), `best`
  (the largest single match), `distinct` (different values seen), `account` (a
  fact about the account, not about matches). Anything unphrasable in those four
  is an achievement that cannot be verified.

Notably absent: a **filter** vocabulary. Missions need one because they are scored
over a window and rerolled. An achievement is a single lifetime number, and giving
it filters would be a second, subtly different copy of the mission objective
compiler. The one case that wanted a filter — *Content Slayer*, "defeat a Boss AI
encounter" — is a derived counter (`bossWins`) computed at credit time instead.

### Eleven new feats in the match reader

§9 asks about things `MatchStats` could not answer. They were added to the same
deriver rather than a second one, because they are answers to the same walk over
the same events — a separate reader would replay every match twice and would
eventually disagree about what "damage to the enemy leader" means.

| Feat | Reads | For |
|---|---|---|
| `fullFixations` | the `fullFixation` event | Down Catastrophically |
| `charactersBanished` | enemy characters leaving by banishment | Log Off Speedrun |
| `leaderDamageTaken` | damage targeting my own leader | Untouched, Unbothered |
| `fatigueTaken` | fatigue damage, which only an empty deck causes | Running on Vibes |
| `widestWinningBoard` | peak friendly board, 0 unless won | Sold-Out Show |
| `mostLeaderDamageInATurn` | a per-turn tally, closed at every turn boundary | Ratio'd Into Orbit |
| `reactionsTriggered` | my set Reactions firing | Well, Actually— |
| `elementalBonusDamage` | the amount, not the hit count | Type Chart Understander |
| `flawlessWin` / `burnoutWin` / `shutoutWin` | derived at match end | three §9.1 entries |
| `confluencesUsed` | the **ids**, not a count | Weather Machine |

That last one is the shape of the whole design: nine activations of the same
Confluence is not *Weather Machine*, and a counter cannot tell the difference.

`widestWinningBoard` needed the reader to learn something it never tracked — which
of my characters are **currently standing**. Arrivals were already handled for the
controller map; departures were not, so defeats, banishes, bounces and
transformations all now remove the instance. Without that the "peak" would be
every character ever summoned, which for a long match is several times what the
six-slot board can hold.

### The independent oracle

`mostLeaderDamageInATurn` is the only statistic with a per-turn reset, and a reset
is the kind of thing that is either exactly right or silently off by one turn. So
the test does not check it against a plausible range — it replays the same twelve
matches and computes the answer a second way, straight from the event stream, and
demands they agree. That catches both failure modes at once:

- a tally that never resets → the maximum quietly becomes the lifetime total;
- a tally that resets without banking the final turn → the killing blow, usually
  the biggest, disappears.

The test also asserts that at least one sampled match spread its leader damage
across turns, because a sample where every match dealt all its damage in one turn
would pass the comparison without ever exercising the reset. *A test that cannot
fail is not evidence.*

### Points, and the milestone that is not there

§9 puts profile frames at **250 / 500 / 1,000** achievement points. The
twenty-six shipped achievements are worth **635**, of which **625** are reachable
offline — *Front Row Seat* needs a server. So 250 and 500 ship; **1,000 is
deliberately not listed**, because a milestone nobody can reach is an invisible
reward.

That omission is not a comment, it is enforced: `checkAchievementsData` fails if
any listed milestone exceeds the reachable total, so the day the set grows past
1,000 the missing entry reports itself. The screen also prints the ceiling —
*"255 of 625 achievement points"* — because a player deciding whether a milestone
is close deserves to know how many points exist.

Points are counted from what is **unlocked**, not from what has been claimed.
Doing the thing earns the trophy; the Claim button only hands over the Clout.
Otherwise a player who earned twenty achievements and never opened the screen
would find the milestone frames locked behind a chore they did not know existed.

### `DEFERRED_FACTS` — the allowlist, a third time

Same bargain as `DEFERRED_COSMETICS`. *Front Row Seat* (§9.1 #19) reads
`matchesSpectated`, which nothing computes, so the row says
*"Not earnable yet — no spectating; it needs the server, along with friends,
guilds and the rest of §12"* rather than sitting in the Community tab looking
merely difficult. Two tests walk it in both directions: nothing may be
unearnable without a written reason, and no reason may outlive the thing it
excuses — the staleness half reads `accountFacts` and fails the moment the number
starts moving, so whoever wires spectating has to delete the line and make the
achievement earnable in the same commit.

It is kept rather than deleted for the same reason the mastery rows were: a
Community tab with one honestly-greyed entry is a truer picture of this build
than an empty tab.

### New cosmetics: the `*:award:*` scope

Achievement rewards needed cosmetics belonging to no faction, leader or
character. Everything else in `cosmetics.json` inherits a colour and an emblem
from the entity it came from; these have nobody to inherit from, so they carry
their own — five titles (§13's, verbatim: *Chronically Online*, *Certified Grass
Toucher*, *Stormfront*, *Multifandom Menace*, *Terminally Levelled*), three
frames and a badge, plus three new procedural emblems (`laurel`, `trophy`,
`hoard`).

An award declares its own `kind`, and resolution refuses when it disagrees with
the id — without that, `frame:award:stormfront` would resolve to a title and be
worn in the frame slot, drawing an empty ring. `checkCosmeticsData` also now
refuses a frame with no emblem (a bare ring is what a player with *no* frame
already sees) and a title or badge *with* one (nothing draws it) — the same field
in both directions, both times the data saying something the screen does not.

### What `verify:achievements` proves

```
1. What a new account has to show for itself
   ok: 26 achievements listed
   ok: the header says how many points exist: 625
   ok: no in-match feat is unlocked before a match has been played
   ok: the seeded collection unlocked what it should: curator
2. The hidden one, and the one waiting on a server
   ok: the Deep Cuts entry is concealed
   ok: and it draws as ??? with its hint
   ok: the Community tab prints the reason rather than a progress bar
3. Earning, and claiming
   ok: claiming paid the 100 Clout §9.1 promises
   ok: and the row will not pay twice
4. A reward you can wear
   ok: the title §13 names was granted and put on automatically
   ok: and the profile is wearing it
5. Points and milestones
   ok: ten feats are worth 255 achievement points
   ok: the 250-point milestone paid Trophy Shelf
   ok: and the frame it paid is being worn
6. Categories → seven tabs, as §9 lists
7. Finding it from the lobby → the button exists, and it goes there
PASS — Achievements
```

Step 1 is worth reading twice. The script's first draft asserted *"nothing is
unlocked"* and failed — because `seedPlayedAccount` hands the account every card,
which legitimately unlocks *Curator*. The fix was not to weaken the check but to
state the true thing: the collection achievements are unlocked and no in-match
feat is, which is also the end-to-end proof that account facts and match
statistics are read from different places.

---

## Twelve deck slots you could never see

`03-screens-and-navigation.md` §4.3.2, the rest of it.

`npm test` · `npm run verify:decks`

### The finding: the game had more than one deck and no way to reach it

`profile.decks` is an array. `saveDeck` appends to it. `setActiveDeck` picks one.
**Nothing in the interface has ever listed them.** Saving a second deck silently
made it active and made the first unreachable except by typing
`#deckbuilder?deck=1` into the address bar.

§4.3.2's very first key element is *"Deck slot list (12 save slots) with covers
and validity badges"*. It is `#decks` now: twelve slots, each with its cover, a
Legal / *N problems* badge, which one is active, what its Currents buy, its
record, and buttons to edit, delete or play with it. An illegal deck cannot
become the active one — the active deck is what every mode reaches for, and
handing that slot to a 24-card list would deal somebody a match they cannot
start from a screen that just told them the deck had problems.

The cap is twelve, from `balance.deck.slots`, enforced in `saveDeck` rather than
in the screen — `decks` is an array anything may append to, and a limit only the
deck builder knows about is a limit the next caller walks past.

### The bug the slot list exposed

`deleteDeck` spliced the array and clamped only the **upper** bound of
`activeDeckIndex`. Deleting slot 0 while slot 2 was active left the pointer at 2
— which now named what used to be slot 3. **Deleting one deck silently changed
which deck you were playing, to a different one.**

It was unreachable while nothing listed the slots, which is the whole point: a
missing screen was hiding a latent bug in the save layer, and building the screen
is what surfaced it. Four tests pin the three cases now — before, at, and after
the active index.

A second one came with the cap I had just added: `saveDeck` returns −1 when every
slot is full, and the builder did not check. On a full account, Save wrote
nothing and the screen still said *"✓ Saved and set as your active deck"*.

### The rest of §4.3.2

- **The Current split**, as a donut and — the part that matters — §4.3.2's own
  verdict line under it: *"Pure Halo — Perfect Resonance enabled after 7 Halo
  cards"*, *"Halo+Pulse — no Confluence for that pair, and no Perfect
  Resonance."* The picture says what the split is; the sentence says what it
  buys. Prism is counted as a splash rather than a third Current, because
  `validateDeck` already treats it that way and a verdict contradicting the rule
  two panels above it would be worse than no verdict. The Confluence is looked up
  by pair from the content index, not by pairing names, and Refraction is skipped
  because it has no pair.
- **A cover pick and a card-back pick.** `DeckList.coverCardId` and
  `DeckList.cardBackId` have been declared in `types.ts` since the beginning with
  **nothing in the codebase reading or writing either** — two fields that existed
  only as a type. The cover offers cards actually in the list and ignores a
  choice you have since cut; the card back offers what the account owns, and
  **the battle now prefers the deck's over the equipped cosmetic**, which is what
  makes the field real rather than stored.
- **A 16-character deck name**, per the spec, enforced against paste as well as
  typing.
- **The per-deck record**, from local match history via `buildDashboard`'s own
  `byDeck`. It is keyed by **name**, because that is what `recordMatch` stamps on
  a history entry — there is no deck id in this game. So renaming starts a record
  over and two decks sharing a name share a record, and the screen says
  *"too few to report a win rate"* below the dashboard's own `MIN_SAMPLE` rather
  than reporting 33% off three games.

Every "deck builder" link in the game now opens the slot list, and the builder's
back button returns to it.

### `npm run verify:decks`, now thirteen sections

The four new ones: the slot list renders twelve slots with covers, validity
badges and exactly one active marker; **switching the active deck works at all**,
which it could not before; the name truncates a 40-character paste to 16 and the
donut states its verdict; and — the one that matters — a card back picked in the
builder is confirmed to be *the back the board is dealing*, read out of
`cardMesh` mid-match.

The script also starts from `localStorage.clear()` now. It had been inheriting
its own previous run's decks, which answered "what does a new account see?"
with a leftover from ten minutes earlier.

---

## The deck builder, and a button that ignored your collection

`03-screens-and-navigation.md` §4.3.2 and `14-ai-design.md`. Known gap 8.

`npm test` · `npm run verify:decks`

### The finding

The deck builder's card pool refuses to let you add a card you do not own. It is
one `if`, in `addCard`. **The Auto-Build button called straight past it** into
`autoBuildDeck`, which builds from every printed card in the game.

So a brand-new account could open the deck builder — which itself *opened* on an
auto-built list — and be handed thirty cards it had never seen, in a deck the
pool beside it would have refused to let that same player assemble one card at a
time. The deck then validated as *"✓ Legal deck — ready to play"*, saved, became
the active deck, and was dealt in a real match for real rewards. `validateDeck`
has no ownership check and `createMatch` validates nothing.

`14-ai-design.md` had written down the rule all along: the builder's
auto-generate *"runs live from the player's collection (pool restricted to owned
cards), then reports which suggested cards the player is missing."*

### Where the rule does **not** go

Not into `validateDeck`. Six shipped systems legitimately hand out decks of
cards the account does not own — the Grand Tour's loaner, starter-deck
construction, Gauntlet drafts, Doomscroll run decks, story fixed decks, and every
AI opponent's deck. Enforcing ownership in the engine would break all six. It
belongs in the builder, which is the only place that knows whose collection it
is talking about.

### What ships

`src/game/decks/` is pure — decks in, answers out, collection passed rather than
read:

- **Compare versions.** Counts, not ids: *"you cut one of your two Foam
  Knights"*. Cuts and additions in one cost-ordered list, both sizes stated, an
  unsaved slot distinguished from "everything added". The button's own label is
  the unsaved-changes indicator — **`Compare (+1 −1)`** — so the question it is
  usually opened to answer is answered without opening it.
- **Suggestions, each carrying its own reason.** Five weighted terms — curve gap,
  what the faction's cards pay off, what the draft already is, the leader's
  Primary Current, and whether the deck is still pure — and the largest term is
  what the row says out loud: *"14 cards already in the deck share a tag with
  it"*, *"your curve is 4 short at 3 Hype"*. A recommendation nobody can argue
  with is one nobody can act on, so the weights live in `data/deck-tools.json`
  where anybody can open them.
- **What you cannot field, and what to put in instead.** For an imported deck
  code, or a deck saved before its cards were dismantled: the card, how many
  copies over you are, and the closest owned substitute — scored with a large
  same-cost bonus, because a replacement that changes the curve is not a
  replacement.
- **Worth crafting** — §14's *"reports which suggested cards the player is
  missing"*, kept short enough to act on.
- **Auto-Complete**, which fills from the collection, keeps what you already
  chose, and **stops honestly short**: *"Filled to 16 of 30 from cards you own."*
- **Build around this card**, on the corner of any pool card you own.
- **Test vs AI** (§4.3.2, also missing): deals the **draft** without saving it,
  so the deck you are experimenting on is not overwritten.

A new slot now opens **empty** rather than on an auto-built list.

### Two bugs of my own, caught by an adversarial pass

The design work for this block ran as a multi-agent workflow, and because its
scouts read the code *after* the first implementation landed, the plan came back
as a review of it. Two of its claims were real, and both were verified before
being believed:

1. **`autoCompleteDeck` built an illegal deck.** Suggestions gated on ownership
   and the copy limit alone, so filling a deck for **Skree Nine-Tabs** returned
   thirty owned, under-limit, individually legal cards that together held **six
   Prism against a splash limit of three**. The tests missed it because they
   filled a deck for one leader, and Neon Idols print one Prism card in total.
   Suggestions now ask `validateDeck` whether an addition makes anything worse —
   and `tooManyPrism` needed a clause of its own, because it is *one* problem
   however far over you are, so a count-based delta never grows.
2. **`buildAround` seeded a card you do not own.** `Math.max(1, playableCopies())`
   put an uncollected copy in the list when you owned none — which is exactly the
   bug this whole block exists to fix, reintroduced one corner over. It refuses
   now, and the pool only offers the control on a card you own.

The lesson is the one this project keeps relearning: **a suite that exercises one
representative of a set is testing the representative.** Auto-complete now runs
for all twenty leaders.

### Found on the way

The plan also unified a third copy of the curve-need arithmetic. `autoBuildDeck`
fills toward `TARGET_CURVE`, the Gauntlet's pick assist weights offers by it, and
the builder's suggestions rank by it — three implementations, each free to drift
the first time anybody tuned the curve. There is one now, in `src/engine/deck.ts`.

Still missing from §4.3.2, and now listed as such: the custom cover and card-back
pickers (`DeckList.cardBackId` and `coverCardId` are declared in `types.ts` and
**nothing in the codebase has ever read or written either**), and the per-deck
stats tab.

### `npm run verify:decks`

Eight checks against a deliberately sparse account — a real new player, eight
distinct cards owned. A fresh slot opens at 0 cards; Auto-Complete fills to 16
and every one of them is owned, and it says why it stopped; six suggestions
appear, each with a reason, none of them unowned; four craft targets, none of
them already owned; build-around produces a named deck; then, on a full
collection, the Compare label walks `Compare` → `Compare — saved` →
`Compare (+1 −1)` and the diff shows both directions; and Test vs AI deals the
30-card draft without touching a saved slot.

---

## Going online: the deployment, and the seam

The game is live at **<https://dylannfontus.github.io/HypeBound/>**. Pushing to
`main` builds it and publishes it; the workflow runs the full suite and the
typecheck first, because everything past that point is a public URL.

The stack is settled and it costs nothing:

| Concern | Where it runs | Why |
|---|---|---|
| Client bundle | GitHub Pages | Content is bundled at build time and routing is hash-based, so a static host needs no configuration |
| Authoritative rooms | Cloudflare Durable Objects | A DO *is* `03-multiplayer-architecture.md` §14.2's "one match = one room"; DO storage replaces the specced Redis journal |
| Matchmaking, results | Cloudflare Workers | Same runtime, and the engine is pure TS with no Node APIs |
| Accounts | Supabase Auth | Email+password, verification, reset, TOTP and OAuth already built. The Worker only *verifies* a JWT; it never issues one |

Two constraints were established rather than assumed. **GitHub Pages cannot hold
a socket, run code, or keep a secret**, so the client and the server are two
deployments and no design avoids that. And **the repository must be public** —
Pages from a private repo is a paid feature.

One thing that did not go in the repository: `hearthstone_frames/`, 458 MB of
frames pulled from a Hearthstone capture and referenced by no code. It is
reference material for card framing, it is Blizzard's art, and a public repo is
forever.

### Phase 1 — the transport seam

`docs/tech/03-multiplayer-architecture.md` §15 phase 1. The battle screen no
longer knows what a `LocalMatch` is; it talks to a `MatchTransport`
(`src/net/transport.ts`), and the offline game is one implementation of that
interface (`src/net/localTransport.ts`) rather than the only way to play.

The indirection is not the point. What it forces is: **a network client holds a
`PlayerView`, never a `MatchState`**, so every question the screen answered by
reading state had to be re-asked. Most were already answerable — the winner, the
active seat, the turn number, both boards and the surviving leader health are
all on the view. The UI was closer to view-shaped than it looked.

Three were not:

- **`legality()` moved onto the transport.** Same engine functions, same
  answers; only the route differs, and only the transport knows which route it
  is on. §6 already put `confluences()` there for that reason — this is the
  existing idea applied consistently, not a new one.
- **`submit()` returns a typed `SubmitResult`.** `RulesError` has carried a
  canonical `code` since it was written and the driver kept only `.message`.
  This recovers information that was being discarded.
- **`finishRecord()` is nullable.** A networked client cannot build a
  `MatchRecord`: `PlayerView` has no `MatchConfig`, so it knows neither the seed
  nor either decklist. Typed nullable now, while it is a compiler error rather
  than a crash.

Hotseat became an optional capability (`transport.hotseat?`) instead of an
options flag. It is the one mode that *cannot* have a network implementation —
its premise is one device changing hands — so absence is the honest way to say
so.

Nothing in `LocalTransport` is stubbed. `seq` really counts batches gap-free,
`clocks` are real remaining time from `balance.timer`, `viewHash` is real FNV-1a
over the seat's view, and `status` is permanently `live` because an in-process
match genuinely cannot be unstable.

**A `never` was hiding a real type.** `matchState(): never` let a `MatchState` be
passed anywhere without importing it, and the trick had spread into `HandBar`.
Naming the real type is what turned the remaining debt into something countable:
five engine helpers still take a `MatchState` to enumerate targets. None of them
reads hidden information — board and leaders are public — they simply have a
parameter type a client will not have.

### Phase 2 — redaction, and the leak the design missed

`redactEvents()` lives next to `redact()` in the engine (§5). State redaction
existed; events needed it for a blunter reason. Online, a batch is broadcast to
both players, so **anything left in it is something the opponent's client
receives** — and a client that has been sent a card identity has it, whatever
the UI chooses to draw.

Following §5's table exactly would still have leaked. A `mode: "hand"` Comeback
emits three events naming the same card:

| Event | §5.1 said | Actually |
|---|---|---|
| `cardAddedToHand` | `cardId → null` | ✓ listed |
| `comebackReturned` | — | **not in the table**, `cardId: string` |
| `keywordTriggered` | — | **not in the table**, `cardId: string` |

Blanking one of three hides nothing. Both extras are dropped for the non-owner
rather than blanked, because in each the identity *is* the payload and there is
no nullable field to empty. Nothing is lost — the redacted `cardAddedToHand`
still carries `source: "comeback"`, which is what the presenter animates from.

**`keywordTriggered` gained a `seat`.** It had none, so it could not be
attributed, so it could not be redacted at all. That is a defect independent of
Comeback: every other player-scoped event carries one.

The guarantee is a type, not a test. `tests/redaction.test.ts` classifies every
event in a `Record<EngineEvent["e"], …>`, so adding a variant stops the file
compiling until somebody classifies it — all 66 kinds, whether or not a test
provokes one. Verified by deleting an entry and watching `tsc` name it.

### Redacting offline paid for itself the same afternoon

`LocalTransport` emits redacted batches and a §5.2-sanitized view **even
offline**, so the UI is built against the information a networked client will
actually have. The seat's own `deck` becomes count-preserving placeholders,
because a modified client must not be able to read its own next draw.

It caught two verification scripts within minutes:

- **`verify-doomscroll`** asserted that a fight is dealt from the run deck
  rather than the collection — by reading deck ids from the view. It failed
  loudly with ten `"hidden"`s.
- **`verify-decks`** filtered deck+hand for tokens the same way, and **still
  passed**. Tokens arrive in hand rather than in the deck, so the undefined
  lookup never changed the total. It was right by luck and would have gone on
  being right by luck.

Both read the deck from the authoritative state now, which is what the
omniscient debug handle is for and why phase 1 deliberately kept it off
`MatchTransport`.

The sanitizer builds a new object rather than editing in place: `redact()`
returns `you` as a live reference into match state, so sanitizing in place would
not have hidden the deck from the client — it would have deleted the deck from
the game. There is a test for exactly that.

### Two tests that were worth nothing until they were measured

Both are the same mistake, found twice in one day, and neither showed up as a
red test.

The `legality()` oracle compares the transport's answer to the engine's, field
by field. Its first version compared **one opening position** and passed happily
with `canFixation` hardcoded to `false` — because on turn one it is false
anyway, so the lie and the truth agreed. It now drives a developing match and
asserts it saw each answer come out **both** ways.

The redaction sweep played five full matches and checked that no comeback leaked
— using two Neon Idols decks, which contain **no comeback cards at all**. Zero
comeback events across all five matches; every comeback assertion passed without
ever executing. It now uses the only two factions that have the keyword and
counts what it exercised, so it fails if it ever stops testing what it claims.

A comparison test that only ever observes one value is not testing a comparison.
The fix in both cases was a coverage assertion, not a better assertion.

### Where it stands

| Phase | State |
|---|---|
| 0 — repo and Pages deploy | **done**, live |
| 1 — the transport seam | **done** |
| 2 — network-shaping | `redactEvents()` and the sanitized view **done**; `viewReducer` and `protocol.ts` outstanding |
| 3 — the `server/` package | not started |
| 4 — `WsTransport` + casual queue | not started |
| 5 — cloud saves, results, ladder | not started |

The honest caveat about the first online milestone, recorded here because it is
a design consequence rather than a bug: **a public queue is mostly a waiting
room at low population**. Every band-widening rule in §9.3 is about finding
someone among many; none of them conjures a second player. §9's own answer —
`mm.aiOfferAfterSeconds`, "offer *Play the AI instead*, never a fake human" — is
therefore required from day one, not a polish item.

---

## The big pass

Three features and two prose files had been written without a single test run —
73 unrun tests, no typecheck and no build since before the Remix Queue. This is
what happened when it all ran.

`npm test` · `npx tsc --noEmit` · `npm run build` · every `verify:*`

### The result, first

| | |
|---|---|
| `tsc --noEmit` | **1 error**, fixed |
| `npm run build` | clean |
| `npm test` | **4 failures**, all fixed — **1,370 passing** |
| `verify:*` (28 scripts) | **5 failures** across three scripts, all fixed |
| `check-lore.mjs` | clean |

One typecheck error across roughly six new modules, three screens, four profile
blocks and two engine-adjacent changes. That is the argument for writing
carefully when the compiler is switched off, and it is not an argument for
switching it off.

### What the type error was

`LocalMatch.opponentKind` was still declared `"ai" | "idle"` while the *options*
type had gained `"human"`. Hotseat assigned into it and three comparisons went
unreachable — the compiler reported all four from one root cause.

### What the tests caught

**Two tests had pinned the old world.** `mastery.test.ts` asserted that exactly
`leaders × 3` lore pages were unwritten, with a comment explaining that it
existed "so the number is visible and shrinks rather than being forgotten." It
shrank to zero. The assertion is inverted rather than deleted, because the point
was to keep the count honest and "none outstanding" is the same statement.

A second test proved the placeholder path using **Lumi's chapter 4** — a page
that was unwritten on the day it was authored and is written now. It was testing
the content calendar rather than the fallback, so it now uses an id that does not
exist and cannot come true.

**Policy F4 caught an undisclosed economy change.** The three new balance keys
for the bonus dailies (`dailyPuzzleClout`, `dailyBonusDrops`, `dailyBonusEvery`)
drifted from the patch notes' economy snapshot, and `news.test.ts` refused it:
*"Policy F4 forbids changing published odds without a patch note."* The snapshot
was updated **and** the release notes gained entries describing the Event Hub,
the Remix Queue, the bonus dailies and the Custom Lobby — because F4 is a
disclosure rule, and a snapshot quietly brought into line would have satisfied
the test while defeating the policy.

### What the browser scripts caught

**Five failures, and not one of them was a game defect.** All five were the
verification scripts believing something about the app that had stopped being
true — which is its own kind of finding, since a script that fails for the wrong
reason teaches you to ignore it.

- **Three in `verify-achievements`** were the Vite dual-instance trap documented
  in the Event Hub section: `page.evaluate(() => import("/src/save/profile.ts"))`
  gets its own copy of the module, so reads through it never see what the running
  app wrote. The claim "paid 0 Clout" while the app's own balance had moved, and
  two worn-cosmetic slots read `null` while the check on the very next line — the
  one reading the DOM — passed. They read the persisted save now.
- **Two in `verify-gauntlet`**, same root cause and a second one on top: the
  payout check imported `claimGauntlet` and diffed `profileStore` itself, so the
  payout landed in one instance and the balance was read from another. The screen
  gained a `collect()` hook so the claim runs where the app's stores live. The
  other was the same-hash navigation trap `verify-decks` hit before — a `goto` to
  the hash you are already on does not remount, so the hub was still showing its
  pre-collect view.
- **Two in `verify-news`** were a stale assumption and a bad regex. The economy
  panel has two modes — a snapshot when nothing changed, a diff when something
  did — and the check assumed the one-release world where there is nothing to
  diff. It now asserts whichever contract is in force and that every printed row
  agrees with `balance.json`. The other compared header text to `"Before"` while
  the header renders `BEFORE` through `text-transform`, and `innerText` returns
  what is rendered.

**And one real bug, which the search box had been hiding.** The patch-notes page
shows one release at a time, so §4.2.3's search was scoped to whichever release
happened to be open: searching "Burnout" — a rule plainly in the notes — returned
nothing, because it lives in 0.1.0. That was invisible while there was one
release and became a bug the moment there were two. A search now follows the term
to the release that holds it.

### The two modes that had no browser check at all

Every other mode has one; the Remix Queue and the Custom Lobby did not, and they
were the two least-verified things in the build. `verify:remix` and
`verify:custom` exist now.

`verify:custom` immediately earned itself. Its central check is Hotseat's
handoff, whose failure mode is silent and serious — a frame of the wrong hand on
screen — and the first version of it **passed a broken cover**. The cover
computed to `rgba(3, 2, 8, 0.78)`: 78% opaque, with the outgoing player's hand
readable through it. `.handoff-overlay` was defined in `screens.css` and the
generic `.battle-overlay` in `battle.css`, which loads later and won at equal
specificity.

The check had only rejected *fully transparent*. A hand-hiding screen is either
opaque or it is decoration, and a check that cannot tell the two apart is the
same — so the rule moved to `battle.css` and the assertion now demands near-total
opacity.

Writing that check also corrected a wrong assumption of mine about the mode: the
handoff is not always reached by ending a turn. When the coin flip gives the
first turn to seat two, the device is owed the moment the mulligan clears.

---

## The Custom Lobby, and honest local multiplayer

`09-game-modes.md` §17. The last of the three offline-capable modes the status
doc wrongly reported as shipped.


### Every knob, and where each one goes

§17 asks for *"a lobby with explicit knobs, all clearly displayed to both seats
before start."* Each maps onto something the engine already read:

| §17 knob | Expressed as |
|---|---|
| starting health (20–40) | `balanceOverrides["leader.startingHealth"]` |
| starting hand sizes | `balanceOverrides["hand.first"]`, `["hand.second"]` |
| turn timer (30–120s, or off) | `balanceOverrides["timer.turnSeconds"]` |
| any Remix modifier (§12) | `remixMatchConfig`, unchanged |
| card / faction ban list | a filter on the pool a deck is checked against |
| deck-size override (20–40) | `balanceOverrides["deck.size"]` |
| AI seat fill (any difficulty) | the AI profile the battle already took |
| **Hotseat** pass-and-play | `opponent: "human"` on the local match driver |

"Off" for the timer is a very large number rather than a new concept. The HUD
counts down from whatever it is handed; a timer of one day is a timer nobody
will ever see, and it needs no special case anywhere.

A knob left at its standard value writes **nothing** into the config.
`balanceOverrides` is recorded into `MatchConfig` and rebuilt by `replay()`, so a
lobby that stamped all six every time would put six redundant numbers into every
replay of an otherwise ordinary match.

### Hotseat, which is three small changes and one important line

§17 calls it *"honest local multiplayer that ships before any server exists"*,
and it turned out to need very little:

1. a third opponent kind, `"human"`, which the driver does not take a turn for;
2. `playerSeat` becoming **mutable** — it is the *viewing* seat now;
3. `setViewingSeat`, refused outside Hotseat, because a mode that could silently
   show one player the other's hand is a cheat with a public method.

There is no second driver, no second state, no second view pipeline. `getView()`
already redacts against `playerSeat` on every call, so the second player gets the
same pipeline told to look the other way — **a hand that was hidden a moment ago
is hidden by exactly the code that has always hidden it.**

The important line is in `refresh()`. The handoff overlay is raised *before*
anything is drawn from the new state, so there is no frame in which the next
player's hand is on screen and no race between rendering and covering.

The overlay itself is deliberately dull and requires a deliberate press. The
failure mode of a pass-and-play screen is somebody tapping through it out of
momentum while the other player is still looking at the table, so it names who it
is waiting for, says nothing about the board, and does not time out.

### "Flagged combos" needed a definition, so it has one

§17: *"missions progress at casual rates only when no modifiers reduce match
integrity (flagged combos pay zero to prevent farming)."*

"Reduce match integrity" is decoration unless something defines it. The rule
here is one asymmetry: **easier than standard pays nothing; harder than standard
always pays.** Nobody farms a game they made harder, and a mode that punished
difficulty would be its own kind of wrong — which is why the tests pin both
directions rather than just the first.

Deliberately *not* flagged: a Remix modifier (both seats get it, and §12's
modifiers are balanced for constructed play), a ban list (bans cut both ways and
mostly make the game harder), and the AI difficulty — a Sparring win against a
beginner already pays the Sparring schedule everywhere else in the game, and
customs must not be stricter than the mode they are imitating.

Hotseat pays nothing regardless, per §17's reward line and the obvious fact that
both seats are one account.

The lobby prints the reasons **before** the match. A reward rule discovered
afterwards is one the player will reasonably feel cheated by, so
`integrityFlags` returns sentences and the screen shows them next to the Start
button.

"Pays nothing" is implemented as *not recording the match at all*, because a
zero-Clout history entry would still move mission progress and the achievement
tally.

---

## The sixty chapters

`08-progression.md` §5.2, and known gap 14. Prose, not code — the one block in
this document that ships no TypeScript at all.

### What was actually missing

Gap 14 read *"60 leader lore chapters are unwritten… plus the Bias Board pages"*,
and the recommended-next-steps section paired it with *"the per-card flavour text
the character gallery already has a place for and currently renders empty."*

Counting first, as usual — and then counting the right thing, on the second
attempt:

| | Before | After |
|---|---|---|
| Faction pages | 40 of 40 | unchanged |
| Leader chapters | 20 of 80 (chapter 1 only) | **80 of 80** |
| Per-card lore | 1 of 296 written — 295 were placeholders | **296 of 296** |
| Bias Board pages | 0 of 236 | **236 of 236** — all 118 characters |

**The per-card row is a correction of a correction, and the mistake is worth
keeping visible.** The first pass here checked that `data/cards/lore.txt` carried
a block for every card — it does, 296 of them, with no orphans in either
direction — and concluded the flavour text was complete. It is not.
**295 of those 296 blocks contain the literal string "Not written yet."**

Counting blocks is not counting prose. The check answered "does a block exist"
when the question was "does a block say anything", which is the same shallow-check
error this document catches elsewhere in code — a field that exists and is
inert. It is recorded here rather than silently fixed because the correction is
more useful than the tidy version.

The mastery lore has no such problem: 120 blocks, **zero** placeholders.

### The arc, which had to be inferred and is now written down

§5.2 fixes only the last chapter, calling it *"the origin file"*. Chapters 2 and
3 had no stated theme, so the arc is built backwards from chapter 4 and mirrors
the escalation the faction pages already use:

1. **The public fact** — the one thing everybody knows, stated as though
   ordinary. Already written for all twenty.
2. **The method** — how it actually works day to day; the internal logic that
   makes chapter 1 function rather than collapse.
3. **The cost** — what it takes, and from whom. Rarely from the leader: these
   are people whose arrangements are paid for by somebody standing slightly out
   of frame.
4. **The origin file** — where it started. It must recontextualise chapter 1
   without contradicting it, and it should be quiet, because the origin of a
   very loud person almost never is.

That is now in the file header along with the length target (100–160 words, one
turn on a reward screen) and the rule that a chapter never explains a card. The
next person to write one does not have to reverse-engineer the shape from twenty
examples.

### The thing the existing pages do that a checker cannot

Twenty of the forty faction pages and nine of the twenty chapter 1s contain the
word **eleven**. Nothing documents this; it is an authorial signature, and it
works because it is noticed on a second read and never on a first.

It is honoured sparingly in the new chapters rather than mechanically. Sixty
chapters each dutifully containing an eleven would convert a quiet joke into a
tic, so the header now says so explicitly: *a background hum, not a rule.*

### Checked, not assumed

Every leader id in the file was validated against the actual leader cards:

- **no lore id names a card that does not exist** — a typo would have produced a
  chapter no player could ever reach;
- **no selectable leader is missing a page** — all twenty have all four;
- **no duplicate ids** across 120 blocks.

The thirteen leader cards without lore are the ten faction bosses, the two
tutorial bots and The First Signal, none of which has a Mastery track. They are
correctly absent rather than missing.

### The Bias Board, started

§6.2 gives tier 2 an unusually exact brief — *"a short, in-character, gently
devastating note about parasocial distance. Comedy with a conscience"* — so the
two pages have different jobs, and the file header now says so:

- **:1 Noticed** — a character page, 60–90 words. It may be fond; it must not be
  about you.
- **:2 Parasocial** — 40–60 words, addressed to the player, in the character's
  voice. *Gently* is the load-bearing word. It is never a telling-off and the
  character is never contemptuous; the best ones are kind and land anyway. The
  rule underneath: **the character has noticed you back, and what they noticed is
  not what you wanted them to be.**

**All 236 written** — every one of the 118 characters has both pages, 118 at each
tier. Validated the same way the chapters were: no id names a card that does not
exist, no character is missing a page, and there are no duplicates across the
file's 356 blocks. A scan for placeholder or thin bodies across the whole file
returns **zero**.

### The card Story tabs, which this turned up and then closed

The per-card flavour was **not** written — 295 of 296 blocks said "Not written
yet." All 296 exist now.

The bulk of them were written by twelve parallel agents, one per faction file,
against the style brief above, then read by a thirteenth acting as editor. That
reviewer earned its place: it returned **27 specific faults**, and the useful
ones were not stylistic.

- **`cosplay-kiko-thousand-faces` contradicted its own card.** The printed
  flavour says "nine years of competition"; the block said eleven — a number
  chosen for the motif rather than the fiction.
- **`meme-chronic-poster` contradicted itself in the heading.** TITLE "The Quiet
  Fortnight" sat directly above "he went dark for nine days."
- **`cosplay-token-hall-champion` was about the wrong person.** The card is the
  champion photographed nine hundred times before lunch; the block was about a
  bystander marshalling the photo queue, so the card's own subject never
  appeared.
- **Three separate blocks used the same unsent-draft image**, and two used the
  same title for two directly linked cards.
- A dozen more restated the card's printed flavour in their first paragraph, or
  lifted the title verbatim from its last three words — which reads fine alone
  and reads as an echo on the card, where both are visible at once.

All of those are fixed. Four pull quotes that merely reworded the sentence above
them were cut rather than rewritten, because the format falls back to the card's
printed flavour when there is no quote, and that was the stronger line in each
case.

---

## The two bonus dailies, and two design documents that disagree

`09-game-modes.md` §11, "The Daily Grind" — the sentence after the one that was
already built.


### What was missing

§11's three daily slots, their deterministic per-date generation and the one free
daily reroll all shipped with the missions system. The sentence immediately after
them did not: *"Additionally: the **Daily Puzzle** (one Puzzle Rush scenario) and
the **Daily Doomscroll** (§9.9) count as bonus dailies."*

Neither is a mission, and neither can be scored like one — a mission's progress
is recomputed from the match-outcome log, and a scripted puzzle and a roguelike
run are not matches. Each is simply *the one the date picked, done once today*.

- **The Daily Puzzle** is seeded from `(day, account seed)`, per §11's *"per date
  + account seed"*. Two players get different puzzles on the same day, which is
  what stops the answer from being a thing you look up rather than solve.
- **The Daily Doomscroll** is seeded from the **date alone**. That asymmetry is
  deliberate: a shared daily run is the entire point of a daily run, and it is
  the only social thing an offline build can offer. Doomscroll runs were already
  reproducible from a seed by design, so this is a button that fills in a
  particular one.

Both derive rather than store, so a reload is not a reroll and there is no second
copy of the calendar to drift.

### Where §11 and §7 openly contradict each other

§11's reward line reads: *"7-day completion streak: 1 pack (streak forgiveness:
one missed day per week is auto-excused — no unhealthy-playtime pressure, per
canon principles)."*

`07-economy-and-monetization.md` §6 policy **F6** reads: *"No unhealthy-playtime
pressure. **No streak resets**, no lose-it-if-you-miss-it daily grants, no 'play
within X hours' mechanics… The game should reward returning, never punish
leaving. **Retention built on anxiety is a defect.**"*

These cannot both hold. Even a forgiving streak resets on the second missed day,
and §11 cites the same canon principles F6 states in order to justify a mechanic
F6 forbids by name.

**F6 wins**, because it declares itself binding policy and carries a validation
rule, while §11's line is a reward description. The resolution keeps the reward
and drops the mechanic: **every seven dailies completed pays the pack**,
cumulatively, never reset. Missing days delays it; nothing destroys it.

That also made the implementation smaller rather than larger. `dailiesCompleted`
was already a lifetime total in the save, so the whole feature needed exactly one
new number — how many packs have been handed over — and derives the rest:

```
earned = floor(completed / 7) × drops
owed   = earned − paid
```

There is no state that can go down, so there is no input that can express losing
progress. The test for it asserts that directly rather than asserting a streak
survives, because the point is that **there is no streak to survive**.

The reason lives in `DEFERRED_DAILIES` under *"The completion streak"*, so the
next person to read §11 and wonder where the streak went finds the answer next to
the code instead of rediscovering the contradiction.

### Paid on the way past, and back-filled

`settleDailyBonus` runs on the lobby beside `settleEvents`. Back-filling is the
point: an account that completed dailies before this shipped is owed the packs it
already earned, and counting only from today would have quietly kept them.

The bonus slots themselves pay in the same update that records them, so a reward
never waits for the player to open a screen — the same rule the Event Hub's
currency conversion follows.

Both slots refuse to pay twice. `completeDailyPuzzle` checks that the puzzle
finished is *today's* one, and `completeDailyDoomscroll` checks the run's seed
is today's shared seed — which is what makes it *the daily* rather than *a* run.
Replaying a puzzle you enjoyed stays free and pays nothing.

---

## The Remix Queue, and a mode that needed no new engine

`09-game-modes.md` §12, "This Week's Meta". The second of the three offline modes
the status doc wrongly reported as shipped.


### Nothing here is a new engine concept

§12's ship status is Hybrid: *"Remix vs AI (same modifier against AI)
offline-now; the PvP queue online-later."* The solo half is assembled entirely
from levers that already existed:

| §12 needs | What carries it | Already used by |
|---|---|---|
| a rule that changes numbers | `MatchConfig.balanceOverrides` | boss difficulty tiers |
| a rule that changes play | `cardOverrides[leader].passive` | Doomscroll artifacts |
| a cost rule | computed per-card `cardOverrides` | Doomscroll remasters |

`balanceOverrides`' own comment in `types.ts` has read *"balance overrides for
boss battles / **weekly modifiers**"* since long before this mode existed — the
engine was built expecting it. And `CardPatch.passive` is described there as
*"appended to a leader's passive list — how an artifact attaches to a player."* A
Doomscroll artifact attaches a passive to one player; **a Remix modifier attaches
the same shape to both.** That is the entire difference between a run reward and
a global rule.

The Weekly Boss reached this from the other side: *"a boss's rule twist is a
passive on its leader card, expressed in the ordinary effect DSL. Nothing here
special-cases a boss."* Nothing here special-cases a week.

So a modifier's `passive` is validated by the engine's own `zEffectDef`, imported
rather than restated. A modifier is a card rule; it must answer to the schema
every card rule answers to, or a modifier could ship an op no card could use.

### Six of ten, and four that say why not

§12.1 publishes a ten-modifier launch rotation. Six are expressible today:

- **Main Character Energy** — `onCardPlayed`, `oncePerTurn`, filtered to
  characters, `addKeyword: spotlight` + `buff +1/+1` on the triggering card.
- **Everything Is Content** — the same, unfiltered, `addKeyword: viral`.
- **Speedrun Any%** — pure balance: `timer.turnSeconds: 35`, `draw.perTurn: 2`.
- **Budget Cuts** — `hype.cap: 7` plus a cost ceiling of 7.
- **Echo Chamber** — `copyCardToHand` with `costDelta: 1` on the first Action
  each turn. The op already existed, `costDelta` and all.
- **Down Bad** — `obsession.fixationCost: 2` plus a `startOfTurn` passive
  granting 1 Obsession.

Four need engine work a data-driven modifier cannot add, and **all four stay in
the data file** with a written reason, because §12.1's table is content and
quietly dropping four rows would rewrite the spec:

- **Touch Some Grass** — needs a highest-*Attack* target selector (the DSL has
  `highestCost`/`lowestCost`) and a *timed* banish (banish is permanent).
- **Crossover Episode** — the engine records confluence use as a per-turn
  **boolean**, so "two per turn" is not a number `balanceOverrides` can bend.
- **Feed Refresh** — a new thing the player *does*, needing an intent, a control,
  an AI that knows when to press it and a replay path. Everything else here is a
  passive or a number.
- **Prism Party** — half of it is not a match rule at all: the Prism splash limit
  is enforced by `validateDeck` when a deck is **saved**, so a match-scoped
  override would not change which decks people bring.

`checkRemixData` enforces both halves of the honesty rule: **a deferred modifier
must carry no rules**, and **a playable one must carry some**. A deferral cannot
hide a half-built rule, and a rule cannot ship unannounced.

The screen prints the whole table — six playable, four with their reason — for
the same reason the inbox prints its deferred senders: a rotation that silently
skips four weeks is indistinguishable from one that is broken.

### The property this mode lives or dies by

**The rule applies to both players.** A passive patched onto one leader is a
house rule only one side is bound by, and it would look exactly like the correct
version until somebody read whose id it was. `remixMatchConfig` takes both seats'
leader ids and patches each; a mirror match patches the shared leader once, not
twice.

### Two clocks, and why the quest borrows the rotation's

`profile.ts` already imported a `weekIndex` — the **missions** one, which aligns
weeks to Monday. The Weekly Boss and the Remix rotation align to the epoch. They
are different weeks.

The Remix quest counts wins toward a rule, so it has to count them in the week
that rule was in force. It imports the rotation's clock under an alias, and the
alias carries the note explaining why. Had it silently used the one already in
scope, a win on a Monday could have counted toward a week whose rule was a
different one — and nothing would have looked wrong.

The counter also **resets by comparison rather than by a timer**: a stored week
that is not this week means the wins belong to a week that has passed. Nothing
runs at midnight, and an account left closed for a month comes back to a clean
quest rather than a stale one.

### The rule is stated before it can cost you anything

§12 asks for the modifier *"displayed on the queue tile and in the mulligan
screen"*. That is a small requirement carrying a large one: **a global rule
change the player discovers by losing to it is a bug.**

So `BattleScreenOptions` gained a general `ruleNote` — any mode with a house rule
can pass one — and it renders at the top of the mulligan, above the hand, before
a single decision is made. The queue tile states it too, along with the real
datetime the week turns over.

### What this unblocked

The Event Hub deferred *"Event-scoped rule modifiers"* on the grounds that the
mechanism did not exist and was the Remix Queue's job. It exists now, so that
deferral's reason has been corrected rather than deleted: the machinery is there,
and what is still missing is the smaller half — an event naming which rule it
wants, and its featured modes honouring it.

---

## The Event Hub, and three modes the status doc said were finished

`09-game-modes.md` §14, `03-screens-and-navigation.md` §4.4.3, and
`07-economy-and-monetization.md` §3 and §8.4.

`npm test` · `npm run verify:events`

### The finding, before the feature

This doc claimed, in the *Designed but NOT implemented* section, that *"with the
Gauntlet, every mode in the brief that does not need a server is playable."*

**That was wrong.** Mode select lists thirteen modes; §9 of the modes doc lists
twenty-one, and three of the missing ones are explicitly offline-capable:

| § | Mode | What the spec says about shipping it | Code before this |
|---|---|---|---|
| 9.12 | **Remix Queue** — "This Week's Meta" | Hybrid — *vs AI now*, PvP queue later. §3's Solo column marks it **NOW** | none |
| 9.14 | **Event Hub** | Online-later for live ops, but *"concluded PvE event content is archived into the offline Event Hub as replayable Rerun entries"* | none |
| 9.17 | ~~**Custom Lobby**~~ **built** | Hybrid — *vs AI and hotseat now*, online lobbies later | see *The Custom Lobby* |

Daily challenges were *mostly* covered — the missions system ships three
deterministic daily slots and a free daily reroll — and ~~§9.11's Daily Puzzle
and Daily Doomscroll bonus slots do not exist~~ **both now ship**, along with the
pack §9.11 attaches to seven completed dailies, paid cumulatively rather than as
a streak. See *The two bonus dailies*.

This section builds §9.14. ~~The other two are still open.~~ **§9.12 ships too**
— see *The Remix Queue*. **§9.17 Custom Lobby** is the one still open.

### An event is a data bundle, and the calendar is published

§14: *"each event is a data bundle (`data/events.json`): duration, modifiers,
featured mode(s), missions, currency id, shop stock."* Adding one is a JSON edit
and nothing else.

The load-bearing decision is that **every run window an event will ever have is
written from the start**, reruns included — the pattern `banners.json` already
uses, and for the same reason its own readme gives: *a rerun you can read the
date of is the difference between a schedule and a rumour.*

That turns two of §14's promises into properties of the file:

- *"every event returns within 2 seasons"* → `checkEventData` refuses an event
  whose consecutive run starts are more than `rerunWithinWeeks` (16) apart.
- *"nothing gameplay-relevant is permanently missable"* → it refuses an event
  with fewer than two runs at all, and refuses overlapping windows.

Three events ship, positioned so all three states are real rather than
hypothetical: **HYPECON** running, **Glitchoween** upcoming, **The Encore
Livestream** concluded with its rerun date on the archive card. Their currencies
— Con Badges, Pixel Pumpkins, Glowsticks — are three of the four §7 names by
example.

### Why event missions are credited and not recomputed

The missions system recomputes progress from `profile.missions.outcomes`, which
is the right design there and unusable here. That log is pruned to
`evidenceHorizon()` — the oldest held mission's `issuedAt`, about a week — and
capped at 200 entries. **An event runs a fortnight.** Recomputing from it would
silently drop the event's first week, and the player would watch progress they
had earned walk backwards.

So event progress is credited additively as each match finishes, in the same
place `achievements.tally` already credits, from the same evidence at the same
moment.

That is only correct for requirements that decompose over matches. `sum` and
`matches` do; **`distinct` does not** — a running total cannot know whether
today's faction was already counted. So `checkEventData` refuses a `distinct`
requirement in an event mission, and the limitation is enforced rather than
remembered in a comment.

What is *not* re-implemented: the `Objective` type and `matchesFilter` are the
missions system's, imported. `zObjective` had to be exported from
`missions/data.ts` to do it — the alternative was a second schema for one shape,
which is the "rule answered twice" bug the section above this one is entirely
about.

### The honest half of a live-ops screen

§14's ship status is *"Online-later (live scheduling requires the service)"*, so
most of this screen is about what it refuses to fake:

- **No countdown outlives its event.** Every deadline drawn is a real `runEnd` of
  a real window. An event that has ended says so and names the day it returns.
  `verify:events` asserts that *every date on the screen is one of that event's
  published run boundaries* — not that a timer exists, but that nothing was
  invented.
- **The leaderboard tab is refused, not drawn.** §4.4.3 asks for one; ranking one
  account against nobody is a mirror. It renders as unavailable with its reason
  from `DEFERRED_EVENTS`, the same way mode select handles the online modes.
- **The shop closes when the event does.** Not "unaffordable" — shut.

`DEFERRED_EVENTS` has five entries, each naming a blocker that is currently true:
live-ops scheduling, event leaderboards, distinct-value missions, event card
variants (a variant is art, and art is procedural here, so every variant would
draw identically to the card it varies), and event-scoped rule modifiers — which
are the Remix Queue's mechanism, and the Remix Queue is not built.

### Event currency never expires into nothing

07 §3, verbatim: *"when an event ends, leftover event currency auto-converts to
Clout at 1 : 5 (1 token → 5 Clout), logged in the inbox."*

`settleEvents()` runs on the lobby and on the hub, so the payout does not wait
for the player to notice it is owed, and each finished run settles exactly once.
The conversion is recorded on the event's state and **the inbox derives its
receipt from that record** rather than being handed a message to store — which is
how every other sender in that screen already works.

The paid-once test is worth a note. The first version asserted against the
emptied purse, and a deliberate break proved it worthless: the balance guard
answers "nothing owed" even with the paid-once guard deleted. The case that
matters is real — a mission finished during a run can still be claimed after it
ends — so the test now refills the purse on an already-settled run.

07 §8.4's other half, *"rerun events restore the player's previous event shop
progress and stock"*, needed no mechanism at all: state is keyed by event, never
by run. What was bought stays bought into the next run.

### The inbox deferral this made false

`DEFERRED_SENDERS` carried **"Event notices"**, deferred because *"live-ops events
are not built; there is no event to notice."* Building the hub made that reason
untrue, which is exactly what the allowlist discipline is for. It is replaced by
**"Live event announcements"**, deferred for what is *still* true: an event
nobody scheduled in advance cannot be announced, because scheduling needs the
service. The hub posts two derived notices per run — the opening, and the
leftover-currency receipt — and `MailRoute` gained `events` so both link to it.

### An unrelated bug the screen turned up

Writing the hub's click handlers meant checking which audio cues exist, and two
of them did not: **`sfx.ui.confirm` and `sfx.ui.reward` are played from thirteen
places across the screens and declared in `audio-manifest.json` nowhere.**

`AudioManager.play` resolves a slot to a path and returns silently when the slot
is unknown — so those thirteen call sites are not a missing file, a warning, or
an error. They are buttons that will never make a sound, and would still make
none on the day real audio is dropped into `public/assets/audio/`. The manifest's
own convention is that a declared slot with a `null` path is a silent no-op
*waiting* for a file, which is a different thing entirely.

Both slots are declared now, and `tests/cues.test.ts` walks every `.ts` under
`src/` and fails on any `audio.play` naming a slot the manifest does not have.

### What proves it

`tests/events.test.ts` — 28 tests, of which seven were confirmed by breaking the
code and watching them go red: credit that no longer stops between runs, progress
that is no longer capped, a mission claimable twice, a shop open while the event
is shut, a run that pays its leftovers twice, a rerun that restocks what was
already bought, and an event published with no rerun scheduled.

Every test passes its own `now`. A suite that only passes in August is a suite
that fails in September for a reason nobody will remember.

`npm run verify:events` — 21 checks in seven sections, including the one that
made the deck-slot list necessary: **the screen is reachable from the lobby**, or
it does not exist.

Two things that script had to learn the hard way, both now written down in it:
a `page.evaluate` that dynamically imports `/src/save/profile.ts` gets **its own
module instance** from Vite's dev server, so a write through it never reaches the
running app; and a `profileStore.update` sits on the store's 250 ms debounce, so
it needs `flushAllStores()` before a reload. The script spent a while reporting
"0 claimable" against a save that plainly held four finished missions.

---

## Nine defects, and the shape they shared

A twenty-agent adversarial review of the two sections above — the deck builder's
assistance (gap 8) and §4.3.2's slot list, covers and identity panel.

`npm test` · `npm run verify:decks`

### The rule the review found me breaking

Every one of the nine was **a rule answered twice**.

This project already had the principle written down — *legality is the engine's
answer, never a second opinion* — and I applied it carefully to `checkPlayable`,
`validateDeck`, `legalCardPool` and `legalAttackTargets` while quietly breaking
it four more times in the same module. The lesson is not "check legality with the
engine". It is that **any rule with an owner has exactly one answer**, and a
second implementation of it is a bug that has not surfaced yet.

| What was answered twice | Where the real owner lives |
| --- | --- |
| Is this deck pure? | `deckPureCurrent` |
| How many deck slots are there? | `balance.deck.slots`, honoured by `saveDeck` |
| Can this card go in? | `admissible` |
| Is this deck worth showing? | the panel's `minScoreToShow` — and *only* the panel |

### 1. "Perfect Resonance enabled" on a deck that could never have it

The worst of them, because it was a promise.

`validateDeck` lets a Halo deck splash three Prism. `deckPureCurrent` returns
null the moment it sees **any** Prism card, so `advanceResonance` can never fire
for that deck. Those are two different rules and I had conflated them — my own
comment said *"`validateDeck` already treats it that way"*, which was true about
legality and false about Resonance.

So a legal 27-Halo/3-Prism deck displayed **"Pure Halo — Perfect Resonance
enabled after 7 Halo cards"** on the slot list *and* the identity panel, for a
mechanic the engine would never grant it. The same false `pureCurrent` fed
`scoreCard`'s `resonance` term, so every suggestion for a splashed deck was also
weighted toward chasing a payoff that was already off.

`purityOf` asks the engine now. The only thing it adds is tolerance for a card id
this build no longer ships — a draft can legitimately hold one, and
`deckPureCurrent` throws on it.

The verdict had to be rewritten rather than merely corrected, because a splash is
not a penalty, it is an **exchange**: you lose Perfect Resonance, and you gain
**Refraction** (Prism plus any other Current played that turn). The line had been
reporting only the flattering half of a trade the player was making blind.

> Halo with 3 Prism — the splash trades Perfect Resonance for Refraction.

An all-Prism deck — legal for a Prism-native leader — gets its own sentence,
because it is the one case that buys neither: Refraction needs a second Current
to pair with.

### 2. The starter deck granted into a slot that does not exist

`saveDeck` has honoured the twelve-slot cap since the slot list shipped.
`grantStarterDeck` — the Grand Tour's reward for a loaner win, the one path that
writes a deck the player never asked for — pushed onto `decks` with no cap at
all, and `#decks` renders `slice(0, slots)`.

Twelve decks plus a tour win produced a thirteenth that was saved, counted
nowhere and unreachable from any screen in the game. Winning the remaining ten
factions produced twenty-two, of which ten were invisible.

The cards and the faction unlock are the real reward, so they still land; only
the ready-made list is skipped, and `StarterGrant.deckSaved` says so out loud
rather than leaving the player to notice a deck that never arrived.

### 3. A dead Compare button over an unsaved cover

§4.3.2's cover and card-back pickers write `coverCardId` and `cardBackId`, both
of which `saveDeck` persists. `diffDecks` compared cards, leader and name — so
picking a new cover left the button reading **"Compare — saved"** and the panel
saying *"Unchanged since you last saved"* over an edit that walking away would
discard.

The Compare button's label is the builder's only unsaved-changes indicator, which
made this the one place the mistake was guaranteed to be visible and silent at
the same time.

### 4. Advice you could not act on, and advice that stopped early

Two failures of the same kind, in opposite directions:

- **`craftTargets` recommended purchases that would change nothing.** It filtered
  on ownership alone — "you cannot add this, and owning more would fix that" —
  which is only half the test. A deck already at the three-Prism splash limit was
  told to craft a *fourth* Prism card. It also offered a shopping list for a
  complete, legal 30/30 deck, contradicting its own doc comment. It now asks
  `admissible` with a hypothetical collection: *if you owned it, could this deck
  actually hold it?*
- **`autoCompleteDeck` stopped short while the player still owned cards that
  fit.** It called `suggestCards`, inheriting `minScoreToShow` — a **display**
  rule about not cluttering a list of five — and let it decide a deck's size. The
  builder then advised the player to *"Craft or open Drops for the rest"* for
  cards already in their collection. `addable` is now the shared core and the
  floor belongs to the panel alone.

The test for this one is worth its own note. My first attempt used a full
collection and **passed against the broken code**, because with everything owned
every leader finishes on strong cards — the floor only bites when the cards left
to choose from are the weak ones, which is what a real account holds. The
replacement sweeps partial collections and asserts the honest invariant: if it
stopped short, then `addableCards` is empty.

### 5. An active deck the game would not let you choose

Deleting the active slot set `activeDeckIndex = 0` with no legality check — while
the slot list sitting right there *disables* "Play with this" for a deck that
does not validate. So the screen refused to let you choose an illegal deck and
then chose one for you.

Behind it was the larger version: `activeDeck() ?? autoBuildDeck(...)` was the
idiom at **every** route into a battle, and it guards the wrong failure. It
catches *no deck at all* and waves through an **illegal** one. `playableDeck`
states the ladder once — the active deck if it validates, else the first saved
deck that does, else a built one — and the four battle routes use it.

### 6. Two fields computed and never read

`DeckNeed.worstBucket` had a dedicated loop; `Suggestion.score` was returned by
every suggestion. Nothing read either — the same inert-field bug this project has
now found seven times, sitting in code written to fix it.

Both got readers rather than deletions, because both were answering a real
question the screen was not asking:

- The Hype Curve histogram draws what the curve *is*. `worstBucket` is the
  sentence saying where it is furthest from what it should be — *"Thinnest at 7+
  Hype — 1 short of the target curve"* — with that bar marked.
- Suggestion rows now draw `score` as a bar relative to the best row. Deliberately
  small, unlabelled and `aria-hidden`: the number has no units, and what a player
  can use is whether the top pick is far ahead or the field is level. The `why`
  line beside it already says everything a screen reader needs.

### What the tests are worth

Seven of the fixes were verified by breaking them again, one at a time, and
confirming the suite went red each time — including the two anchors that had to
be corrected before the harness could reach them. The eighth, the purity fix, was
proven the same way separately. A test that passes against the broken code is not
a test, and one of these had to be rewritten because it was exactly that.

The durable assertion for defect 1 is not "a splashed deck is impure" but **this
module's answer *is* the engine's answer**, swept across every leader, clean and
splashed. Testing one representative deck for one leader is what let the original
mistake through: Neon Idols have a single Prism card, and nobody splashed it.

`verify:decks` gained a thirteenth section for the three the browser can see: the
Compare button after a cover change, the curve's own diagnosis, and the strength
bars in list order.

---

## Playing the board without a pointer

`13-accessibility.md` §13 (the keyboard model) and §16 (the Board Mirror). Known
gap 35, which was the single most player-visible thing left on the list.

`npm test` · `npm run verify:keyboard`

The board is three.js. A canvas cannot take focus, cannot show a focus ring and
is completely opaque to a screen reader — so every menu in this game has been
keyboard-navigable for months while the one screen you actually play on was
pointer-only. §13 is explicit about the answer: *"keyboard interaction runs on an
explicit selection model owned by the HUD (never on the canvas). Selection state
is mirrored 1:1 in the Board Mirror, so keyboard and screen-reader users share
one model."*

One model, two consumers. That is the whole design, and it is why this is three
files rather than a pile of key listeners:

- **`boardModel.ts`** turns the redacted `PlayerView` into a list of places you
  can be, in §13.1's fixed order, each with the sentence a screen reader says
  when you land on it. Pure, so it cannot drift from the board: there is no
  second copy of the state to keep in step.
- **`keyboard.ts`** is §13.3's state machine as a **pure reducer** —
  `(state, key, context) → { state, action?, say? }`. Seven modes and named
  transitions, every one with a failure that only appears in an unlikely order:
  cancelling out of targeting into a selection that no longer exists, tabbing
  mid-placement, a card becoming unplayable while it is held. A reducer can be
  driven through those a thousand a second; a canvas can only be clicked at.
- **`mirror.ts`** renders §16.2's tree into a visually-hidden landmark and
  §16.3's announcements into two live regions.

### It does not get a second opinion about the rules

`Legality` — what is playable, what can attack, which Confluences are up — is
built by the battle screen from `checkPlayable`, `attackableBy`,
`canUseFixation` and `availableConfluences`, the same functions the pointer path
calls, and handed to the model. The keyboard cannot reach an illegal move
because it is never offered one, and a keyboard player and a mouse player are
demonstrably playing the same game.

The same instinct kept the flow small. Multi-target cards, choose-one branches
and the Confluence picker already exist as `openChooser` — **a list of real
buttons** that a browser already knows how to drive. Reimplementing them for the
keyboard would have been a second definition of what playing a card means. What
they needed instead was one line: focus the first option when the chooser opens.

### The finding: dismissing a dialog stranded the keyboard

`verify:keyboard` failed on its very first Tab. Removing the focused element
drops focus to `<body>`, and the board's key handler lives on the screen root —
so dismissing the mulligan, a target chooser or the settings panel left a
keyboard player with a board that silently stopped listening, with nothing on
screen to say why, until they happened to Tab back onto the right element.

It is the same shape as the inert accessibility settings and the invisible match
rewards: nothing was missing, nothing threw, every test passed, and the feature
simply did not work for the person who needed it. `dismissOverlay` returns focus
to the board now, and the mulligan opens with its Confirm button already focused
— it is the first thing a keyboard player meets in a match.

### The other finding: a deferral I had not checked

`DEFERRED_CUES` carried §11's rope cues (rows 3 and 4) with the reason *"there is
no turn timer in the offline build."* There is. `hud.startTimer` has run a
75-second clock with a 15-second rope, a ring and a countdown numeral since the
board shipped, and `balance.timer` has held both numbers just as long.

Known gap 40 said the same thing about the Gauntlet, and `DEFERRED_GAUNTLET`
listed a turn timer as unbuilt. All three were wrong, and all three were wrong
because I deferred something on a claim instead of a check — which is the exact
mistake a justified-allowlist exists to prevent rather than to commit. The rope
cues are built; the two entries are gone.

### What ships

§13.2's key map: `1`–`0` to select a hand card by position, arrows within a zone,
`Tab` between zones in §13.1's order, `Up`/`Down` across the three bands of the
board, `Enter` for context-confirm, `P`, `A`, `T`, `F`/`Shift+F`, `C`, `L`,
`I`/`Shift+I`, `H`, `X`, `Esc`, `` ` `` for the Mirror, `Space` to fast-forward
the animation queue, and `?` for the sheet — generated from the same table the
reducer binds, so a shortcut list that lies is impossible rather than unlikely.

Six §13.2 keys are not bound and each says why in `DEFERRED_KEYS`: the Reaction,
Event and pile inspectors are panels that do not exist, the emote keys need a
transport, and remapping needs a bindings store.

### `npm run verify:keyboard`

**The mouse is never used.** A tripwire in the page records any trusted pointer
event and the last check fails if one ever fired. Inside that: the mulligan is
dismissed with Tab and Enter; the Mirror is confirmed to be `role="region"`,
`aria-label="Board state"`, and neither `display: none` nor
`visibility: hidden` — the two things assistive technology skips; the cursor
moves and announces itself (*"Your hand, 2 of 5. Synchronized Debut, 3 Hype,
Halo, Action, Not playable."*); a character is selected, placed and played with
four keys; `?` opens an 18-row sheet and Enter closes it; `A` enters attack mode
(*"Target 1 of 2: Karaoke Gremlin, 1 attack 2 health, Cinder, Afterparty."*),
`T` cycles to the enemy leader, and Enter resolves the attack for real — 30 to
29. The Mirror's counts are then compared against the live view, and both live
regions are confirmed to have been used.

---

## The hardening pass, and a reward nobody could see

A sweep through the forty known gaps, closing the ones this build could. Nine
came off the list. Two of them had already been closed by later work and never
struck; the other seven were real, and three of the seven turned out to be
worse than the entry describing them.

`npm test` · `npm run verify:mobile` · `npm run verify:ui`

### The finding: every match reward was invisible

`recordMatch` returns a `MatchRewards` — Clout, XP, whether you levelled, the
first-win-of-the-day bonus. **All five callers discarded it.** The end-of-match
panel showed a title, a subtitle and "Turns played: 7", and nothing anywhere in
the game ever said what a match paid. The Clout arrived; you would have to have
been watching the lobby header to know.

That is the inert-reward bug with the sign flipped. An inert reward is a promise
that does not pay; this paid and told nobody, which is indistinguishable from
not paying and is the reason known gap 11 was written the way it was — *"the
result screen is where the player is told what they won"*. It was not.

So the result screen prints the payout now, itemised, and the settlement moved
with it. `onSettle` is called **the moment the result appears** rather than when
the player leaves it, which closes gap 11's other half: closing the tab on a
victory used to keep nothing. It also removes the trap `verify:tour` once fell
into, where the script read the winner, navigated away, reported the win and
found the faction still locked.

`verify:ui` now finishes a real match and asserts the number on the screen is
the number the wallet moved by.

### The landmine: a version bump was a whole-save wipe

`storage.ts` returned `defaults()` whenever a stored version did not match and
the store carried no `migrate`. The profile store was version 1 with no
migration. **The day anybody bumped `PROFILE_VERSION`, every account would have
lost its collection, its decks, its Mastery and its cosmetics** — silently, on
the next load, from a line of code nobody touched.

Nothing had ever migrated, so nothing had ever gone wrong, which is exactly the
shape of a landmine. Two changes:

1. **A version mismatch carries the payload forward** instead of discarding it.
   That is safe because of the two things around it: a store's `migrate` handles
   anything whose *meaning* changed, and the defaults fill anything new. A field
   a reader does not recognise is inert; a save that has been deleted is gone.
2. **Defaults fill at every depth.** They used to merge one level, which is why
   twelve fields of `PlayerProfile` carry the same warning comment and are read
   defensively everywhere. Reading defensively works; remembering to, on every
   future field, is the part that does not. Arrays are never merged, a saved
   `null` is never replaced, and map values are still taken whole — there is no
   template to fill a per-banner entry from.

Both were confirmed by breaking `storage.ts` on purpose: the old code turned
1,200 banked Clout into 0, and the tests said so.

### The cap that existed only in a document

`09-game-modes.md` §3 has always said Clout from AI play is *"capped at 200
Clout/day (`missions.aiDailyCap`)"*. **Nothing had ever read that number.** The
Gauntlet was the first thing in the build to consume a cap at all; per-match
Clout in every mode was uncapped, and had been since the first match.

It is enforced now, against one account-wide, day-keyed ledger that the Gauntlet
and every match share. Two decisions worth stating:

- **The cap is derived, not copied.** §3's 200 sits against its own schedule of
  20–30 Clout per win — eight wins at the top of it. This build pays more per
  match than §3 assumes (and pays for losing, so experimenting with a deck is
  never punished). Copying the 200 across would have shipped the same *number*
  and a different *rule*: a ceiling that bit after three matches instead of
  eight. `economy.missions.aiDailyCapWins` holds the eight; `aiDailyCap()`
  multiplies it by what a win is actually worth. Raise what a match pays and the
  ceiling rises with it, which is the point — a cap denominated in Clout would
  silently tighten every time the game got more generous.
- **A capped payout says so.** The result screen prints what was withheld and
  when it resets. Quietly paying less is precisely the subtraction §6's honesty
  rules exist to prevent.

The first-win-of-the-day bonus is deliberately outside the cap: §3.5 pays it
once a day by construction, so there is nothing to farm, and capping it would
mean the one bonus the design calls unmissable could be missed by having played
earlier.

Both figures moved out of a literal in `recordMatch` and into
`economy.missions.match`, which was the last corner of the economy the
data-driven mandate had not reached — and the one every other number in
`economy.*` is calibrated against.

### 26 audio cues, and not one audio file

Known gap 34 read: *"the cue points fire and carry their own gain, but every
audio slot in this build is empty, so there is no sound to play."* True, and the
wrong conclusion.

§11 never specifies audio *files*. It specifies a **cue character** for each of
its 34 rows: "two-note rising chime", "single low tone", "hollow descending
tone, pitch drops per stack", "glass tap", "short crumple". Those are
descriptions of waveforms, and a waveform is something an `AudioContext` makes
out of nothing at all.

So the cues are **synthesised** — oscillators and filtered noise, built at play
time from `data/audio-cues.json`. Twenty-six of the 34 rows ship; the other eight
need a turn timer or the network transport and are listed in `DEFERRED_CUES`
with the reason. There is nothing to download, no licence to honour, and no
empty slot pretending to be a sound. A real recording dropped in later replaces
the synth for whichever cue gains one.

Three rules are mechanical rather than remembered:

- **No two cues are the same sound.** Compared on the tone sequence, not by ear —
  the same guardrail §7.2's palette check applies to colour. A cue you cannot
  tell from another is worse than a missing one: you learn a signal and then get
  it for the wrong event.
- **Every cue has a visual twin**, which is §11's own binding rule, and the check
  fails on a cue that names none.
- **Rendering a cue really builds sources.** That is the assertion that matters,
  and it is why the test renders each cue against a recording stand-in and counts
  what came out. "Was the function called" would have passed on silence.

The noise bursts use a fixed sequence rather than `Math.random()` — not for
determinism, but so a cue sounds the same every time. A signal whose texture
wanders is one you have to re-learn.

Every cue is previewable on the accessibility screen, with §11's own description
of the sound printed beside it, so what the spec asked for and what the synth
produces can be compared by ear.

### The responsive claims, measured

Gap 7 said mobile was *"responsive but untested on a real device"*. Hardware is
still hardware and `verify:mobile` is not a substitute for it. What it does
replace is the half of that sentence nobody had checked at all: whether the
claims hold at a phone's actual dimensions.

Ten screens at four viewports — a 667×375 phone, a 915×412 phone, an 810px
tablet and a small laptop — asserting no sideways scroll, no text under 11px, a
portrait rotate prompt that appears on a phone and *not* on a tablet, and §13's
44px touch targets. Plus the battle board at the smallest supported size, because
a card game that lays out beautifully and cannot deal a hand on a phone has not
been checked.

It failed on the first run. **93 interactive controls were under 44px** — the
collection's ten Current filters and four ownership filters, its eight cost
chips, the interface-size steps on the accessibility screen, the mastery tabs,
and three deck-builder buttons sitting at 42. `.btn` had carried
`min-height: 44px` since the beginning, which is why "44px touch targets" was
recorded as implemented; every chip-shaped control had simply opted out of
`.btn`.

The floor is scoped to `(pointer: coarse)`, which is what the rule actually
means — a 44px chip exists so a fingertip can hit it, and forcing the same height
on a mouse makes every filter row a third taller for nobody. The laptop viewport
therefore reports its count and does not fail on it.

One failure was the script's own: it resized an existing page into portrait and
tested the resize listener rather than the case that matters, which is somebody
opening the game on a phone they are already holding upright. A fresh
portrait context passes.

### The tutorial finally pays what §2.3 promised

`grantTutorialReward` carried a paragraph explaining why the completion package
could not be paid: there were no screens for a pack, a card back or a title.
All three exist now — Merch Drops ship, and the cosmetics layer resolves both a
card back and a title onto a profile somebody can look at. The reason expired
and the reward had not.

Finishing the tutorial pays three Merch Drops, the **Day One** card back and the
title **Fresh Poster**, once ever, keyed as a permanent claim so the ledger's
400-entry trim cannot make it payable twice — the trap the Grand Tour's reward
fell into. Skipping pays exactly the same, because §6 makes "skipping is never
punished" binding.

§2.3's *"choice of two starter decks"* is still deferred: the account already
picks one at creation, and granting a second silently would hand somebody a
faction they did not choose.

### Release 0.2.0, and what a second release found

Changing `economy.missions` made **policy F4 fail immediately**: *"the economy
snapshot does not match the shipped balance … add a new release, or update
0.1.0's snapshot if it has not shipped yet."* That is the check working exactly
as designed, on its author, and it is the reason the patch notes now carry two
releases instead of one — which closes gap 28.

The second release found a real bug within a minute. §4.2.3's *"changed since you
last played"* band tested **set membership**: a version was unseen unless the
account had explicitly opened it. With one release that reading is
indistinguishable from the right one. With two, reading 0.2.0's notes left 0.1.0
flagged forever — a permanent unread badge for history the player had already
lived through. Releases are cumulative, so the band compares against the *newest*
version seen.

### Two gaps that were already closed

- **Gap 19 said Glimmer had one source.** The Stream Check-In pays 50 Glimmer at
  step 9 and has since it shipped, which is 600 a year on top of the pass's 400 a
  season. The entry predated it.
- **Gap 32 said §4.6.2's accessibility screen did not exist as its own route.**
  It is `#a11y`, off Settings and off the links row, with the live text-size
  preview and keyboard-navigation options the entry listed as missing.

Both are struck rather than quietly deleted, because a gap list that only ever
grows is a gap list nobody reads.

### What this pass did **not** close

Two of the closeable gaps are large enough to deserve their own block and were
left alone rather than rushed:

- **Keyboard play on the battle board, and §14's Board Mirror** (gap 35). §13
  specifies a zone model, a key map and an interaction state machine; §14's
  parallel DOM description of board state is what screen-reader support waits on.
  It is the single most player-visible thing left on the list.
- **Deck comparison and deck-building assistance** (gap 8), both in the brief.

Everything else on the list is either content (art, audio recordings, prose), a
server, or a decision that was made deliberately and is recorded as such.

---

## The Gauntlet, and a rarity table the card pool cannot keep

`09-game-modes.md` §8. At `#gauntlet`, off Mode Select.

`npm test` · `npm run verify:gauntlet`

The last mode in the brief that needs no server, and the first new *gameplay* in
seven blocks — everything since the story track had been meta. Draft a deck one
pick at a time, then ride it until 12 wins or 3 losses. It pulls from the whole
card pool regardless of what the account owns, which makes it the one mode a
brand-new player is on level ground in.

§8 marks the mode **Hybrid**: Gauntlet Practice offline-now, competitive
Gauntlet online-later. Practice is what ships.

### The finding: §8.1's rarity table is not satisfiable

§8.1 rolls a rarity per pick — Spotlight Picks at 1, 10, 20 and 30 are Rare 55%
/ Epic 35% / Legendary 10%, everything else Common 60% / Rare 30% / Epic 9% /
Legendary 1% — and then wants **three distinct cards of it**.

This build cannot do that:

| Rarity | Leaders that cannot fill a 3-card offer |
|---|---|
| Common | 0 of 20 |
| Rare | 0 of 20 |
| Epic | 1 of 20 |
| **Legendary** | **20 of 20** |

Most leaders have exactly one Legendary in their legal pool; three have none;
the richest has two. A Spotlight Pick rolls Legendary one time in ten and there
has never been a leader in this game that could answer it. One leader — Cyra
Swipe, with two legal Epics — cannot fill an Epic offer either.

Three ways to respond, and only one of them is honest. Printing forty new
Legendaries to satisfy a draft table is the tail wagging the dog. Silently
handing over Epics when the roll said Legendary is a mode lying about its own
odds, and `src/game/fairness/` exists precisely because published numbers and
rolled numbers have to be the same numbers. So:

1. **The roll happens exactly as §8.1 specifies.** A test measures it across
   4,000 seeds and asserts it matches the published table.
2. **A documented fill ladder** takes the remaining slots from the nearest
   rarity *below*, then above. A Legendary pick for a leader with one Legendary
   is that Legendary and two Epics — which reads as what it is.
3. **`offerReality()` measures the shortfall per leader**, and the screen prints
   it: on the hub as *"no leader in this build has 3 Legendary cards in its legal
   pool"*, and on the draft itself as *"Legendary pick — Lumi Starcall's pool has
   fewer than 3, so 2 cards come from the rarity below."*

A test asserts the shortfall is exactly 20/20 at Legendary and 1/20 at Epic. If
a later card pool fixes it, **that test fails** — which is correct, because the
ladder would then be dead code and the screen's wording would have become false.

### An offer is derived, never stored

A pick's three cards come from `subSeed(run seed, generation, pick number)` plus
the deck drafted so far. Nothing about an offer is written down, which is the
same rule the inbox and the news feed follow, and here it is load-bearing for a
reason those two did not have: **if a reload rerolled the offer, closing the tab
would be a reroll button.** The browser verification reloads mid-draft and
asserts the same three cards come back.

The deck is an input because two things read it — the curve assist, and the
Prism cutoff. So an offer is stable across a reload while still responding to
what has been drafted, and neither property was worth losing for the other.

### Three rules that had to come from somewhere else

- **The Prism cutoff is the constructed splash limit**, read from
  `balance.deck.prismSplashLimit` rather than copied into the mode's data —
  §8.1 calls it "the canonical splash limit", and two numbers that must agree
  are one number. It also carries the same carve-out `validateDeck` makes and
  `autoBuildDeck` had to be taught: a leader whose own Current *is* Prism was
  never splashing, so the cutoff never applies to them. That is now the third
  place that rule holds.
- **The curve the pick assist steers toward is `autoBuildDeck`'s**, exported
  from `src/engine/deck.ts` as `TARGET_CURVE` instead of restated in
  `gauntlet.json`. A draft aiming at a shape nothing else in the build believes
  in would be teaching a target that does not exist.
- **The Practice payout is derived from §8.3's competitive row**, not authored
  beside it. §8.4 says "25% of the table, packs excluded"; a second hand-written
  table would only ever disagree with the first for players who reached a row
  nobody re-checked.

### The opponent drafts too

`autoBuildDeck` would hand the AI the best thirty cards its faction has, and a
drafted deck against a constructed one is not the matchup — it is a different
game on the same board. So the AI runs the *same offer generator* with a greedy
curve-filling picker. That also means every fight is a 30-pick exercise of the
generator, which is a second, incidental proof that it works for every leader.

### The one rule the mode waives, and the test that keeps it to one

§8.1(4) drops the 2/1-copy constructed limits: you may draft duplicates if the
offers allow. So a drafted deck is deliberately something `validateDeck`
rejects, and "it validates" is the wrong assertion. The test asserts instead
that **the only complaint `validateDeck` ever makes about a drafted deck is
`tooManyCopies`** — one rule waived, and the faction, Current, Prism and size
rules all still holding. The browser verification repeats it on a real draft.

### Walking out of a losing board

Nothing stops an offline player from navigating away from a match they are
losing. The Doomscroll counts re-entries into its battle seed so a restart is at
least a *different* game; the Gauntlet does the opposite on purpose. Here a loss
is the resource being spent — three of them end the run — so a fresh roll would
be worth farming deliberately. The fight seed is keyed to (wins, losses) and
nothing else, so walking out and walking back in deals **the same opponent, the
same deck and the same opening**. `fightsEntered` keeps the count and the run
board says so in words when it exceeds the matches actually resolved. A server
settles this properly; this is the most an offline build can do about it.

### What is paid, and the cap that had never been built

Practice pays 25% of §8.3's Clout and Signal columns. Packs are excluded because
§8.4 excludes them. **Tickets are excluded because a Gauntlet Ticket buys one
competitive entry and competitive Gauntlet needs a server** — paying a currency
with no sink is the inert-reward bug in another costume, and banking it would
make the number on the table a promise nobody can spend. Both exclusions are
printed under the table with their reason, next to the competitive figure they
are withheld from.

§8.4 also says Practice rewards are "shared with the AI daily cap" — 09 §3's
`missions.aiDailyCap`, 200 Clout a day. **That cap did not exist anywhere.** It
is written down in the design and no code had ever read it, which made the
Gauntlet's new income uncapped by default. So there is now one account-wide
ledger (`profile.aiClout`), day-keyed, and the Gauntlet spends against it. A
capped run *says* it was capped and by how much, rather than quietly paying
less. Sparring and Quick Match still pay uncapped per-match Clout, as they
always have — capping those changes what every existing mode pays and is a
decision of its own, not a side effect of shipping a draft. It is recorded as a
known gap, and when somebody takes it, the ledger is already there.

### A number §8.3 never states

Rows 10 and 11 pay "Gauntlet card-back progress +1" and the spec never says what
the card back costs. Five is **authored**, not derived, and `gauntlet.json` says
so where the number is: four or five deep runs, past "won it by accident" and
short of a grind. Row 12 grants the back outright and skips the counter, which
is the table as written.

§8.3 asks for an *animated* card back at 12 wins. Nothing in this build animates
one — a card back is a procedural still drawn once to a canvas texture — so the
static Gauntlet back is what is paid and the animated upgrade is listed on the
screen as unbuilt. Paying a still image and calling it animated would be worse
than saying so.

Two cosmetics were added for it, and the award catalogue learned a fourth slot:
`cardBack:award:*`. Every other card back in the game inherits its colour and
emblem from something — a faction, a season, a banner, a check-in month — and a
*mode* has no crest to borrow, so this one carries its own, exactly as the
achievement frames do. Its emblem, `bracket`, is a draft bracket narrowing to
one seat; the existing cosmetics test walks every emblem and asserts each puts
different pixels on the canvas, so adding one is data plus a case.

### Found on the way: twenty screens with an unstyled header

Reviewing the Gauntlet's first screenshot showed its header stacked in the
top-left corner instead of sitting in a bar. That was not a Gauntlet bug.

**`.screen-header` is written by twenty screens and no stylesheet ever defined
it.** The whole system hub, the profile, the shop, missions, mastery,
achievements, the gallery, the banner, the pass, the inbox, news, patch notes,
the leaderboards, statistics and the Grand Tour all fell back to block layout: a
back button, a title and a currency chip stacked down the left edge with no bar,
no border and no centred title. The sibling class `.sub-header` — same markup,
different name — has had the rule all along.

It survived because nothing was *missing*. Every element rendered, every button
worked, every test passed; the pieces were simply in the wrong places, which
reads as an unfinished page rather than a broken rule. One selector fixed all
twenty, and `verify:fairness`, `verify:screens` and `verify:ui` were re-run to
confirm it. The before-and-after is visible in
`scripts/screenshots/fairness.png`.

### `npm run verify:gauntlet`

Eleven checks in a real browser. Mode Select lists it as playable and it opens;
the published rarity table on the page is read back off the DOM and compared to
the data (0/55/35/10 and 60/30/9/1); all 20 leaders are confirmed short at
Legendary and the page is confirmed to say so; the 12-win row prints both
figures (100 Practice / 400 competitive) with packs and Tickets struck out;
three leaders from three factions render as real cards; pick 1 is a Spotlight
Pick with three distinct card faces drawn; **a reload mid-draft returns the same
three cards**; thirty picks produce a 30-card deck whose only rule violation is
the copy limit; Delete and Repost empties the deck, produces a genuinely
different draft and is then refused; the drafted deck deals a real board against
an opponent proven to have drafted its own 30 cards; a 7-win run banks exactly
what its summary promised and then clears itself; and no panel clips its content
or scrolls the page sideways.

---

## Accessibility, and two switches attached to nothing

`03-screens-and-navigation.md` §4.6.2 and `13-accessibility.md`. At `#a11y`, off
Settings and off the links row.

`npm test` · `npm run verify:a11y`

### The finding

This game shipped **three colour-blind modes and a written-labels toggle that did
nothing at all.** `applySettings` dutifully wrote `data-colorblind` and
`data-labels` onto the document root, and not one line of CSS or canvas code
ever read either. A player who needed deuteranopia mode could select it, watch
the button highlight, and see the same eight indistinguishable hues.

That is the inert-reward bug in its worst form. An inert reward wastes a
reward; an inert accessibility setting fails the one person who went looking for
it, and tells them the game tried.

### The guardrail, which is the reason the palettes can be trusted

§7.2 asks for a mechanical check, and says why:

> *"A failing palette change fails CI. **This is why the palette can be tuned
> freely later: the guardrail is mechanical, not editorial.**"*

`src/game/a11y/` implements it: a Brettel–Viénot dichromacy simulation in linear
RGB, CIELAB ΔE\*ab, and a WCAG luminance ratio — about ninety lines of matrix
maths and **no new dependency**. Every pair of Currents in every mode must clear
ΔE ≥ 20 *or* a 1.6:1 luminance ratio, judged through the deficiency that mode is
for.

The three palettes were then **fitted numerically rather than by eye**. A first
pass optimised separation alone and produced something that cleared the bar by
3× and was no longer this game's palette — Halo at pure yellow, Root at pale
lime. The second pass is lexicographic: clear the bar with a 15% margin, then
minimise the distance back to the shipped colour. The result moves what has to
move and leaves the rest alone:

| Mode | Pairs the default confuses | Pairs left | Mean drift |
|---|---|---|---|
| Protanopia | 3 | 0 | ΔE 3 |
| Deuteranopia | 4 | 0 | ΔE 6 |
| Tritanopia | 2 | 0 | ΔE 2 |

**The default palette is deliberately not required to pass.** It fails under all
three simulations, and that is the reason §7 exists rather than a bug: forcing
the default to be dichromat-safe would design the whole game's colour language
around a constraint a switch already solves.

Those numbers are also what the screen *says*. Not "colour-blind palette", but
*"the default palette has 4 pairs of Currents you could not tell apart; this mode
leaves 0"* — a setting that states its own effect is one somebody can decide
about.

### One source for eight hues

The canvas cannot read CSS variables cheaply per frame, so `palette.ts` owns the
values and `applySettings` **writes them onto the root as custom properties**.
Two copies of eight hex codes across four modes would be thirty-two chances for
the card frames and the DOM to disagree about what colour Cinder is.
`verify:a11y` checks both ends: the CSS token moves, *and* the pixels of a
rendered card change.

§8.1's hatch fills ship as the fourth redundant channel behind shape, glyph and
label — eight patterns, forced on inside any colour-blind mode, and the only
signal that survives a photograph or a stream compressed to mush.

### The rest of it

- **Seven interface sizes**, 80%–160%, through `--ui-scale` — §3.1's rule that it
  is applied in exactly one place. The verification measures the root font size
  at every step and asserts the page body still does not scroll sideways at 160%.
- **Focus**, on `:focus-visible` with three ring widths. The check tabs to a
  control rather than calling `.focus()`, because `:focus-visible` deliberately
  does not match a programmatic focus — an earlier version of that check
  concluded the ring was broken while measuring something the rule is designed
  not to do.
- **The Rules Lens** prints every keyword's reminder on the card face at every
  rarity, and a test asserts every shipped card still fits its text box at the
  minimum font size — a reading aid that silently clips is worse than none.
- **Dyslexia-friendly text** as a wider-spaced system stack. A licensed face
  would have to be downloaded, and this build fetches nothing — which is a
  promise the privacy screen makes and this would have quietly broken.
- **An older save keeps its text size.** The four old named steps map onto the
  seven new ones, because somebody who chose "extra large" chose it for a reason
  and silently returning them to 100% is the worst outcome an accessibility
  change can have.

### Not built, and listed on the screen

Seven of §2's controls, each with its reason — screen-reader support (the board
is a canvas with no accessibility tree; §14's Board Mirror is unbuilt), keyboard
play on the board, controller support, mono audio and balance, subtitle styling,
and the audio cues themselves: **every audio slot in this build is empty**, so a
cue would be silence with a switch on it. The sound-captions setting carries the
same three events as text instead — which is the accommodation that works today.

---

## The system hub, and the screen F1 names

`03-screens-and-navigation.md` §4.6.3 to §4.6.6. At `#fairness`, `#privacy`,
`#legal` and `#support`, all four off Settings.

`npm test` · `npm run verify:fairness`

### F1 names a screen, and the screen did not exist

> *"Every random grant's exact odds are displayed adjacent to its purchase button
> **and on the Probability Disclosures screen**, to the same decimal precision
> used internally."*

The first half had shipped since the Merch Drop counter. The second half had
not, which meant a player could read the odds at the moment of purchase and
nowhere else — exactly the moment when reading them carefully is hardest.

`src/game/fairness/` contains **no numbers**. It contains the derivation of the
tables from `balance.economy`, which is the object the rollers read. And the
load-bearing test is not that the page prints 1.5%, it is that the page, the
shop panel and the banner panel print **the same thing as each other**:

> Three copies of a rate that agree by construction are one copy. Three that
> agree by inspection are a bug waiting for somebody to edit two of them.

`verify:fairness` reads the percentages back **off the rendered table** and
compares them to `balance.json`, rather than asking the module what it thinks —
which would only have proved the module is self-consistent.

§4.6.3's worked pity examples are computed rather than written, for the reason
the news feed's tokens exist: *"a Legendary by Drop 40"* is only true while the
pity counter is 40. The page prints whatever comes out of the shipped constants,
including the worst-case Clout figures, which are products rather than values.

And §4.6.3's *"rates last changed"* log is derived from the patch notes' economy
snapshots. It currently reads **never** — which is a claim this build can
actually support, because the newest snapshot is asserted against the live
balance on every test run.

### Privacy: the controls are real, or absent with a reason

- **Export my data** writes out every `hypebound:` key in local storage, and
  shows it on the page first. It is the strongest form the claim "we hold nothing
  else" can take: here is all of it, 14 KB of it.
- **Delete** is a typed confirmation — `DELETE`, not an OK button — because there
  is no cloud copy and no undo, and the page says so before it asks.
- **Analytics opt-out is not there.** There is no analytics SDK in the build, and
  a switch that turns off something that does not exist implies the something
  exists. The data table says so in the row where the toggle would sit.

The page claims nothing leaves the device, which is a promise about *behaviour*
and therefore the one thing a unit test cannot see. So `verify:fairness` watches
every request the browser makes across the whole session and asserts that all
383 of them went to the local dev server and nowhere else.

### Legal: two of the four documents are missing, on purpose

§4.6.5 asks for Terms of Service and an EULA. Neither has been drafted, so
neither is shown — a document carries a `status`, and a `not-written` one renders
as an explanation of what is missing.

**Placeholder legalese is the one category of fake content that can actually harm
somebody**: it reads as binding, and nobody wrote it. This is the leaderboards
screen's rule — *no fake ladder* — applied where the stakes are highest.

What *is* there is real. §4.6.5 asks for licences *"generated from the dependency
manifest"*, so `checkPoliciesData` joins the attribution list to `package.json`
in both directions: a package added without a credit fails `npm test`, and a
credit naming nothing fails too. The page separates the two runtime dependencies
from the five that only build and test the game.

### Support: a diagnostic that identifies the build and not the player

§4.6.6 asks for a bug report carrying *"version, device, validated-data hash,
last match seed; PII-free, **shown to the player before sending**"*. All four are
there, the whole file is rendered on the page above the export button, and a test
asserts the JSON contains no display name, no collection, no decks and no
currency.

The data hash is an FNV-1a over every card's id, cost, rarity and text plus the
economy block. It exists because *"it does not reproduce"* is usually *"we are
not playing the same game"*.

### Found on the way

**Every panel on these pages was collapsing.** They are a scrolling flex column,
where a child's default is to *shrink* when its content is taller than the box —
so each table rendered as a sliver with its contents clipped inside. The
screenshot caught it; the verification now asserts no panel's `scrollHeight`
exceeds its `clientHeight`, because **present is not the same as legible**.

---

## News, and the patch notes that cannot drift

`03-screens-and-navigation.md` §4.2.2 and §4.2.3, and the **enforcement column**
of `07-economy-and-monetization.md` §6 policies **F1** and **F4**. At `#news` and
`#patchnotes`.

`npm test` · `npm run verify:news`

### A number in an article is a token, never text

`{banner.legendaryRate}` resolves from the same balance data the roller uses. A
number typed into prose is a number that stops being true the day somebody
re-balances, and **an article is the one place nobody would ever check** — which
is exactly the failure F1 exists to prevent.

`checkNewsData` fails on a token it cannot resolve and on any brace left in the
text after resolution, so the choice is between a correct number and a build that
does not pass. It is the same rule the pass calibration follows — *re-derived,
never a quoted constant* — applied to sentences instead of to tests.

The vocabulary is flat and closed (about forty keys: rates, prices, tier counts,
card totals). A general expression language would let an article compute
something the game does not actually do, which is the failure this closes.

An article that is *about* one dated thing binds to it by id, so `{subject.ends}`
in the season-one article means season one forever. One that silently re-pointed
at the next season would be the worst kind of wrong: still grammatical, still
plausible, and about something else.

### Two rules that make a patch note unable to lie

§4.2.3 asks for card changes *"rendered on real card frames"*. F4 goes further
and says what has to make it true: *"odds are versioned data; the client displays
the data version; automated diff of `economy.*` between releases is posted to
patch notes."*

> **A card entry stores only the `before`.** The after is read off the shipped
> card — or off the next release that touched the same card, which is the same
> thing one step earlier. There is no second copy of the new value, so there is
> nothing for the note and the card to disagree about.

> **Every release carries the economy it shipped with, and the newest snapshot
> must equal the live one.** Edit a published rate without adding a release and
> `npm test` fails, naming the key and both values.

That second one is the reason this feature was worth building now rather than
later. F4 was a promise in a design document; it is a failing test today.

### One release, and what that honestly looks like

There has been one build, so there is one release: **0.1.0, First Upload**. Its
card-changes section is empty, and says why — *"when a card is re-balanced this
shows both sides on real frames; the note records only the old values, and the
new ones are read off the card itself, so the two cannot disagree."*

What fills the page instead is real: five rules, eight systems, six fixes that
genuinely happened, and the **full economy snapshot** — 45 shipped values, which
is F1's "the client displays the data version" taken literally.

Two things follow from having no card changes yet, and both are handled rather
than hidden. §4.2.3's faction/Current filter is **not rendered**, with a line
saying it appears when there is something to filter — a filter that always finds
nothing is indistinguishable from a broken one. And the before/after frame
renderer would have shipped untested, so `verify:news` drives it through an
**automation-only hook** with a card that has not actually changed: real cards,
real canvases, and nothing written into the player-facing record that never
happened.

### Found on the way

**Every authored date was rendering a day early.** Season starts, banner runs and
release dates are authored as UTC midnight and were being formatted in local
time, so `2026-07-27T00:00Z` read as *26 July* for everyone west of Greenwich — a
banner advertising a run that ends the day before the data says it does. These
are calendar dates in a data file rather than moments in a player's day, so they
format in UTC now, across the pass, banner, inbox, news and patch-notes screens.
A pull's timestamp and a match's date stay local, because those *are* moments in
somebody's day.

**A case-insensitive `NaN` matches "Reso-nan-ce".** The inbox's own data check
rejected a perfectly good sentence about Perfect Resonance. Both guards are
word-bounded and case-sensitive now, because they are looking for what
`String(NaN)` and `String(undefined)` actually produce.

**The lobby's "What's New" panel was a fixed paragraph.** It reads the feed now
and opens the article it is showing — the third hard-coded lobby panel this month
to turn out to be a screen asserting something it could not know.

### The inbox gained a sender, and only one

§4.2.2 lists the inbox among the feed's entry points, so an article can arrive as
mail. It does — but **only for articles with no subject**. One fact, one message:
an article about a banner run is already covered by the banner sender, which
links to the banner rather than to an article about it. Two messages carrying the
same headline is how an inbox becomes something people stop opening, and
`verify:news` asserts no two messages share a subject.

---

## The Inbox

`03-screens-and-navigation.md` §4.5.3, with §4.2.4's claim rule and
`07-economy-and-monetization.md` §6 policy **F6**. At `#inbox`, off the lobby.

`npm test` · `npm run verify:inbox`

### Mail is derived, never stored

Nothing writes a message. Every message is **generated from a fact the save
already holds** — the seasons table, a banner's published run calendar, the
Archive Passes on the account, the moment the Welcome Back package was posted —
and the save keeps only what the *player* did to it: read, claimed, deleted.

That is the choice missions made (progress recomputed from an evidence log rather
than incremented into counters), for the same reason. **A stored message can
outlive the thing it describes, and an inbox is exactly the screen where that
goes unnoticed** — mail nobody re-reads, quietly asserting a season ended on a
date it did not. Derived mail cannot say anything the data does not still say,
and a message whose fact is corrected corrects itself.

It also means the ledgers cannot grow without bound: `read` and `deleted` are
pruned on every write to the ids mail still generates, which bounds them by the
number of live messages rather than by an arbitrary limit. `claimed` is never
pruned, for the reason `mastery.claimed` is not — an id that aged out would make
an attachment claimable a second time.

### The rule that made retention honest

§4.5.3 wants mail gone after 30 days. §6 policy **F6** forbids
"lose-it-if-you-miss-it" grants. Both are binding, so:

> **Expiry removes the message, never the grant.** A message holding an unclaimed
> attachment does not expire, and is the one thing in here that outlives its
> window.

The same rule falls out at both ends of the screen: `Delete` refuses a message
that still owes you something, and `Clear read` steps over it. A delete button
that can throw away 300 Clout on a mis-tap is F6 with an extra step.

### The bug this feature was really for

The Welcome Back package (§10.5.4) used to be paid inside `syncHypeWave`, which
runs on a lobby mount. 300 Clout appeared in the wallet with **nothing anywhere
saying where it came from.**

That is the inert-reward bug seen from the other side — not a reward that does
nothing, but one that says nothing — and §4.2.4 forbids it outright: *"No reward
is auto-consumed invisibly."* It is an inbox attachment now. Coming back stamps
`welcomeBackAt`, which is what *posts* the message; the Clout moves when the
player takes it.

The forced Rebound week stayed immediate, because it is a rate rather than a
grant: there is nothing to hand over, and a claim button for it would be a button
that changes nothing.

### What can actually write to you

| Sender | Fires on |
|---|---|
| Welcome | the account existing |
| Hype Wave | a season opening; a season ending **with an Archive Pass to report** |
| Headliner | a banner run opening, and closing — the latter naming the published return date |
| Stream Check-In | the calendar month, naming the card back that month's step 10 pays |
| Welcome Back | §10.5.4's absence, carrying the Clout as an attachment |

The season-ended message is generated **only** when there is an archive for it.
Its whole content is "here is what happened to your pass", and a season that ended
while the account held nothing has nothing to report — so every one of them is
true by construction rather than by careful hedging.

### The quiet is explained, because a quiet inbox and a broken one look identical

Six senders §4.5.3 describes cannot exist here, and the screen prints them with
the reason each one is silent rather than leaving a player wondering whether
their mail is going missing. Five need a server. The sixth is
**version-migration grants**: the profile store has one version and no migration
chain, so nothing has ever migrated, and a compensation grant with nothing to
compensate is theatre. `tests/inbox.test.ts` asserts `PROFILE_VERSION === 1`, so
the day the schema moves the test fails and says to go and build that sender.

### Found on the way

Two things, both of them screens saying something untrue:

**The lobby's Daily Missions rail was three hard-coded rows.** "Play 3 matches /
Win with 2 different Currents / Activate a Confluence", for every account,
forever — the shape of progress with none of the substance. It reads the account's
actual dailies now, and `verify:inbox` checks every row against the mission data.

**A message can be drawn and still be unreachable.** The list's height is set by
whichever message is open, so six messages rendered happily *outside* the panel,
under the one below. The row count was right and the sixth was gone. The
verification scrolls to the last row and asserts its box is inside the list's.

---

## Headliner Banners, and the Stream Check-In

`07-economy-and-monetization.md` §3.2, §4 and §5; `08-progression.md` §11. A
three-week featured banner at `#banner`, and a ten-step monthly login track on
the missions screen.

`npm test` · `npm run verify:banner`

### A banner never gates, and the code says so

§3.2 is unusually blunt: *"every card that appears on a banner simultaneously
enters the general Drop pool and the crafting catalog on its release day.
Banners concentrate odds and add pity/targeting; they never gate."*

So `data/banners.json` authors only what a banner **features** — one Legendary,
two Epics, four spotlighted Rares. Its *pool* is the whole collectible set,
derived from the content index. Listing a pool would have been listing the entire
card file, and every card added afterwards would have silently missed it. A test
asserts the pool and the collection are the same size.

The rerun calendar is data, not prose: §4 promises at least two reruns within
twelve months of a debut, so every run window is authored from the start and
`checkBannerData` refuses a banner with fewer than three, refuses overlapping
runs, and refuses a second rerun more than twelve months out. **A rerun you can
read the date of is the difference between a schedule and a rumour.**

### Four guarantees, resolved in §5's order

| | |
|---|---|
| **Encore Meter** | the Target Card outright on the 50th pull since it last reset |
| **Epic-or-better window** | within every 10 pulls, rolling, shared by ×1 and ×10 |
| **Wishlist** | up to 10 cards, taken first *within* their rolled rarity |
| **Duplicate protection** | §5's algorithm: unowned before owned, conversion only once a rarity is complete |

Hard pity outranks the ten-window because a pull that owes the Target Card should
not have that debt paid off by an ordinary Epic. And §4.3's *"obtaining the Target
Card by any means resets the meter"* is taken literally — a lucky roll resets it,
and so does buying it with tokens, because a meter still counting toward a card
you already own is counting toward nothing.

The **Target Card can be any card in the pool**, and changing it keeps the
meter's count. Resetting the count on a change would make choosing a Target a
trap rather than a decision.

### The ×10, and what "no odds advantage" can honestly be tested to mean

§6's F2 says the ×10 costs exactly ten pulls and carries no odds advantage. The
obvious test — ten singles from a seed produce the ×10's cards — **is wrong, and
finding out why was the useful part.**

`nextInt` uses rejection sampling, so the number of PRNG draws depends on how
many candidates a tier holds; and §5 step 7 excludes a card already granted
inside the same transaction, which a ×10 does and ten singles do not. The streams
legitimately diverge.

What must be true is that the *distribution* is the same, so the test measures
it: three thousand pulls each way from the same seed, agreeing to within half a
percentage point in every rarity. A second test asserts the effective rates never
fall *below* the printed table — pity can only push them up, and a player who
reads "2.0% Legendary" and receives less would have been misled.

> Measured: Common 56.7%, Rare 27.0%, Epic 12.7%, Legendary 3.5%, against a
> printed base of 60/30/8/2. The excess is the two guarantees firing, which is
> what pity *is*; §4.2 prints the base roll and the guarantees separately, which
> is the honest way round.

### Backstage Tokens make the promise double

Every pull grants a token; tokens never expire; the shop sells any card at
2/5/15/50. So fifty pulls both fill the Encore Meter *and* bank enough for a
second Legendary of choice. §4.4 calls that deliberate — "cards are not the
profit center" — and a test asserts it against the shipped numbers rather than
trusting the arithmetic to stay true.

### The page's job is disclosure

`verify:banner` checks the page *says* things, because a gacha that rolled
correctly and told you nothing would pass every unit test in this repository:
the exact per-rarity rates, the featured share, the 150% conversion rate with a
worked example, the ×10 carrying no edge, the Encore Meter labelled
*"11 / 50 pulls until your Target Card is guaranteed"* rather than colour-only,
the rerun calendar, and an opening history that exports as JSON.

Absent, and stated: §4.1's full-bleed animated key art. There is no art pipeline,
so the hero is the featured Legendary's own procedural card — which is at least
the card being sold.

### Stream Check-In: the feature most likely to grow a streak by accident

§11 is ten steps a month, one per calendar day you open the game, and the rule
that matters is the absence: **no streaks, no resets, no consecutive-day
requirement.** Log in on six scattered days and you claim six steps. The test
does exactly that — days 0, 3, 4, 9, 17, 25 — because any "consecutive"
bookkeeping would fail it.

Step 4's two reroll tokens are real, not decorative. Missions allow one free
reroll per period; a token buys another, and the free one is spent first so
nobody is charged for something they already had. `reroll()` grew a `force`
option, and a forced reroll deliberately does **not** consume the free one.

Step 10 is the month's card back, and which one depends on the calendar rather
than on how often you played — twelve authored, one per month. Year two repeats
until more are written, which `checkCosmeticsData` reports rather than hides:
a content problem, not a code one.

---

## The Hype Wave — the seasonal battle pass

`08-progression.md` §10, `03-screens-and-navigation.md` §4.2.5. Fifty tiers, a
free track and a cosmetic-only Backstage Pass, endless Encore tiers past 50, and
`#pass`.

`npm test` · `npm run verify:pass`

### The calibration is the feature

§10.6.8 makes the pacing a **release-blocking test**: *"the pass is completable
comfortably below 40 min/day average and this calibration is a release-blocking
test on `data/progression.json` values."*

§10.4 derives its pacing from §2.2's assumption that a match averages 75 XP. The
shipped match pays **25, plus 15 for a win** — the same re-scale the Mastery
curve already carries. So the tier cost is not the design's 1,000; it is **750**,
derived so that what stays true is §10.4's *rightmost column* rather than its
arithmetic:

| Model | §10.4 says | Shipped XP/week | Reaches tier 50 |
|---|---|---:|---|
| The Regular (40 min/day avg) | week 7 | 6,140 | **week 7** |
| The Casual | week 8 | 4,783 | **week 8** |
| The Lurker | week 10 | 3,755 | **week 10** |

The test re-derives all three from the shipped constants, so changing what a
match or a mission pays without re-scaling the tier cost fails immediately. It
also asserts §10.4's *design property* — that missions, not playtime, dominate
(61% of the Regular's weekly XP) — because "doubling playtime does not double
progress" is a claim the numbers have to keep making.

> One documented difference from §10.4's table: its models credit 200 XP for the
> first win of the day, and the shipped first-win bonus pays 30 Clout and no XP.
> The baselines exclude it, so the calibration measures the game that exists
> rather than the one the table assumed.

§10.5's Rebound guarantee is **computed rather than quoted**. The design states a
figure ("≥3,400 XP/week") against its own 50,000-XP pass; the shipped pass costs
37,500, so `reboundGuaranteeXpPerWeek()` derives the real threshold. A number
copied out of a document is a number that stops being true silently.

### One XP funnel

§10.1: *"The single account XP stream. No separate pass currency."* Two places
paid XP — finishing a match and claiming a mission — and each ran its own
level-up loop. They now go through one `awardXp`, which credits the account level
**and** the pass. A third XP source would feed the pass by construction rather
than by somebody remembering to wire it.

### Nothing expires, and that shaped the state

§10.6 makes it binding, so the state machine had to carry it:

- **Wave Rebound** pays +50% while your tier is under the pace line of five tiers
  per completed week. Automatic, no button, and never announced as urgency.
- **The Archive Pass** is a *list*, not a slot. A season ending converts an
  unfinished pass to one that keeps earning at half rate until tier 50, forever —
  and a player who misses two seasons has two of them. A single slot would
  silently drop the older one, taking every reward it had not yet paid.
- **Retro-claim needs no code.** Buying the Backstage Pass at tier 20 makes all
  twenty tiers claimable at once, because claimability is *recomputed* from the
  tier reached rather than stamped when the tier was passed. The test exists to
  keep that true.
- **Tier skips add XP**, not a tier counter, so a skip and an hour of play are
  the same thing to everything downstream.

### Glimmer, and what the Backstage Pass can honestly pay

Glimmer is the premium currency (§1) and this build takes no payments, so the
only source is the pass: 400 on the free track per season, 500 more with a
Backstage Pass, against a 1,000 price. That makes it something a free player
earns their way into over about two and a half seasons — close to §10.2's stated
"a Backstage Pass roughly every other season without spending".

The free track ships **whole**: all eleven of §10.2's milestones, and the totals
match the design's stated per-season figures (5 packs, 400 Glimmer, 100
Fragments, 2 picks, ~2,925 Clout), which a test checks.

§10.3's premium track is another matter, and `DEFERRED_PASS` says so on 43 rows.
Leader skins, battlefields, animated portraits, music packs and alternate-art
Legendaries all need systems that do not exist. What ships is the Glimmer, the
seasonal emote set, the seasonal profile frame — and **four card-back tints**,
because §10.3 names tints among the minor cosmetics and a tint is a colour, which
the card-back renderer already takes.

Two free-track rows are deferred too, and they are the honest kind: tier 35's
Event Variant and tier 50's animated card-back upgrade both need variant art.
Tier 50 still pays its title and its 100 Glimmer, and reports the rest as
deferred rather than pretending it paid.

### Tone is a requirement, and it is tested

§10.6.4: *"a calm state ('ahead / on pace / Rebound active'), never
countdown-panic framing, never 'last chance!' copy. Countdown timers appear only
as factual dates."* `verify:pass` reads the whole screen and fails on "last
chance", "hurry", "don't miss", "expires soon" and "ends in". The season's end is
printed as a date, falling behind reads as *"Wave Rebound is on"* — something
being done for you — and the Rerun Vault is stated up front, because the honest
answer to "will I miss this forever" is no.

### Seasons are data

Two are authored with contiguous dates; a third is a JSON entry plus a cosmetics
block, no code. `checkHypeWaveData` refuses overlapping seasons and reports gaps,
and between seasons the screen says so while the archives keep paying.

---

## The screens the profile points at

`03-screens-and-navigation.md` §4.5.6 (statistics), §4.5.5 (match history),
§4.3.3 (character gallery) and §4.5.7 (leaderboards). The profile listed all
four as its exits and none of them existed.

`npm test` · `npm run verify:screens`

### Statistics — a dashboard's particular way of lying

A dashboard fails by printing a number that is technically correct and
rhetorically false, so `game/stats/dashboard.ts` is a pure module and the
interesting decisions are all *arithmetic*, where a test can reach them:

- **A draw is neither.** The win rate is wins over *decided* matches. `wins /
  played` quietly turns every draw into a loss.
- **Averages count only the matches they can see.** The per-match detail is
  absent on anything recorded before it shipped, so a per-deck average divides by
  the matches carrying detail — not by the matches that exist. Dividing by
  `played` would silently halve every average on an older account, and the screen
  says how many matches that was.
- **Thin rows are labelled, never hidden.** Below five matches a row is greyed
  and shows its count. Dropping it would be worse: the table would then silently
  disagree with the total above it.
- **Filters apply to the totals, not just the tables.** A header still reading
  "40 matches" over a six-row table is two answers to one question.

The dashboard needed data nobody was keeping, so `recordMatch` now stamps a
six-field `summary` on each history entry — cards played, characters defeated,
damage to the enemy leader, Confluences, Resonances and **peak Obsession**.
Nothing derivable is stored: the faction, the Currents and the result all come
from `leaderCardId` and `result`, because a second copy is a second thing to
disagree with the first.

Reading the match moved *above* the history push as part of this, so the summary,
the mission evidence, the affinity and the achievement tally are now the same
numbers by construction rather than by coincidence.

> **A real bug fell out of writing the test.** `obsessionGained` — which the
> "gain N Obsession" daily reads — never counted the *first* change. `lastObsession`
> started as `null` and the first `obsessionChanged` event was recorded as a
> baseline instead of a gain, so a match going 0 → 2 → 5 was credited with 3.
> Seeding it from the opening position fixes it, and seeding it from the
> **opening position** rather than from zero is what makes it right for scripted
> encounters too: a puzzle can start you with Obsession on the clock through a
> setup op, and setup ops emit no events, so the event stream alone cannot tell
> the two cases apart.

### Match history — one list, not two

§4.5.5 is substantially the Replay Theater, which already listed the last sixty
matches and replayed the newest eight. Building a second screen that listed the
same data would have been two lists to keep in agreement, so the existing one
grew what §4.5.5 asks for: filters by result, mode and faction; the opponent, the
date and the peak Obsession on every row; and **"run it back"**.

"Run it back" is offered only for practice matches, and that is not a
simplification. A story battle, a boss week, a Doomscroll fight and a tour loaner
all have state around them — a chapter to be in, a run to be on — and a button
that dropped you into the same board without it would be a different match
wearing the same name.

### The character gallery — nothing new was authored

The cast as people rather than as cards: 138 of them, filtered by faction, each
with a portrait, faction and Current badges, their lore, their affinity track,
and — for a leader — their Mastery level and chapter 1.

Every part of it already existed somewhere. The art is the card renderer, the
biography is `data/cards/lore.txt`, the affinity comes from the Bias Board and
the levels from Leader Mastery. **A gallery that needed its own copy of a
character's biography would be a second biography to keep in sync.**

Three parts of §4.3.3 are absent rather than faked, and the page says so:
alternate art and skins (card art is procedural and keyed by card id — the same
blocker as `DEFERRED_COSMETICS`' portrait entries), the voice-line jukebox (every
audio slot is empty), and relationships (no card carries relationship data, and
inventing it in a UI file is authoring lore in the wrong place).

### Leaderboards — the screen that says no

§4.5.7 is unusually specific: *"requires the server (no fake ladder is ever
rendered offline — explainer panel only)"*. So that is the whole screen. No
placeholder table, no greyed sample ranking, no "coming soon" over a mock —
**a mock ladder is a lie that people screenshot.**

It exists at all rather than being a dead link because §4.5.4 lists it among the
profile's exits, and a button that goes nowhere teaches players not to trust
buttons. The verification asserts the negative: that no table is rendered.

### The inbox, which this said would wait for a sender

This section used to read *"the inbox was deliberately skipped — an inbox with no
senders is a screen that exists to be empty"*. That was true when it was written
and stopped being true three features later: the Hype Wave gained seasons that
end, Headliner Banners gained a published run calendar, and §10.5.4's Welcome
Back package started paying people without telling them. **The inbox ships** —
see *The Inbox* below.

---

## The card-text audit

`npm run cards`. Every card checked against its own printed rules text, and the
premise it started from was wrong in a useful way. This document used to say the
validator "cannot verify that a card's `text` matches its `effects`" — true of a
card's *meaning*, false of most of its wiring, and the wiring is where every
expensive bug in this project has actually lived. **Flow** shipped firing on one
of four canonical channels. `afterparty` fired on both players' turns for months.
A conditional aura never read its condition. Each looked finished, because the
keyword existed.

`src/game/cardTextAudit.ts` compares two descriptions of the same card and reports
where they disagree: a keyword held but never printed, a number in the text that
no op uses, a trigger word naming a different trigger, an op with no textual
footprint, a gate turning on a number the card never prints, a summoned token
whose printed stats are not the token's, a status applied but not named, an effect
landing on the side the text does not say, a random pick presented as a choice,
and a sweep described as one character.

Judgement stays with a person. `tests/card-text.test.ts` fails on any finding that
is not either fixed in the data or listed in `ALLOWED` **with its reason written
down** — the same assert-against-a-justified-list pattern the deck-pool invariant
and the story branch-truth check already use. A second test fails when an
`ALLOWED` entry stops matching anything, so the list cannot quietly become a place
findings go to die; it caught its first stale entry on the first run. Six more
tests deliberately break real cards and assert the checker sees each shape, because
a checker that finds nothing is indistinguishable from one that is not running.

### What it found

Two card defects, and then three engine bugs behind them — all of the same shape,
which is the finding worth keeping: **a field or an op that exists, validates, is
used by shipped content, and does nothing.**

| Where | Defect |
|---|---|
| `goth-widows-bargain` | "Defeat a friendly character" was written as 99 damage — the only use of that idiom in the pool. A **Shielded** character therefore survived its own sacrifice while the card still paid out |
| `idols-dj-kilowatt` | "Scorch it" where every other card in the game writes "apply **Scorched**" |
| `engine: destroy` | **`{ op: "destroy" }` had never destroyed anything.** The last-rites guard reads "health above 0 after the window" as "somebody revived it" — correct for a character that arrived at 0, catastrophic for the destroy op, which arrives at FULL health. Every destroy cancelled itself, emitted `defeatPrevented`, and left the character standing |
| `engine: buff.permanent` | A flag nothing read. Six cards set it, none set it false, and buffs are permanent by construction anyway — so the schema implied a distinction the engine does not have and invited somebody to write `permanent: false` and expect a buff to wear off. Removed; `.strict()` now refuses one |
| `engine: resurrect` | Read `count` and ignored the **filter** on its own target. Every shipped use filters on `type: character`, which the op already hardcoded, so the two agreed by luck — a card written to return "a random Idol" would quietly have returned anything. The filter is now real |

The `destroy` bug is the significant one. It reached three shipped cards —
*Terms of Service Update*, *Lord of the Last Episode*, *Widow's Bargain* — and
**Veil's Perfect Resonance, "Total Blackout"**, which is an entire Current's
payoff. It is covered three ways now: a fixture test that a full-health character
is destroyed, a second that a `revive` still cancels one (so the guard did not
simply go away), and a content sweep that finds every shipped `destroy` **by
walking the data rather than by listing them**, so a fourth is covered without an
edit. All three were confirmed by removing the one-line fix and watching them fail.

Getting there took four passes over the checker itself, and the false-positive
classes are worth recording because each was the check being wrong rather than the
content:

- **A leader's `text` describes its passive only.** Comparing it against every op
  on the card — Fixation and Ultimate included — reported the entire leader roster
  as broken. Findings are now per (text, ops) pair.
- **Equipment stat bonuses are not ops.** They live in `equipAttack` /
  `equipHealth`, so every Equipment in the game read as promising a bonus it did
  not grant.
- **Leaders are in `content.cards` as well as `content.leaders`**, so every leader
  finding was reported twice until the walk was deduplicated by id.
- **Reminder text is the engine explaining itself**, not a claim about the card,
  and has to be stripped before checking what a card asserts — but kept for
  "did the player ever see this number at all".
- **Boss text is prose written in the second person about the player.** "At the
  start of your turn" is the player's turn, which from the boss's seat is
  `enemyStartOfTurn` — the trigger really is the one the sentence describes.

> One of those passes was lost to a `` that had become a literal backspace byte,
> because the regex went through a shell heredoc. That is the third time this
> session that a heredoc has eaten a backslash. Anything with one now goes through
> the editor, not the shell.

---

## The Doomscroll (roguelike campaign)

**Four acts, playable end to end, the last one optional.** Pick one of two run
leaders, take a 15-card temporary deck and 30 health that carries between fights,
and descend a branching 7-floor map per act to a faction boss.

Act 4 — **The First Signal** — is the spec's optional true finale: one fight
against a Prism superboss, entered only by holding three **Signal Fragments**,
one from each earlier act's first Elite. The cost is paid on the map rather than
in a currency: you walk into the harder fight or you route around it. Measured
across 400 maps per act, an Elite-free route exists in **96.5–99.3%** of them, so
avoiding them is a real decision and not a formality either way. Finishing
without the fragments still *wins* the run — optional has to mean the ending
without it is an ending — and the summary says how close you were.

Its twist, *Reconvergence*, is a fixed three-phase cycle rather than a single
rule: your leader's Current rotates, then you discard a card, then your costliest
character is Banished until your next turn, then it repeats. The order is printed
on the card and the phase counter is public, which is the counterplay — the
design's own raid guidance is that bosses telegraph what is coming.

| Piece | Where | State |
|---|---|---|
| Content | `data/roguelike.json`, validated by `game/doomscroll/data.ts` | Leaders and their starting decks, per-act floor plans, node weight tables, enemy pools, bosses, 8 artifacts, 8 Notifications, 11 recruits. Cross-checked against real cards, the same way encounters are. |
| Map | `game/doomscroll/map.ts` | A pure function of (run seed, act). Fully connected both ways and **non-crossing by construction** — neighbouring nodes may share the target on their boundary and nothing else, because an overlapping range draws an X and an X reads as "these paths merge" when they do not. |
| Run | `game/doomscroll/run.ts` | Pure: run in, run out. Nodes, a prompt queue, shops, Breaks, Notifications, Collab Calls, Sponsor Drops, artifacts, death and the act handoff. No DOM, no storage, no clock — which is why a run can be played to completion in a unit test. |
| Save | `save/doomscrollSave.ts` | The whole run is stored, prompt queue included, so a reload during a shop visit puts you back in that shop. |
| Battles | `#doomfight` route in `main.ts` | A normal match dealt from the run deck, with run health as a `leaderHealth` setup op on seat 0 only — `leader.startingHealth` is one number shared by both seats, so a balance override would hand the enemy your run health too. Elites and bosses get theirs the same way. |

Deliberate limits, each for a stated reason rather than time:

- **All four acts, and the fourth is deliberately optional.** It is gated on
  Signal Fragments rather than simply being act 4, which is what the spec asks
  for. The gate is validated at load: an act asking for more fragments than the
  acts in front of it can supply would be a finale nobody ever sees, and it would
  fail silently rather than loudly.
- **Fourteen artifacts: eight run-level, six that bend the battle.** The run-level
  ones change health, prices, rewards or the map economy. The battle ones are a
  `CardPatch` on the run leader carried in `cardOverrides` — Ring Light of Focus
  (Fixation costs 1 less), Off-Brand Energy Drink (Ultimate costs 1 less), Pocket
  Hotspot (+1 Hype on your first turn), Prewritten Thread (an extra card on your
  first turn), Stolen Verified Checkmark (your first character each battle gains
  Spotlight) and Merch Cannon (1 damage to a random enemy character at end of
  turn). The data validator applies every one of them to every run leader at load
  time, so an artifact that could not be applied never ships.
  Still absent, deliberately: Ancient Meme Grimoire and Foam Finger need a
  modifier layer the DSL lacks, and The Algorithm's Favor would need a scry the
  player controls — the `scry` op shuffles rather than reorders.
- **Card upgrades, on all three surfaces the design names** — the Touch Grass
  Break, the Merch Table (75 Clout) and a Notification — plus recruits arriving
  pre-Remastered. Upgrading is genuinely **per copy**: one copy of a card can be
  Remastered while the copy beside it is not, which is the whole reason it waited
  for `cardVariants` rather than reusing `cardOverrides` directly. Patching the
  card id would have upgraded both copies and handed out two upgrades for one
  price — a bug that looks like generosity and is very hard to notice.

  What "Remastered" *does* is a stated default with a per-card override, not an
  authored table of 195: characters get +1/+1, everything else costs (1) less,
  and `data/roguelike.json` overrides the ones where that is the boring answer
  (usually granting the card's own Current's signature keyword). The loader
  **builds every collectible card's upgrade and asserts it changes the card**, so
  a hole in the table is a load error rather than a Rest node that silently does
  nothing — the exact hazard of a default rule is "cost −1" on a card that
  already costs 0.
- **Restarting a fight is counted, not prevented.** Nothing stops an offline
  player from navigating away from a losing board; refusing to re-enter would
  punish a browser crash far more often than it caught anyone. The battle seed
  mixes the attempt count in, so a restart is a different game rather than a
  reroll of the same opening hand, and the summary reports fights entered next to
  battles won.

## Designed but NOT implemented

These are specified in `docs/` and have no code yet. Nothing here is stubbed with
fake UI — modes that need a server are shown honestly as "Needs server" in mode
select.

- Co-op raids. **Built: the interactive tutorial, Puzzle Rush (40 puzzles),
  Replay Theater, The Lab, Weekly Boss (all 10 bosses), The Doomscroll (all 4
  acts), Story Chapters, and ~~Draft/arena~~ The Gauntlet** — see the scripted
  encounters, Doomscroll, story and Gauntlet sections. Competitive Gauntlet is
  the online half of a Hybrid mode and waits with the rest.
- ~~With the Gauntlet, every mode in the brief that does not need a server is
  playable.~~ **This was wrong, and it was wrong here for several sections.**
  Mode select lists thirteen modes; `09-game-modes.md` lists twenty-one, and
  **three of the missing ones are explicitly offline-capable**:
  ~~**§9.12 Remix Queue**~~ (**now built** — see *The Remix Queue*),
  ~~**§9.14 Event Hub**~~ (**now built** — see *The Event Hub*), and
  ~~**§9.17 Custom Lobby**~~ (**now built** — see *The Custom Lobby*). All three
  now ship, so the claim is finally true rather than merely written down.
  Daily challenges are *mostly* covered by the missions system — three
  deterministic daily slots and a free daily reroll ship — but §9.11's Daily
  Puzzle and Daily Doomscroll bonus slots do not, and the 7-day streak pack was
  deliberately dropped (`missions/rotation.ts` argues against streak pressure,
  which is a defensible call the spec has not been updated to match).
- Ranked ladder, casual matchmaking, spectating, replay sharing, tournaments,
  friends, guilds — **all require the server, which is designed but not written**
- ~~Banner/pack opening~~ **Merch Drops ship** (see below); ~~missions~~ **ship**;
  ~~Faction/Leader Mastery and the Bias Board~~ **ship**; ~~achievements~~
  **ship** (26 of them, §9's seven categories, with point milestones). Headliner
  Banners and the battle pass do not
- ~~**The cosmetics layer**~~ — **card backs, titles, profile frames, portrait
  badges and emotes ship.** What is left is alternate portraits, leader skins,
  Premium variants, voice lines and intro animations; `DEFERRED_COSMETICS` in
  `src/game/progression/mastery.ts` remains the authoritative list, each entry
  with the reason it is blocked, and a test fails the day one stops being true
- ~~Character gallery~~ **ships**; ~~statistics dashboard~~ **ships**;
  ~~leaderboards~~ **ships as §4.5.7's explainer** (a real ladder needs the
  server); ~~the **inbox**~~ **ships** — see *The Inbox*; ~~**news and patch
  notes**~~ **ship** — see *News, and the patch notes that cannot drift*; the
  ~~**system hub**~~ **ships** — probability disclosures, privacy, legal and
  support; ~~**accessibility settings**~~ **ship** on their own screen
- Leader voice lines, dynamic music layers, victory/intro animations

---

## Known gaps and rough edges

1. **Card art is procedural.** Intentional — drop real art in `public/assets/art/`
   keyed by card id and it appears immediately.
2. **No audio files.** Intentional — the manifest is wired, the slots are empty.
3. **Balance is unplayed by humans, but no longer unmeasured.** `npm run balance`
   plays a full round robin — every leader against every other, in both seats —
   and reports win rates by leader and faction, match length, first-seat
   advantage and a trigger census. The first run (380 matches, casual AI):

   | | |
   |---|---|
   | Faction win rates | **23.7% – 77.6%** (Algorithm Syndicate lowest, Neon Idols highest) |
   | Leader win rates | 21.1% – 78.9% |
   | Match length | mean 7.2 turns, median 7, range 4–12 |
   | Ending before the design's turn-6 floor | 8.4% of matches |
   | First seat | won 56.8% of decided matches |

   The match-length row is measured against a rule the design already writes
   down: `10-balance-assumptions.md` says "aggro must be able to kill by turn 7;
   control must be able to stop it by turn 6", and a match ending below turn 6
   "breaches the five-minute floor". **The average match ends on turn 7.2** —
   i.e. the typical deck is killing about as fast as the fastest intended one.
   Either the clock is quicker than designed or the AI is trading badly; a human
   playtest is what tells those apart.

   Read it with the caveats printed at the top of `tests/balance.test.ts`: both
   sides use `autoBuildDeck`, which builds no synergy, and both use the same AI,
   so this measures decks and leaders rather than skill or ceilings. A 54-point
   faction spread is still far too wide to explain away, and the bottom of the
   table is exactly the factions whose identity is a synergy payoff.

   Re-run after the boss-twist work (which fixed conditional auras and permanent
   max Hype): **unchanged within noise** — mean still 7.2 turns, spread still
   23.7%–77.6%, first seat 56.6%, below-floor 8.2%, Afterparty still 7.96 firings
   per match. That is a useful negative result about the harness itself: both
   fixed cards are one-of-thirty in an auto-built deck, and an Ultimate costing 7
   Obsession is rarely reached at all, so **380 matches cannot resolve a
   card-level bug.** Use the harness for leaders, factions and the clock; use
   unit tests for whether a card does what it says.

   **Re-run after the pure-Current card pass** (50 new cards, and Flow fixed so
   three of its four channels exist). The pools moved a lot; the spread did not:

   | | Before | After |
   |---|---|---|
   | Faction win rates | 23.7% – 77.6% | **22.4% – 75.0%** |
   | Leader win rates | 21.1% – 78.9% | 18.4% – 78.9% |
   | Match length | mean 7.2, range 4–12 | mean 7.5, range 5–16 |
   | Ending before the turn-6 floor | 8.4% | 8.4% |
   | First seat | 56.8% | 56.6% |
   | `flow` firings per match | — | 2.60 |

   **The card pass did not close the faction gap, and that is the finding.** The
   hypothesis going in was that the bottom of the table was the thin-pool
   factions, so filling the pools would lift them. It half-held: Algorithm
   Syndicate came off the floor (23.7% → 30.3%) and Touch-Grass (55.3%), Viral
   (53.9%) and Meme Collective (43.4%) all sit mid-table now. But the *spread*
   moved by one point, because **Afterparty Crew simply became the new floor at
   22.4%** — and its pool was never thin. Neon Idols are still on top at 75.0%.

   So the gap is not a pool-size problem. What did visibly change is the shape of
   the game: the longest match went from 12 turns to 16, which is the control
   decks finally having enough cards to play a long game at all — Sterling
   Bright's fortress archetype could not previously be built.

   **No human has playtested any of it.** That remains the biggest unknown, and
   it is now the only lever left that has not been pulled.
4. ~~**Card text is author-written, not generated.**~~ **Checked now**, by
   `npm run cards`. The claim above was half wrong: a card's *meaning* is not
   machine-checkable, but most of its wiring is, and that is where the expensive
   bugs actually lived. See *The card-text audit* below — it found three engine
   bugs, and one of them meant `destroy` had never destroyed anything.
5. **~~Five leaders cannot be built for at all.~~ Fixed — 50 new cards.** Every
   faction ships one dual-Current leader and one **pure** leader whose payoff is
   Perfect Resonance; the faction guides name each archetype ("Follower Flood,
   pure Gale · Cyra Swipe"; "Positive Press, pure Halo · Sterling Bright"). The
   design was sound and the card pool had not caught up with it, so five of those
   single Currents did not hold thirty cards' worth of legal cards. Sterling
   Bright's entire pool was nine cards — eighteen with copies — which means **the
   deck builder could not complete a legal deck for him**, and neither could a
   human.

   Ten cards each for Algorithm Syndicate (Tide), Corporate Creators (Halo),
   Touch-Grass Order (Gale), Meme Collective (Gale) and Viral Influencers (Gale),
   written to the archetype each faction guide already specifies rather than
   invented. Every pure leader now sits at 37–39 capacity against a deck size of
   30 — the same headroom the dual leaders have, so those decks have choices in
   them rather than one forced list.

   Three *more* leaders were unbuildable for a different reason, and that one was
   a bug: `autoBuildDeck` dropped every Prism card to stay under the 3-card splash
   limit, which is right for the eight leaders who can only splash and wrong for a
   leader whose own Current *is* Prism. Cosplay Champions print 11 Tide and 7
   Prism, so Vera Foamhammer and Kiko Thousand-Faces were being built out of
   twelve cards and Chairperson Nobody out of eleven. `validateDeck` already
   skipped the splash check for a Prism-native leader; the builder now agrees with
   it, and both directions are covered — a Prism leader must exceed the splash
   limit, a non-Prism leader must not.

   > The test that should have caught all eight had existed since the engine
   > shipped. It is called "auto-builds a legal 30-card deck", it asks
   > `idols-lumi-starcall` — one of the healthy ones — and it never asked about
   > the other nineteen. It now asks every playable leader, alongside a second
   > test that independently computes which pools are too small and asserts that
   > set is *exactly* the (now empty) exception list. Neither test can be
   > satisfied by quietly excusing a leader: adding a name to the list makes the
   > other one fail unless the pool really is short.

6. **The AI picks its deck naively** (`autoBuildDeck` fills a curve). It plays
   legally and competently but does not build synergistic decks.

   This was attacked and the attack failed, which is worth knowing before trying
   again. `autoBuildDeck` gained a `"synergy"` mode that orders each cost bucket
   by tag density — derived from the data, by counting which tags the faction's
   own targeting filters name, so it needs no per-faction archetype list. Played
   head to head against the curve builder over 320 mirror matches (same leader,
   both seats, one deck built each way) it came out **49.1% to 50.9%**: a coin
   flip. It is not the default. The mode and the mirror comparison both remain,
   so the next heuristic can be judged by matches rather than argued about —
   `npm run balance -- --only mirror`.
7. ~~**Mobile is responsive but untested on a real device.**~~ **Measured.**
   `npm run verify:mobile` walks ten screens at four viewports and found **93
   interactive controls under §13's 44px floor** — every chip-shaped control had
   opted out of `.btn`, which is where the floor lived. It is applied under a
   coarse pointer now. Real hardware is still untested and always will be by a
   script: a browser cannot feel a finger, judge a screen's contrast or report
   thermals. What it can confirm is that nothing scrolls sideways, no text falls
   below 11px, the rotate prompt appears on a phone and not on a tablet, and the
   board deals at 667×375.
8. ~~**Deck builder cannot compare deck versions** and there is no AI-assisted
   deck building yet.~~ **Both ship** — see *The deck builder, and a button that
   ignored your collection*. Compare-versions diffs the draft against the last
   save (and its own label is the unsaved-changes indicator); suggestions,
   replacements-for-missing, craft targets, Auto-Complete and build-around all
   run from the account's collection, as `14-ai-design.md` requires and the old
   Auto-Build button did not. §4.3.2's *"Test vs AI"* ships with them.

   The **rest of §4.3.2 ships too** — see *Twelve deck slots you could never
   see*: the twelve-slot list (which the game had never had, despite storing an
   array of decks and offering no way to reach the second one), the Current-split
   donut and its Resonance/Confluence verdict, the cover and card-back pickers
   (two fields that existed only as a type in `types.ts`), the 16-character name
   limit, and the per-deck record. Building the list surfaced a latent save-layer
   bug: deleting a slot moved the active pointer onto a *different* deck.
9. ~~**Tutorial rewards are Clout only.**~~ **Paid.** Finishing pays §2.3's
   completion package — three Merch Drops, the **Day One** card back and the
   title **Fresh Poster** — once ever, keyed as a permanent claim so the ledger's
   trim cannot make it payable twice. The reason it could not be paid (no screens
   for a pack, a card back or a title) expired when the cosmetics layer shipped.
   §2.3's *"choice of two starter decks"* is still deferred: the account picks
   one at creation, and granting a second silently would hand somebody a faction
   they did not choose.
10. **Rewind is unblocked but not built.** The AI is now a pure function of match
   state, which is the hard prerequisite; the UI-side work (resetting the
   presenter queue, the view's per-instance caches and the hand's diffing
   animations) has not been done. See the tutorial spec's "rewind offered once
   per taught mistake".
11. ~~**A match is banked when you leave the result screen, not when it
   ends.**~~ **Banked when the result appears.** The justification for the old
   behaviour was that *"the result screen is where the player is told what they
   won"* — and it was not: `recordMatch` returned what a match paid and all five
   callers discarded it, so every grant was invisible. The screen prints the
   payout now, and `onSettle` runs the moment the result appears, so closing the
   tab on a victory keeps it. That also removes the trap `verify:tour` fell into
   once, where it read the winner, navigated away, reported the win and found the
   faction still locked.
12. **The Grand Tour's opponent pairing is arbitrary.** Each faction faces the
   next on the list, and the measured matchups range from 4.2% to 87.5% at equal
   skill. See *The Grand Tour* — a playtest question, not a number to fit.
13. ~~**Most Mastery rank rewards cannot be paid.**~~ **Mostly closed.** Every
   faction rank now pays something real. What still reads "Earned — waiting on
   the cosmetics layer" is Leader Mastery levels 5, 7 and 9 (alternate and
   animated portraits, an intro animation variant), the Premium variant voucher
   at faction rank 20, the Chromatic skin at Leader 10, and the Bias Board's
   tier-2 voice line and tier-4 signature emote. Each has a written reason;
   portraits and skins want an art system keyed by something other than card id,
   voice lines want audio files, and a per-character emote is several hundred
   jokes rather than a system.
14. ~~**60 leader lore chapters are unwritten.**~~ **Written.** Chapters 2, 3
   and 4 now exist for all twenty selectable leaders — 80 leader pages in total,
   against a documented arc (public fact → method → cost → origin file, the last
   fixed by 08 §5.2). Every id was checked against the real leader cards: none
   names a card that does not exist, and no selectable leader is missing a page.
   ~~What remains of this gap is the Bias Board~~ — **that is written too**: all
   **236** pages, 118 characters × 2 tiers, validated the same way. `mastery-lore.txt`
   now holds 356 blocks with **zero** placeholder or thin bodies. **Gap 14 is
   closed.** The writing still outstanding is a different file: 295 of the 296
   per-card flavour blocks in `data/cards/lore.txt`.
15. **Mastery and achievements are accumulators and cannot be re-derived.**
   Unlike mission progress, which is recomputed from stored match records, a
   mastery track and an achievement tally *are* the record. If either is ever
   credited wrongly there is nothing to recompute from — which is why
   `recordMatch` credits mastery outside the mission `try`, why the accrual has
   its own mutation coverage, and why a test asserts the achievement tally moves
   by exactly one match per recorded match.
16. **§9's 1,000-point milestone is not listed.** The twenty-six shipped
   achievements are worth 635 points, 625 of them reachable offline, so the third
   frame §9 promises would be unclaimable. It is omitted rather than shipped
   unreachable, and `checkAchievementsData` fails if any *listed* milestone
   exceeds the reachable total — so the omission reports itself once the set grows.
17. **43 Backstage Pass rows cannot be paid.** §10.3's premium track is leader
   skins, battlefields, animated portraits, music packs and alternate-art
   Legendaries — all systems this build does not have. `DEFERRED_PASS` in
   `src/game/progression/hypeWave/` is the authoritative list, each entry with
   its reason, and a test fails the day one stops being true. What the track
   *does* pay is the Glimmer, the seasonal emote set, the seasonal frame and four
   card-back tints.
18. **Two free-track rows are deferred too**, and both for the same reason: tier
   35's Event Variant and tier 50's animated card-back upgrade need variant art.
   Tier 50 still pays its title and Glimmer and reports the rest as deferred.
19. ~~**Glimmer has one source.**~~ **Stale — it has two.** The Stream Check-In
   pays 50 Glimmer at step 9 and has since it shipped: 600 a year on top of the
   pass's 400 a season. This entry predated the Check-In and was never struck.
   What is still true is that nothing *buys* Glimmer, which is deliberate.
20. **§10.5.4's Welcome Back package is half-built.** The 300 Clout and the
   forced Rebound week ship — the Clout as an inbox attachment, and the message
   says the rest is missing rather than implying it paid. The three pre-banked
   dailies and the extra weekly slot do not, because the mission rotation issues
   from a pool on a clock and has no vocabulary for a granted mission.
21. **The pull history is bounded at 120 entries.** §4.1 asks for "every pull
   ever made", and "ever" is not a thing a browser save can honestly promise —
   a hundred ×10 pulls is a thousand card records. The page says how many it
   kept. The same bargain the Drop log already makes.
22. **§11's check-in rotation covers twelve months.** Year two repeats, and a
   player who already owns that month's card back gets nothing new from step 10.
   `checkCosmeticsData` reports a rotation shorter than twelve rather than
   hiding it; the honest fix is more months, which is content, not code.
23. **Banner key art is the featured card.** §4.1 asks for full-bleed animated
   banner art. There is no art pipeline, so the hero is the featured Legendary's
   own procedural card — the same substitution the whole cosmetics layer makes.
24. **One achievement cannot be earned offline.** *Front Row Seat* (spectate a
   friend's match) reads `matchesSpectated`, which needs the server. It is listed
   in `DEFERRED_FACTS` with the reason, the row says so on screen, and a staleness
   test fails the day the number starts moving.
25. ~~**The profile store has no migration chain.**~~ **Defused.** It was a
   whole-save wipe waiting for a version bump: `storage.ts` returned
   `defaults()` on any mismatch when a store carried no `migrate`, so the day
   anybody bumped `PROFILE_VERSION` every account would silently have lost its
   collection, decks, Mastery and cosmetics. A mismatch now carries the payload
   forward, and defaults fill at **every depth** rather than one level — which
   retires the "read it defensively" warning that twelve fields of
   `PlayerProfile` carry. Arrays are never merged and a saved `null` is never
   replaced. Both behaviours were confirmed by breaking `storage.ts` and watching
   1,200 banked Clout become 0.
26. **The inbox has one attachment kind.** `MailReward` is a union of one:
   Clout. It is shaped like the pass, mastery and achievement reward unions so a
   second kind is an addition rather than a rewrite, but a kind with no payer is
   the inert-reward bug waiting to happen — so kinds arrive when senders do.
27. **Mail is generated from the shipped calendar, so a quiet month is quiet.**
   With two seasons and six banner runs authored, there are stretches where the
   only mail is the welcome message and the month's check-in. That is the honest
   output of "derived, never written" and not something to pad; it is also why
   the empty state explains itself rather than just being blank.
28. ~~**The patch notes have one release, so there is nothing to diff.**~~
   **Two now.** Changing `economy.missions` made policy F4 fail on its own
   author — *"add a new release, or update 0.1.0's snapshot if it has not shipped
   yet"* — which is the check working exactly as designed. The second release
   found a real bug within a minute: §4.2.3's "changed since you last played"
   band tested set membership, so reading the newest notes left every older
   release flagged forever. With one release that reading is indistinguishable
   from the right one.
29. **The news feed is a file, and it does not update between releases.** §4.2.2
   marks the live feed as online-only, which is what ships: seven articles, no
   service behind them, and the screen says so. Article images are also absent —
   §4.2.2 asks for one per article and there is no art pipeline.
30. **The news token vocabulary is closed, and deliberately small.** About forty
   keys. Adding a figure to an article means adding the key, which is the point:
   a general expression language would let an article compute something the game
   does not actually do, and the whole mechanism exists to make that impossible.
31. **Terms of Service and an EULA have not been written.** §4.6.5 marks both
   NOW. They are shown as `not-written` with the reason rather than filled with
   placeholder legalese, which would read as binding and be worse than nothing.
   They are required before this build is distributed to anybody.
32. ~~**§4.6.2's dedicated accessibility screen does not exist as its own
   route.**~~ **Stale — it does.** `#a11y`, off Settings and off §4.6.1's links
   row, with the live text-size preview and the keyboard-navigation options this
   entry listed as missing. It shipped with the accessibility block and this line
   was never struck.
33. **The privacy page describes this build, not the product.** Retention
   schedules, a data controller, an export request route and parental controls
   all belong to the online build, where there is something to control. The page
   says which paragraphs go away when that arrives.
34. ~~**Accessibility audio cues are silent.**~~ **They make sound.** §11 never
   asked for audio *files* — it gives each of its 34 rows a **cue character**
   ("two-note rising chime", "hollow descending tone"), and a character is a
   description of a waveform. Twenty-eight rows are synthesised from oscillators
   and filtered noise at play time, with nothing to download and no licence to
   honour. The other six need the network transport, an event the engine does not
   emit, or art that does not exist, and are in `DEFERRED_CUES` with reasons. No two cues may be the same sound, every cue has
   §11's required visual twin, and the test renders each one and counts the
   sources it built — "was the function called" would have passed on silence.
35. ~~**The battle board is pointer-only.**~~ **Playable by keyboard, and
   mirrored.** §13's zone model, key map and interaction state machine ship as a
   pure reducer, and §16's Board Mirror ships as a visually-hidden landmark with
   two live regions — see *Playing the board without a pointer*.
   `verify:keyboard` plays a real match with a tripwire that fails the run if any
   trusted pointer event fires: mulligan, cursor, card, slot, attack and target
   cycling, all from the keyboard. It found that dismissing any dialog dropped
   focus to `<body>` and silently stopped the board hearing keys at all. Six
   §13.2 keys remain unbound, each with a reason in `DEFERRED_KEYS`; a real
   screen-reader pass on real assistive technology has still not been done, and a
   browser cannot do it.
36. **The default palette is not dichromat-safe, on purpose.** It fails the §7.2
   guardrail under all three simulations; the three colour-blind modes exist for
   exactly that reason and each clears it. Requiring the default to pass would
   design the whole game's colour language around a constraint a switch already
   solves.

37. **No leader can fill a Legendary draft offer.** §8.1 rolls Legendary on one
   Spotlight Pick in ten and wants three distinct cards of it; every one of the
   twenty selectable leaders has two or fewer in its legal pool, and three have
   none. The mode fills the gap from the rarity below and prints the shortfall
   per leader rather than hiding it. The content fix is more Legendaries; the
   design fix is a smaller offer or a per-pick rarity roll. Both are decisions
   for whoever owns the card set, and `tests/gauntlet.test.ts` fails the day the
   pool stops being short, which is when to make one.

38. ~~**Per-match Clout is still uncapped in every mode.**~~ **Capped.** 09 §3's
   AI daily allowance existed only in the design document; nothing had ever read
   it. Every mode's per-match Clout now spends against one account-wide,
   day-keyed ledger, shared with the Gauntlet's run payout, and a capped payout
   says on the result screen what it withheld and when it resets. The ceiling is
   **derived** — `aiDailyCapWins × winClout` — because §3's 200 sits against its
   own 20–30-per-win schedule and copying the constant would have shipped the
   same number with a different rule.
39. **Competitive Gauntlet, and the entry cost nothing charges.** §8.2 matches
   drafters by run record then by Gauntlet MMR, and §8.3 charges 150 Clout or one
   Gauntlet Ticket. Practice is free entry by §8.4, so the price is displayed and
   never debited — and Tickets are withheld from Practice payouts because a
   Ticket buys an entry into a mode that does not exist yet. All three are on
   `DEFERRED_GAUNTLET` and printed on the screen.

40. ~~**A drafted run has no turn timer.**~~ **Stale — every match has one.**
   `hud.startTimer` runs a 75-second clock with a 15-second rope, a countdown
   ring and a numeral, and `balance.timer` has held both numbers since the board
   shipped. This entry, the Gauntlet's matching deferral and §11's rope audio
   cues were all written on a claim rather than a check; the cues are built now
   and the two deferrals are gone. A scripted stage still runs no clock, which is
   deliberate — being timed while a lesson is explaining something is the
   opposite of teaching.

---

## Recommended next steps, in order

1. **Play ten matches yourself.** Everything above is machine-verified; none of it
   is fun-verified. Write down what feels bad — that list is more valuable than
   any further feature work right now.
2. ~~**Read through the newer faction card sets** and check each card's `text`
   against its `effects`.~~ **Done, and mechanised** — `npm run cards`. What a
   checker still cannot see is whether a card is *fun*, which is step 1.
3. **Read the fifty new cards as a player would.** They are validated, curved
   and archetype-guided, but no human has seen one in play. The five pure-Current
   archetypes are the decks most likely to be either unplayable or oppressive.
4. **Start dropping real card art.** The pipeline works today and it is the single
   biggest jump in perceived quality.
5. **Close the faction gap — and it is now a playtesting job, not a content one.**
   `npm run balance` measures it at **22.4% to 75.0%** across ten factions. The
   obvious content lever has been pulled: fifty new cards gave every pure-Current
   leader a real pool, and the spread moved by a single point, because the new
   floor (Afterparty Crew, 22.4%) is a faction whose pool was never thin. Nothing
   left to fix by adding cards. Play ten matches by hand, write down what feels
   unfair, and change numbers against that — the harness will tell you in 40
   seconds whether the change did what you meant.

6. ~~Close the three loose ends the story track leaves open.~~ **Done.** The
   Side Cut node ships with all ten side cuts written, the Archive ships with the
   ten GLIMMR fragments and *The First Signal, Annotated* at ten, and the
   branch-truth check ships in `npm run story`. ~~§3.10's multi-wave board is the
   only design line the ten chapters still express by approximation~~ — **that is
   built too.** The story track has no known open items and no chapter
   approximates anything the design asked for.
7. **Then the next big block — pick one, not both.** The **progression screens**
   are underway: Merch Drops, starter decks, the Grand Tour, missions and the
   Mastery tracks ship, so every faction is reachable by playing it, there is a
   reason to come back tomorrow, and every match now moves something that lasts a
   season. What remains on that track is the battle pass and Headliner Banners —
   both single-player surface, neither needing a server. The
   **server foundation** unlocks ranked, matchmaking, spectating, replay sharing,
   tournaments, friends and guilds in one go — roughly half of what is left in
   the brief — and is much the larger job.

8. ~~**The cosmetics layer is now the highest-value small job.**~~ **Done** — see
   *The cosmetics layer*. Card backs, titles, frames, badges and emotes are
   earned, worn and rendered, and `DEFERRED_COSMETICS` is down from ten entries
   to five.

9. ~~**Achievements are the cheapest thing left.**~~ **Done** — see
   *Achievements*. Twenty-six of them, §9's seven categories, points and
   milestone frames. One estimate in that prediction was wrong and worth
   recording: they do **not** read the mission evidence log. That log holds 200
   matches and is pruned, so it cannot answer "complete 500 matches" — achievements
   had to become an accumulator like Mastery, and the match reader had to learn
   eleven new feats before §9 could be expressed at all.

10. ~~**The screens the profile points at.**~~ **Done** — statistics, match
   history, the character gallery and the leaderboards explainer. One real bug
   fell out of it: `obsessionGained` never counted the first Obsession change,
   which the "gain N Obsession" daily reads.

11. ~~**The battle pass.**~~ **Done** — see *The Hype Wave*. What is left of
   §10 is `DEFERRED_PASS`: 43 Backstage rows waiting on leader skins,
   battlefields, animated portraits, music packs and variant art, plus §10.5.4's
   pre-banked mission slots, each with a written reason.

12. ~~**Headliner Banners and login rewards.**~~ **Done** — see *Headliner
   Banners, and the Stream Check-In*. Glimmer now has a second source, and the
   `reroll()` limit gained a `force` path so §11's tokens do something a free
   reroll cannot.

13. ~~**The inbox.**~~ **Done** — see *The Inbox*. It also took the Welcome Back
   package off the invisible-payment path it had been on since the pass shipped,
   and replaced the lobby's hard-coded mission rail with the account's real one.

14. ~~**News and patch notes.**~~ **Done** — see *News, and the patch notes that
   cannot drift*. Policy F4 is now enforced by a test rather than promised by a
   document, and every authored schedule date in the build stopped rendering a
   day early.

15. ~~**The system hub.**~~ **Done** — see *The system hub, and the screen F1
   names*. Policy F1's second half now exists, and the privacy page's central
   claim is checked by watching the browser rather than by asserting it.

16. ~~**Finish accessibility.**~~ **Done** — see *Accessibility, and two
   switches attached to nothing*. Three colour-blind modes and the written-labels
   toggle were inert; they are not now, and a dichromacy simulation fails the
   build if a palette ever stops being safe.

17. ~~**Now the Gauntlet, or the server.**~~ **The Gauntlet is done** — see
   *The Gauntlet, and a rarity table the card pool cannot keep*. With it, every
   mode in the brief that does not need a server is playable. It also found that
   §8.1's rarity table is unsatisfiable by the shipped card pool (no leader has
   three Legendaries), that 09 §3's AI daily Clout cap had never been built, and
   that twenty screens have been rendering an unstyled header.

18. ~~**A hardening pass over the known gaps.**~~ **Done** — see *The hardening
   pass, and a reward nobody could see*. Nine gaps came off the list; two of them
   had already been closed and never struck. Three were worse than their entry
   said: a version bump would have wiped every save, 09 §3's daily Clout cap had
   never been implemented at all, and **every match reward in the game was
   granted invisibly** because `recordMatch`'s return value was discarded at all
   five call sites. It also found 93 touch targets under §13's 44px floor.

19. ~~**Keyboard play on the battle board, and §14's Board Mirror.**~~ **Done** —
   see *Playing the board without a pointer*. §13's zone model, key map and state
   machine ship as a pure reducer; §16's Board Mirror ships as a visually-hidden
   landmark with two live regions; and `verify:keyboard` plays a real match with
   a tripwire that fails if any trusted pointer event fires. It found that
   dismissing any dialog dropped focus to `<body>` and silently stopped the board
   hearing keys, and that §11's rope cues had been deferred on a claim about a
   turn timer that has existed all along.

   What it does **not** close is a real screen-reader pass. The Mirror is
   correct by construction and correct by test; whether it is *usable* is a
   question for NVDA, JAWS and VoiceOver with somebody who uses them daily, and
   no browser script can answer it.

20. ~~**Deck comparison and deck-building assistance**~~ **Done** — see *The deck
   builder, and a button that ignored your collection*. It found that Auto-Build
   handed out decks of cards you did not own, which then validated, saved and
   played; that a new slot opened on one; and — from an adversarial review of the
   first implementation — two bugs in the replacement, one of which was the same
   ownership bug in a different corner.

21. **The server foundation, or the writing.** Two things are left after that,
   and they are about as unalike as two jobs can be.

   The **server foundation** is much the larger and still unlocks roughly half
   the brief in one go: casual, ranked, matchmaking, spectating, replay sharing,
   tournaments, friends and guilds — plus competitive Gauntlet, the leaderboards
   screen's real content, and the one achievement nobody can currently earn. It
   is also the first thing in this project that a browser walk against a local
   build cannot verify, so it changes how every block after it gets checked.

   The **writing** was 60 leader lore chapters and the per-card flavour text the
   character gallery has a place for and currently renders empty. **The 60
   chapters are now written** (see *The sixty chapters*). The per-card flavour
   text is **not**: `data/cards/lore.txt` has a block for every card, and **295
   of its 296 blocks are the literal placeholder "Not written yet."** Only one
   card has real flavour. Counting blocks is not counting prose — a mistake this
   document made once already, in the other direction.

   **Both are now written.** All 296 card Story-tab blocks and all 236 Bias Board
   pages exist, and `node scripts/check-lore.mjs` passes on both files with zero
   placeholder and zero thin bodies. The writing is done.

**Every leader can be built for.** Fifty new cards across the five factions whose
pure-Current leader had no pool, plus a `autoBuildDeck` fix for Prism-native
leaders. `Flow` also now implements all four of its canonical channels — it fired
on one of them, so every card printed with the keyword had been promising three
triggers it did not have.

**Story chapters are done as a system.** Chapter 1 ships; the format, the
compiler, the runner, the screens, the writer's guide and the checker are all in
place, and a broken chapter now reports itself on the story screen rather than
taking the game down. What remains is prose.

**The eight missing boss twists are done.** All ten faction bosses now ship with
a working twist, each a passive on its own leader card. The ops they needed were
deliberately written as general vocabulary rather than boss hooks — `revive`,
`rotateLeaderCurrent`, `modifyTriggeringCardCost`, `highestCost`/`lowestCost`
targeting, `scry` with a stated pick rule, and four new triggers — so ordinary
cards can use them too. This also unblocks Doomscroll acts 3–4, which were
waiting on exactly these twists.

---

## Working rules for whoever continues this

- `docs/design/00-core-rules.md` and `docs/tech/00-architecture-contract.md` are
  **canonical**. If new work contradicts them, the new work is wrong — or the
  canon needs an explicit, deliberate edit.
- If a doc and `src/engine/types.ts` disagree, **types.ts wins**. It is what runs.
- Never put rules logic in the UI. The UI sends intents and renders events.
- Never add randomness outside the seeded RNG in `src/engine/rng.ts`. It breaks
  replays, and replays are load-bearing for the future server.
- Run `npm test` and `npm run verify:ui` before considering anything done.
- **Playwright's `waitForFunction` takes its options third**, after the page
  function's argument: `waitForFunction(fn, null, { timeout })`. The two-argument
  form compiles, runs, and silently ignores your timeout. All 18 call sites in
  `scripts/` had it wrong; check any new one.
- **The profile store writes on a 250ms debounce.** A browser check that reads
  `localStorage` immediately after a write is reading the state from before it.
  Call `flushAllStores()` first. This has produced **three** false results so
  far, and the third was the worst: it was not a failure but a silent *pass*, in
  `seedPlayedAccount`, where a direct `localStorage` write was overwritten by the
  in-flight save during the reload and every browser script quietly ran against
  20 cards instead of 245. **Seed through the store, never through the key.**
- **`import("/src/…")` inside `page.evaluate` is not the module the app is
  using.** After any source edit Vite serves that module under an HMR-stamped
  URL, and a bare specifier instantiates a **second copy with its own store
  cache**. Both write the same `localStorage` key, so nothing looks broken — the
  screen simply keeps scoring against the state it already had. This cost a whole
  step of `verify:missions`, which reported "no mission completed even against a
  maximal match" while the profile plainly held 81 outcomes. Either drive the app
  through its `window.hypebound*` hook, or **`flushAllStores()` and reload** so
  `localStorage` collapses the two instances back into one. Both mission and
  mastery scripts now do the latter.
- **Run the browser verifications with nothing else running, and believe the
  lone run.** Every one of the fourteen passes on its own and back to back, but a
  `npm test` or a `tsc` alongside them is enough to push the two longest —
  `verify:ui` and `verify:doomscroll` — past a step timeout. Five "failures"
  across this session were all the same mistake, and none was a real defect.
  Worst of all is the **mutation harness**, which writes broken source to disk
  and restores it afterwards while Vite serves whatever is on disk at the moment
  it is asked.
- **A mutation that changes nothing is not proof of anything.** If a deliberate
  break is caught by zero tests, the honest first question is whether the code it
  broke was reachable at all. Three times now the answer has been no: an
  overwritten line, a constraint the shipped data cannot violate, and a guard
  that another guard already covered. In each case the fix was to make the
  mutation real — a fixture that *can* violate the rule, a pool that *is* missing
  a rarity, both guards removed at once — not to weaken the claim.
- **A fixture seeded from `Date.now()` is a fixture that fails one run in five.**
  The mission rotation is clock-seeded, and a freshly issued mission takes
  `issuedAt: now`, so forged evidence must cover the whole space *and* be stamped
  after the sync. Run a new test eight times before believing it.
