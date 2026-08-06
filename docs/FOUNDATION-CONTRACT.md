# The foundation contract

Eight independent audits of HYPEBOUND asked, unprompted, for the same twelve
primitives. That convergence is the specification. This file is the binding
version of it: **exact names, exact signatures, exact values.**

Everything downstream — fifteen builders working in parallel across the battle
board, the card canvas and forty-nine DOM screens — consumes these and only
these. A builder who invents their own bevel has broken the contract even if
their bevel is prettier.

## The five modules, and who owns what

| # | Module | File(s) — sole owner | Provides |
|---|--------|----------------------|----------|
| A | **Surfaces** | `src/ui/theme/foundation.css`, plus the `@import` line in `base.css` | materials, radii, type roles, focus, scrollbars, form controls, interaction states |
| B | **Textures** | `src/ui/art/texture.ts` | canvas-generated grain, soft masks, bevels, contact shadows, gradients — for CSS *and* three.js |
| C | **Icons** | `src/ui/art/uiIcons.ts` | one inline SVG set, 24px grid, single stroke weight |
| D | **Motion & format** | `src/ui/motion.ts`, `src/ui/format.ts` | easing/duration tokens mirrored in JS, `stagger`, `tickerTo`, reduced-motion guard, en-GB formatters |
| E | **Continuity** | `src/ui/theme/transitions.css`, `src/ui/atmosphere.ts`, and `src/ui/shell.ts` | the persistent world behind the UI, and every screen-to-screen transition |

**No module edits another module's files.** Module A owns `base.css`; nobody else
touches it. Module E owns `shell.ts`; nobody else touches it.

---

## 0. The one global decision: where the light comes from

**The key light is at the top-left, everywhere, forever.** 315°, in both CSS
gradient terms and three.js world space. Every rim highlight is on the top and
left edges; every inner shadow and every contact shadow falls to the bottom-right.

This is the single most load-bearing line in this document. Two adjacent panels
lit from different directions is the defect that reads as "amateur" before a
viewer can say why, and it is the one thing fifteen parallel builders will get
wrong unless it is stated as a constant.

Module B exports it as `LIGHT_RIG`; module A exports it as `--light-angle`. They
must agree, and there is a test asserting they do.

---

## A. Surfaces — `src/ui/theme/foundation.css`

### A1. Materials

Four, and only four. Every surface in the game is one of these. No free-form
`background:` on anything bigger than an icon.

```css
.mat-hero    /* the one hero action per screen: PLAY, confirm, claim */
.mat-panel   /* structural furniture: panels, rails, tiles, cards */
.mat-chip    /* small inline objects: currency chips, badges, tags */
.mat-well    /* recessed: inputs, progress tracks, empty slots, sockets */
```

Each is a class *and* a custom-property bundle, so it can be applied by
composition (`class="mat-panel"`) or inlined into another rule.

Every raised material carries, in this order:

1. a two-stop gradient along the 315° light vector, top-left lighter
2. `inset 0 1px 0 rgba(255,255,255,α)` — the lit rim
3. `inset 0 -1px 0 rgba(0,0,0,β)` — the unlit lip
4. a soft drop shadow
5. **a tight 2px contact shadow** — this is what makes it an object rather than a rectangle
6. grain from module B at 3–5%

`.mat-well` inverts 1–3: the inner shadow is at the top-left, the faint rim light
at the bottom-right, and it casts nothing.

Amplitudes: hero 1.0, panel 0.55, chip 0.35, well 0.7. One scale, so a hero and a
chip are recognisably the same material family at different ranks.

### A2. Radius by role

Literals are banned. Pick by what the thing *is*:

```css
--r-chip: 999px;   /* pills and chips only */
--r-tile: 14px;    /* tiles, rows, list items */
--r-panel: 18px;   /* panels, modals, plates */
--r-field: 10px;   /* inputs and wells */
--r-nested: calc(var(--r-panel) - var(--sp-2));  /* anything inside a panel */
```

A content tile must never inherit `.btn`'s pill radius. That is currently happening.

### A3. Type roles

Five, each with its own size, weight, tracking and colour:

```css
.t-display   /* -0.02em tracking */
.t-heading
.t-body
.t-label     /* uppercase, +0.08em tracking */
.num         /* font-variant-numeric: tabular-nums; fixed-width slots */
```

`.num` is mandatory on every number a player reads under pressure — cost, power,
health, timer, currency, mission progress. A number that reflows when it gains a
digit is a defect.

Faces must be **self-hosted OFL or already on the device**. Nothing is
downloaded; the privacy screen promises this build fetches nothing, and that
promise is not negotiable for a font.

### A4. Interaction states

One mixin, six states, applied by composition. Never hand-rolled.

