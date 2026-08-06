# Visual overhaul — where it is, and how to pick it up

Written so a session that ends mid-flight costs a resume command and not a day.
Update it whenever a wave finishes or a score changes.

## How to resume

Everything runs as background workflows. A killed agent's **code is already on
disk** — every usage limit so far has killed agents while writing up, never
before writing — so the recovery is always: commit what is there, then resume.

```
# 1. dev server (agents and every capture need it)
npm run dev

# 2. is the tree sound?
npx tsc -p tsconfig.json --noEmit

# 3. commit whatever the killed agents left, then resume the run
Workflow({ scriptPath: "<from the run's launch output>", resumeFromRunId: "<runId>" })
```

Completed `agent()` calls replay from cache instantly; only the killed ones and
everything after them re-run. Read the run's `journal.jsonl` before assuming a
cached result was non-empty.

**Wave 2 run id:** `wf_11f16ef3-a36`
**Script:** `…/workflows/scripts/hypebound-wave2-wf_11f16ef3-a36.js`

## The standard

- `docs/AAA-BAR.md` — the bar. **9/10 passes; 7–8 ("good indie") is an explicit
  fail.** §3a is menu animation, §8 is how a critic reviews, §10 is out of scope.
- `docs/FOUNDATION-CONTRACT.md` — exact primitive names and signatures. **The key
  light is 315° everywhere**, enforced by `tests/one-sun.test.ts`.
- `docs/recon/*.md` — the original per-domain audits, plus `navigation-stall.md`.

## Scores

Recon baseline was **4.2/10 average, 146 defects, 38 critical**.

| Domain | Recon | Now | Notes |
|---|---|---|---|
| Card renderer | 5 | **8/8** | frame carries a card with no art |
| Front door | 4 | **7/7** | 21/21 audited defects fixed, no regressions |
| Front door finish | — | **8/6** | sign-in/queue void 60%→27% |
| Battle board | 4 | **7/5** | rectangle gone, arena furnished |
| Rewards | **3** | **7/7** | pack opening now exists |
| Cinematics | none | **7/4** | both sequences built |
| Collection | 5 | **7/4** | search block was 2,499.6ms per keystroke |
| Battle motion | 4 | **8/5** | hand re-deals itself 28× per AI turn |
| Data screens | 4.5 | **never judged** | its critic died in all three limit windows |

Wave 2 produced six verdicts across five tracks — the cinematics were judged
twice (7/4 both times) and **the data screens never once**. Treat 4.5 as their
current score, because nothing has confirmed otherwise.

Nothing has reached 9. The average across judged domains is about 7.3, from a
4.2 baseline, with no domain below where it started and one critic explicitly
confirming zero regressions against 21 audited defects.

## The one thing worth fixing first — done, wave 3

**The shell blocked the main thread for exactly the window each transition
occupied.** `docs/recon/navigation-stall.md` has the original attribution and
a postscript recording what the fix turned out to be.

`HEAVY_BUILD_MS` is **220 again** and the node-count prior is gone. Lowering it
to 60 was the wrong axis: it handed a cover to four of the five most-travelled
legs, and the cover measured *darker* than the transition it was hiding (47% of
the reference mean and 24% of its 95th percentile on `lobby → play`, against
80%/55% for the same leg uncovered). It also concealed itself, because
`never-a-blank-frame` skips its pixel check on a veiled leg.

What actually fixed it: the entrance cascade's selectors were forcing Blink into
whole-subtree invalidation on every attribute *and every class* change on a
screen root — 23ms on the lobby, 42ms on the Collection, and 12–22ms for a class
that matches nothing anywhere in the app. `shell.ts::markCascade` now names the
containers and risers on the detached tree at mount, `transitions.css` §2.7 keys
off those attributes, and the queued teardown moved from the top of `handleHash`
to *after* the hold has been composited.


## Wave 8 — the invariant is right, the numbers proving it are not

The room is a property of being a screen now: `shell.ts::dressScreen` on the one
funnel every route passes through, layers in `transitions.css` rather than
`hall.css` (which is reached only via `kit.ts`, so a room defined there would
have given 49 screens seven invisible `<div>`s and no error anywhere).
`.ambient-bg` paints nothing. `tests/every-screen-is-a-room.test.ts` and
`tests/room.test.ts` hold 53 assertions. **That part stands.**

**The evidence does not, and this is instrument eleven.**
`_w7rw_probe.mjs::idle` samples with `screenshot()` then `waitForTimeout(200)`.
One 1600x900 screenshot costs ~620ms, so the real grid is **~830ms against a
floor written for 200ms**. It and the wave's own sweep both calibrated their
*arithmetic* against `hearthstone_frames/` and neither calibrated the *grid* —
calibrating a metric is not calibrating a sample interval.

So **every idle figure published through that path is an ~830ms number wearing a
200ms label**, including the 0.88–1.89 vs 0.18–0.71 split wave 8 was launched to
fix, and including the gate inside `every-screen-is-a-room.test.ts`. First
instrument error here to propagate into a committed test.

## BLOCKING: a touch player cannot start a match at 160% text

At **844x390 with `--ui-scale 1.6`**, the mulligan's Confirm button sits **32px
below the fold and cannot be reached**. The overflowing ancestor is
`overflow: hidden`, so a real `mouse.wheel` and a real `scrollBy` both move it
**exactly 0px**.

Every automated check passed it because **Playwright's `.click()` calls
`scrollIntoViewIfNeeded` first.** A finger does not. The remix mulligan loses 32
of the same button's 44px at *default* scale.

Third unreachable control this effort has found — after the lobby's Inbox badge
and the deck builder's Save Deck — and the first that stops play outright. All
three rendered perfectly, just past an edge.

## Also outstanding after wave 8

