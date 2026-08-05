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

## The one thing worth fixing first

**The shell blocks the main thread for exactly the window each transition
occupies**, so three separate domains lose motion marks for one cause. Four
independent instruments agree. `docs/recon/navigation-stall.md` has the
attribution and a four-part fix.

**No wave-2 track owned `src/ui/shell.ts` or `transitions.css`** — that is why it
survived two waves. Wave 3 must give the shell an explicit owner.

Already done toward it: `HEAVY_BUILD_MS` lowered 220 → 60 so the compositor
curtain covers the legs players actually use.

## Guard tests — run these before believing anything

```
npx vitest run tests/one-sun.test.ts tests/material-contrast.test.ts \
  tests/camera-truth.test.ts tests/card-light.test.ts \
  tests/never-a-blank-frame.test.ts tests/texture-light-rig.test.ts
```

Known failing, deliberately left for the domain that owns the file:

- `one-sun` — five oblique gradients in `screens.css` (~171, 172, 3349, 3601, 6287)
- `card-light` — one private gradient in `renderCard.ts`
- `never-a-blank-frame` — `lobby → missions` still blocks in the open
- `texture-light-rig` — a grain rank claimed twice

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

1. **The shell.** `src/ui/shell.ts` and `transitions.css` belonged to no track in
   either wave, which is why the stall survived both. It suppresses motion marks
   in at least three domains at once, so it is the highest-leverage item left.
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