- **rest**
- **hover** — `translateY(-2px)`, `scale(1.015)`, rim amplitude doubled, contact shadow tightens, a 140ms specular wipe. 120ms.
- **active** — `scale(0.985)`, lift to 0, inner shadow. 80ms.
- **focus-visible** — see A5.
- **disabled** — changes fill *and* border *and* icon, never opacity alone, contrast held ≥ 4.5:1.
- **loading** — skeleton shimmer or an in-world meter, never a spinner.

An opacity-only disabled state and an opacity-only hover are both contract
violations.

### A5. The focus ring

It **inherits the host element's own `border-radius`** — the current one
hard-codes `--radius-sm` and draws a rectangle around pill buttons. Double
stroke: 2px accent inner, dark halo outer, 120ms scale-in. Honours the existing
`--focus-width` and `data-focus-ring` settings.

### A6. Scrollbars and form controls

Bound to the **body layout, not to an opt-in class.** No route may ever scroll
with OS chrome, and none may render an OS widget.

`.field .select .checkbox .switch .slider .textarea` — all `appearance: none`,
chevrons and ticks and knobs drawn in CSS or an inline `data:` SVG, all six
states from A4. The Custom Lobby currently shows five white Windows `<select>`
boxes on a neon-black screen; that is the bar this exists to clear.

### A7. Fading dividers

`.hairline` — alpha ramps to zero across the outer 15% at each end. §7 makes
end-fading a rule; dividers that butt hard into a panel edge are a violation.

---

## B. Textures — `src/ui/art/texture.ts`

Canvas-generated, memoised, zero dependencies, zero network. Every function
returns **both** forms where both are meaningful, because the DOM HUD and the 3D
mat must share literally the same grain:

```ts
export const LIGHT_RIG: {
  cssAngle: 315,
  world: THREE.Vector3,      // normalised, matches cssAngle
  key: number, fill: number, rim: number,
};

grainDataUri(size?, amount?, seed?): string          // → --tex-grain
noiseTexture(opts): THREE.CanvasTexture              // same generator, three side
softMask(opts): THREE.CanvasTexture                  // superellipse alpha falloff
softMaskDataUri(opts): string                        // ...and its CSS mask-image
bevelStrip(opts): { texture, boxShadow: string }     // one edge treatment, both worlds
contactShadow(opts): { texture, css: string }
fadeStrip(taper): { texture, maskImage: string }     // the divider primitive
rimGradient(ctx, rect, palette, tier): CanvasGradient
studioEnvironment(renderer): THREE.Texture           // memoised PMREM from a canvas gradient
currentGlow(currentId, intensity): { css: string, emissive: THREE.Color, bloom: number }
```

Memoise everything by argument key. These are called per-frame by careless
callers and must cost nothing the second time.

`scaledAsset(path, targetPx)` also lives here: nineteen 512px PNGs are currently
drawn straight down to 28px every frame.

---

## C. Icons — `src/ui/art/uiIcons.ts`

**One** set. 24px grid, **1.75px** stroke, `currentColor` only, 2px optical
padding, inline SVG symbols — no font, no network, no per-icon PNG.

Deleting these is part of the job:

- Unicode glyphs used as icons (`▦ ✦ ✉ ◈ ◇ ⚗ ☠ ✋ ▤ ✖ 🔒 🔓 ←`) — they render in
  whatever font the OS has, at the wrong weight, and become tofu where the code
  point is missing.
- One-off per-icon PNGs in mismatched styles.

Coverage required: 9 lobby destinations, 14 modes, both currencies, the gear,
hand/deck/discard/reaction/armour, Hype, Obsession, emote, concede, search,
close, chevrons, plus/lock/star/check/crosshair, and the keyword glyphs.

**Practice vs AI and Casual Match currently share a shape.** Every icon must be
distinguishable from every other icon at 24px.

---

## D. Motion & format

### D1. `src/ui/motion.ts`

The tokens exist in CSS *and* in JS, from one source, because three.js and canvas
cannot read a custom property:

```ts
export const DUR  = { micro: 110, ui: 260, setpiece: 700 } as const;
export const EASE = {
  arrive:    [0.2, 0.8, 0.2, 1],
  overshoot: [0.34, 1.56, 0.64, 1],
  leave:     [0.4, 0, 1, 1],
} as const;

stagger(nodes, { step = 45, from = 0 }): void   // writes --enter-delay
tickerTo(el, value, ms?): void                  // counts up, tabular
motionEnabled(): boolean                        // reads settings once
onMotionFrame(cb): () => void                   // ONE shared rAF, paused when hidden
```

`stagger` is a no-op under reduced motion. `onMotionFrame` exists so fifteen
builders do not start fifteen render loops.

Mirror `DUR`/`EASE` into `--dur-*` / `--ease-*` in module A. A test asserts the
two agree.

### D2. `src/ui/format.ts`

Pinned to **en-GB**, dates in UTC. Eleven call sites currently pass `undefined`
as the locale and print French months inside English sentences.

```ts
num(n), count(n), date(d), dateTime(d), duration(ms), plural(n, one, many)
```

---