- **Build cost, not the curtain.** Entering the three heavy children runs at
  11.5–28.8fps (gallery 1066ms of long tasks, deckbuilder 692ms, collection
  547ms) against §9's 30fps floor. Legs measure 473–944ms against a 260–420ms
  budget, and descend/ascend are not reverses (473ms out, ~900ms back). The
  curtain is the symptom; `shell.ts` veils anything over `HEAVY_BUILD_MS`, so
  making those three build incrementally removes it everywhere at once.
- **The mat is still a rectangle** — a much better one, but nothing crosses the
  boundary in either direction. `hearthstone_frames/frame_00060` has foliage over
  the rim in six places, rocks breaking the bottom-left, a waterfall on the
  border.
- **No contact shadow anywhere in the pack-opening room**, on the hero object of
  the whole reward moment, and all five cards flip at once so the per-card click
  has nothing to click.
- `_w6scale_sweep.mjs` reports 39 clips of which ~1 is real; it counts the
  `.board-mirror` a11y mirror and collapsed `<details>`. The one genuine finding
  was buried under 25 clips and 38 overlaps of noise.

## Guard tests — run these before believing anything

```
npx vitest run tests/one-sun.test.ts tests/material-contrast.test.ts \
  tests/camera-truth.test.ts tests/card-light.test.ts \
  tests/never-a-blank-frame.test.ts tests/texture-light-rig.test.ts
```

As of the wave-3 shell pass: `one-sun`, `card-light`, `material-contrast`,
`camera-truth` and **`never-a-blank-frame` (10/10)** all pass.

Still failing, and still nobody's:

- `texture-light-rig` — a grain rank claimed twice
- `no-orphan-ui` — 40 exported functions with no caller outside their own file,
  spread across `art/`, `cardRenderer/`, `battle/` and `screens/`. Two were in
  `shell.ts` and are now module-private; the rest are the wiring pass.

## Measurement is the hard part — five instruments have lied so far

Every one produced a confident wrong answer rather than an error. Distrust the
instrument before the work.

1. **`--use-gl=angle --use-angle=swiftshader`** capped the camera at 1.6fps, so
   four rounds of motion review saw "consecutive frames identical". Fixed in
   `shot.mjs` and 44 other scripts. `tests/camera-truth.test.ts` guards it.
2. **`--hide-scrollbars`** erased the styled scrollbar; a review concluded forty
   lines of CSS were dead.
3. **`?nointro` missing from `shot.mjs`** meant every capture had the title card
   composited over it — and because the overlay is a sibling of `#app` with the
   game live underneath, every wait and selector still resolved.
4. **An fps probe inside a long-lived `page.evaluate`** reported 9–19fps for a
   page running at 75. Caught by the agent that wrote it.
5. **A grain measurement that cropped over button text** read 18.5% when the real
   figure was 2.36%. Sample text-free regions.

Also: **rAF gap traces cannot see a compositor curtain.** rAF runs on the main
thread, so it reports blocking whether or not the player sees anything wrong.

## Tools

```
node scripts/shot.mjs <route> --out <name> --dir <dir>
    --size WxH --wait ms --clip <sel> --frames <n>x<ms> --freeze <ms>
    --eval "<js>" --raw (new account) --battle (into a live board) --intro (let it play)

node scripts/ab.mjs a.png b.png --out name --seed 7 --label "..."   # blind A|B
node scripts/ab.mjs --reveal name --pick A                          # who won
```

`hearthstone_frames/` holds 204 frames of real gameplay at 1920×1080. Gitignored,
on disk, and the comparison the bar is written against. Open it rather than
describing Hearthstone from memory.

## What wave 3 must own

1. ~~**The shell.**~~ Done. `src/ui/shell.ts`, `transitions.css`,
   `intro/matchCurtain.*` and the Collection's cell build. Instruments left
   behind: `scripts/_w3nav_probe.mjs` (five measurements on one navigation),
   `_w3nav_cost.mjs` (per-route build cost), `_w3nav_curtain.mjs` (does the
   cover move, and does it cover), `_w3nav_split.mjs` (what an attribute write
   costs), `_w3nav_a11y.mjs`, `_w3nav_sweep.mjs`, `_w3nav_film.mjs`.
2. **A wiring pass.** Parallel file ownership severs wires that cross between
   owners; `tests/no-orphan-ui.test.ts` now watches for it, and its symbol half
   currently lists seven unadopted `uiIcons.ts` exports.
3. **The data screens**, which were built but never reviewed.
4. **Carry-forwards**, the largest being: the hand replaying its entrance 28
   times per AI turn (`handBar.sync()` re-appends every node, restarting the
   CSS entrance, and `hand-card-in`'s bare `from` transform wipes the fan's
   rotation); a 459ms main-thread block in the mulligan curtain; and the pass
   screen's LIST toggle, which lays out 7,304px wide and puts its own way back
   off-screen.

## Still untouched

- **Wave 3**: the shell owner, plus whatever wave 2 leaves short.
- **Final sweep**: re-shoot every route, completeness critic, and the full
  1,713-test suite — which has **not** run since this work began. That is the
  real gate, and it is deferred deliberately, not forgotten.
- **Pre-existing, unrelated**: the attack-drag flake (unreproducible in ~14 runs,
  now self-diagnosing) and the balance spread (23.9%–77.4%, 56.3% first-seat
  advantage).

## Rules that keep getting relearned

- **Card art coverage is not a defect.** ~120/296 painted, hand-authored, still
  arriving. Never score it, never generate art. §10 of the bar.
- **Dependencies are allowed** if free, permissive, bundled by Vite and worth
  their weight. `postprocessing` (Zlib) is in. Nothing may be fetched at runtime.
- **Never credit the assistant in the repository.**