## E. Continuity — the world behind the menus

This module implements **§3a of the AAA bar** and it is the difference between a
set of screens and a game.

### E1. `src/ui/atmosphere.ts` — a persistent world

A single background layer that lives **outside the screen router** and is never
unmounted. Navigation must never blank to void. It owns the ambient wash, the
drifting grid, the slow pulse, the specular sweep and the mote field, and it
accepts a per-route accent so each destination feels like a different room in one
continuous place.

Every screen then gets four depth planes for free (§2), instead of each screen
re-implementing two.

### E2. `src/ui/theme/transitions.css` + `shell.ts` — transitions that mean something

Replace the single shared `screen-in` keyframe — one 10px rise and a fade,
currently identical for all 49 routes — with relationship-aware transitions:

- **descend** (lobby → child): parent recedes, scales down, darkens and blurs;
  child rises over it. **ascend** reverses it exactly.
- **sibling**: slide along one consistent axis. Left is always left.
- **curtain** (lobby → battle): the big one.

Rules: 260–420ms. 80–120ms of overlap between outgoing and incoming — never
out-then-in. **Never a blank frame.** Input accepted as soon as the incoming
screen is visible, mid-animation included. Only `transform`, `opacity`, `filter`.
Reduced motion collapses all of it to a fast fade with every screen fully usable.

`shell.ts` needs a route relationship table to know which transition applies.

---

## Hard constraints

- **£0.** No paid anything, ever.
- **New runtime dependencies are allowed** when they genuinely buy visual quality
  or performance. See "Dependencies" below for what a good one looks like.
- **Nothing is fetched at runtime.** This is the constraint that actually binds,
  and it is a promise the product makes on screen: the privacy screen states
  there is no analytics SDK in the build and that the game keeps working offline.
  A dependency installed from npm and bundled by Vite honours that. A CDN
  `<script src="https://…">`, a Google Fonts link, or a library that phones home
  does not.
- **Reduced motion, contrast and keyboard focus all keep working.** They are
  already implemented and must not regress.
- **30fps low tier, 60fps high.**
- **Nothing regresses.** 1,713 tests and the `verify:*` scripts are the contract.
  Pretty and broken is broken.
- Additive only, this phase: **create the primitives, do not rewire consumers.**
  Screens are migrated in the next wave, deliberately, one domain at a time.

---

## Dependencies

The original rule here was "no new runtime dependencies, `three` and `zod` is the
whole list". That has been lifted: **add a library when it genuinely buys visual
quality or performance.** Hand-rolling a worse version of a solved problem is not
a virtue, and several things this project wants — a properly merged
post-processing chain, SDF text in 3D — are a lot of work to do badly and very
hard to do well.

What still has to be true:

1. **Free, with a permissive licence.** MIT, Apache-2.0, BSD or ISC without
   thinking about it. Anything else — custom licences, "free for now", anything
   with a commercial tier — gets raised before it is installed, not after.
2. **Bundled, never fetched.** Installed from npm and built by Vite. No CDN
   script tags, no runtime font or asset downloads. The game must keep working
   offline, because the privacy screen says it does.
3. **No telemetry.** Nothing that phones home, and no analytics SDK. Same screen,
   same promise.
4. **It must pay for its weight.** This ships to GitHub Pages and first load
   matters. A library that saves a day of work and costs 300KB on the critical
   path is a bad trade; the same library lazy-loaded behind the battle route may
   be a good one.
5. **The performance floors still hold.** 30fps low tier, 60fps high. A
   dependency that makes the code prettier and the frame time worse is a
   regression.
6. **`server/` stays clean.** The Workers bundle must remain DOM-free and
   dependency-light — there is a portability test enforcing it.

Say what you added and why in your return value, so it can be reviewed rather
than discovered.

### Worth considering

- **`postprocessing`** (pmndrs, MIT) — the strongest candidate. `scene.ts`
  currently chains `EffectComposer` → `RenderPass` → `UnrealBloomPass` →
  `OutputPass`, which costs a full-screen blit per pass. This library merges
  effects into a **single** fullscreen pass and ships better bloom, SMAA,
  vignette, grain, chromatic aberration and tone mapping. It is faster *and*
  better looking, which is the rare case where the trade is not a trade — and it
  is exactly the "one shared GradePass" the battle audit asked for.
- **`troika-three-text`** (MIT) — signed-distance-field text in three.js. Only if
  the opening cinematics need crisp 3D type; canvas textures are fine for
  anything static.
- **A DOM animation library** (`motion`, MIT and WAAPI-backed; or GSAP, free,
  stronger timelines) — genuinely useful for §3a set-pieces. Note that
  `src/ui/motion.ts` already provides tokens, `stagger`, `tickerTo` and one
  shared rAF, so this is only worth it if sequenced set-pieces — pack openings,
  reward flights, the curtain — turn out to need real timelines. Do not add it
  and then leave two animation systems in the codebase.
