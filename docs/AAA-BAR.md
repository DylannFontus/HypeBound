# The AAA bar

The single standard every visual change in HYPEBOUND is held to. Builders build
to it; critics judge against it and nothing else. It exists so that fifteen
people working in parallel produce **one game** rather than fifteen good-looking
screens that share no language.

The comparison set is **Hearthstone**, **Magic: The Gathering Arena** and
**Gwent**. We are not copying any of them. HYPEBOUND is neon nightlife, not
Azerothian wood or Nilfgaardian parchment. What we take is the *level of craft*:
the fact that in all three, every single pixel was decided by somebody.

---

## 0a. There is real reference material in the repo

`hearthstone_frames/` holds **204 frames of actual Hearthstone gameplay**, 0.2s
apart, 1920×1080. It is gitignored (it is Blizzard's art and must never be
committed) but it is on disk and you should **look at it**.

Do not describe Hearthstone from memory when you can open it. Read a few frames
before reviewing anything, and read them again when judging motion — consecutive
frames show exactly how long a Hearthstone animation takes and what moves with it.

What frame 60 alone establishes, and what we currently fail:

- **The mat and the world are one painted object.** Carved stone edges, foliage
  growing over the rim, a waterfall spilling onto the border, rocks breaking the
  silhouette. There is no rectangle anywhere on that screen. Ours is a rectangle.
- **The playfield is a lit surface**, warm and textured, with light falling
  across it. Ours is a flat fill with a hex pattern.
- **Every element is framed** in metal, wood or gold, with bevels and inset gems.
- **Board units are substantial** — large framed medallions, readable at a glance.
  Ours are tiny rectangles.
- **The hand tucks behind the mat's lower edge** rather than floating over the
  player's own UI.
- **Resources are physical objects** — mana crystals you could pick up, a deck
  that is a real stack of cards with thickness.

## 0. The one-sentence test

> Screenshot it, put it beside a screenshot of Hearthstone or Gwent, and show
> both to someone who has never heard of either. If they can tell which one is
> the indie project, it fails.

That is the whole bar. Everything below is just the common ways we fail it.

---

## 1. Nothing is flat

The fastest way to read as amateur is a flat fill. Real surfaces in all three
reference games carry, at minimum:

- **A gradient with a light source.** One consistent key light per screen. If
  the top edge of one panel is lit and the top edge of the next is not, the
  screen has two suns and the eye notices even when the viewer cannot say why.
- **An edge treatment.** A rim highlight where light catches, a darker inner
  shadow where it does not. 1px of `rgba(255,255,255,0.08)` on the top edge and
  1px of black at the bottom is the cheapest possible version and already beats
  a plain border.
- **Texture.** Film grain, noise, brushed metal, fabric weave, dust, condensation
  — *something* at 2–6% opacity so the surface is not mathematically smooth.
  Perfectly clean gradients read as CSS. Reality has dirt.
- **Contact shadow.** Anything sitting on top of anything else casts. A panel
  floating with no shadow is a rectangle; a panel with a soft 24px drop and a
  tight 2px contact shadow is an object.

**Banned outright:** a solid `background: #hex` on any surface larger than an
icon. A `border: 1px solid` as the only edge treatment. A drop shadow with no
corresponding highlight.

---

## 2. Depth is built, not implied

Every screen must have at least **four** resolvable depth planes:

1. **Atmosphere** — the furthest layer. Moves least. Often a painted or rendered
   backdrop, always darkened and desaturated relative to the foreground.
2. **Midground** — structural furniture. Board mat, header rail, side columns.
3. **Content** — the thing the player is actually reading or clicking.
4. **Overlay** — modals, toasts, drag ghosts, the cursor's own effects.

Separation between planes is carried by **blur, desaturation, scale and
parallax**, not by z-index alone. If the backdrop is as sharp and as saturated as
the card in front of it, there is no depth, only stacking.

**Specific to this game:** the battle backdrop art is beautiful and is currently
~80% covered by an opaque mat with a hard rectangular edge. A mat must feel like
*ground inside the place*, not a panel dropped on a photo. Bleed it, light it,
let the environment reach onto it.

---

## 3. Motion has physics

Nothing snaps. Nothing moves linearly. Nothing moves at the same speed as
everything else.

- **Easing is expressive.** `cubic-bezier(0.2, 0.8, 0.2, 1)` for things arriving,
  a slight overshoot for things the player caused, a sharper `ease-in` for things
  leaving. Linear is for progress bars and nothing else.
- **Durations are tiered.** Micro-feedback 80–140ms. UI transitions 200–320ms.
  Set-pieces 500–900ms. A card play caps at 600ms and a Confluence at 1200ms —
  these are already in the art docs and they stand.
- **Everything overlaps.** Sequential animations that wait for each other feel
  like a slideshow. Stagger by 30–60ms per element.
- **Secondary motion.** When the main thing moves, something small moves because
  of it — a highlight sweeps, dust lifts, a shadow stretches. This is the single
  biggest gap between "animated" and "alive".
- **Idle is never dead.** A screen with nothing happening still breathes: slow
  ambient drift, a gentle specular crawl, motes. 3–8 second periods, very low
  amplitude, never distracting.

`prefers-reduced-motion` must kill the decorative layer and keep the functional
one. That is a hard requirement, not a nice-to-have.

---

## 3a. Menus are animated, and so is the space between them

This is its own section because it is its own failure. A game can have a
spectacular battle board and still feel cheap the moment you open a menu — and
menus are where the player spends most of their time. **Every menu in HYPEBOUND
must be as animated as the board.**

The current state is the thing to beat: `shell.ts` fades an outgoing screen out
over 200ms while the incoming one runs a single shared `screen-in` keyframe — one
10px rise and a fade, identical for all 49 routes. That is a placeholder, not a
transition.

### The transition between two menus

- **A cross-fade is not an answer.** A cross-fade is what you use when you have
  nothing to say about the relationship between two screens. There is always a
  relationship, and the transition should state it:
  - **Descending into a child** (lobby → collection): the parent recedes — scales
    down slightly, darkens, blurs — and the child rises over it. Going back
    reverses exactly, so the player's sense of where they are survives.
  - **Sibling to sibling** (collection ↔ deck builder): slide along a shared axis,
    consistently. Left is left every time.
  - **Entering the game** (lobby → battle): the big one. It should feel like a
    curtain going up, not a route change.
- **Overlap the two screens.** Old leaves while new arrives, sharing 80–120ms.
  Sequential out-then-in is what makes a UI feel slow even when it is fast.
- **Shared-element continuity wherever it exists.** Click a card in the collection
  and *that card* grows into the detail view. Press PLAY and the active-deck panel
  becomes the mulligan. When two screens contain the same object, that object must
  not blink out of existence and reappear somewhere else.
- **Budget 260–420ms.** Long enough to read as deliberate, short enough that
  clicking through five menus never costs the player time. Over 500ms on routine
  navigation is an obstacle.
- **Never a blank frame.** No moment where neither screen is drawn, and no moment
  where the page background flashes through.

### Inside a menu

- **Contents stagger in.** Panels, rows, tiles and cards arrive on a 30–60ms
  cascade in reading order, not all at once. This single change is the biggest
  perceived-quality gap between a hobby menu and a shipped one.
- **The screen is alive at rest.** Slow gradient drift, a specular sweep crossing
  a panel every few seconds, motes, a breathing glow on the primary action. Low
  amplitude, long periods, never competing with content.
- **Numbers count up.** Currency, XP, records, mission progress — animated to
  their value, not printed. Rewards especially.
- **Lists and grids react.** Hover lifts and lights a tile and its neighbours give
  way very slightly. Filtering re-flows with a transition rather than a jump.
- **Everything that appears has an entrance; everything that leaves has an exit.**
  Toasts, modals, tooltips, dropdowns, badges, counters. Nothing pops.
- **Loading is part of the world.** No spinner. Where the wait is short, no
  loading state at all — hold the outgoing screen.

### What the reference games do

Judge menu work against them directly. Hearthstone's menus are physical objects
that slide, hinge and stamp, with weight and sound on every transition. MTG Arena
moves a persistent lit environment behind the UI so the camera appears to travel
between destinations. Gwent slides refined panels along a consistent axis over a
parallax backdrop that never cuts.

All three share one trait: **the space behind the UI is continuous.** Changing
screens feels like moving through one place, not swapping documents. That is the
target — a single persistent world behind the menus, with the furniture moving in
front of it.

### Non-negotiables

- Reduced-motion collapses all of it to a fast fade and leaves every screen fully
  usable. The tokens for this already exist in `base.css`.
- No transition delays input. The incoming screen takes clicks as soon as it is
  visible, mid-animation included.
- No transition drops frames on the low tier. Animate `transform`, `opacity` and
  `filter`. Never `width`, `top`, or `box-shadow` on a large surface.

---

## 4. Type is designed

- A real hierarchy: display / heading / body / label / numeric, each with its own
  weight, size, tracking and colour. Four sizes of the same weight is not a
  hierarchy.
- **Tracking matters.** Small caps labels get `+0.08em`. Big display type gets
  `-0.02em`. Default tracking on everything is a tell.
- Numbers that the player reads under pressure — cost, power, health, timer —
  are **tabular**, high-contrast, and never move when they change width.
- Text over imagery always has a scrim, a shadow, or a plate. Never raw.

---

## 5. Every state is designed

For every interactive element: **rest, hover, active/pressed, focus-visible,
disabled, loading, and error.** A hover that only changes `opacity` is not a
hover. The reference games move the element, light it, sound it and often scale
it — all three at once, in under 120ms.

Focus-visible must be *beautiful*, not the browser default ring. It is on screen
every time somebody plays with a keyboard.

Empty states are designed too. "You own no cards" is a moment to be charming, not
a blank grid.

---

## 6. Colour is disciplined

The palette in `base.css` is good and stays. What it needs:

- **Value structure.** Squint at the screen: it should resolve into clear light
  and dark masses. If everything is mid-purple, nothing reads.
- **Saturation is a resource.** The most saturated thing on screen should be the
  thing that matters most. Right now the background competes with the buttons.
- **Accent restraint.** One hero accent per screen. Everything else supports.
- Never signal by colour alone — that rule is already in the design system and
  it stays.

---

## 7. Craft details that separate tiers

These are the things nobody asks for and everybody notices:

- Rounded corners that are *consistent* and use a smooth superellipse feel, not
  three different radii on one screen.
- Icons on a single grid, single stroke weight, single optical size.
- Dividers that fade at the ends rather than butting hard into a panel edge.
- Scrollbars styled to match. A default OS scrollbar in a fantasy card game is a
  tear in the world.
- Loading that is part of the world, not a spinner.
- Sound and visual land on the *same frame*.
- Nothing ever pops in. Anything appearing has an entrance.

---

## 8. How a critic reviews

Critics are asked to be **harsh**, and harsh has a specific meaning here:

1. **Look at the screenshot before reading any code.** First impression is the
   product.
2. **Name the single worst thing.** Not a list — the one thing that most makes it
   look indie. Fixing that is worth more than ten small polish items.
3. **Compare explicitly.** "In Gwent this row would…" — a comparison you can name
   is a comparison you can act on. A vague "needs more polish" is a failed review.
4. **Score honestly out of 10**, where:
   - **1–4** — obviously a hobby project.
   - **5–6** — competent, clean, clearly not shipped by a studio.
   - **7–8** — good indie. A player would not complain. *Still a fail.*
   - **9** — indistinguishable from a funded studio release. **This is the pass mark.**
   - **10** — better than the reference on this specific element.
5. **A pass requires 9+.** A critic who cannot find something wrong is not being
   thorough; a critic who passes something at 7 has failed at their job. But a
   critic who withholds a 9 from work that genuinely deserves it is *also*
   failing — the loop has to be able to terminate.
6. **Never pass on a promise.** Judge the screenshot in hand, not the plan.
7. **A still cannot show motion, so do not review motion from a still.** §3 and
   §3a are half the bar and they are invisible in a single frame. Capture bursts
   and look at them in sequence:

   ```
   node scripts/shot.mjs collection --frames 8x60 --out enter    # entrance + stagger
   node scripts/shot.mjs lobby --frames 6x110 --out idle         # is it alive at rest?
   node scripts/shot.mjs lobby --eval "location.hash='#collection'" --frames 8x45 --out nav
   node scripts/shot.mjs lobby --freeze 120 --out mid            # pin every animation mid-flight
   ```

   If consecutive frames are identical, the thing does not animate — say so, and
   fail it. A screen that is beautiful and static does not pass this bar.
8. **Say the score out loud for motion separately from stills.** A domain can be
   9/10 frozen and 4/10 in motion, and reporting one number hides that.

---

## 9. Hard constraints

These override any aesthetic ambition:

- **£0.** No paid assets, fonts, services or APIs. Ever.
- **No new runtime dependencies** without explicit sign-off. `three` and `zod`
  are what we have. Everything else is hand-built.
- **Accessibility is not negotiable.** Contrast ratios hold, reduced-motion is
  honoured, keyboard focus is always visible, nothing is colour-only.
- **Performance floors hold.** 30fps on the low tier, 60 on high. A beautiful
  effect that drops frames is a bug, not a feature.
- **Nothing regresses.** The verify scripts and the 1,700-test suite are the
  contract. Pretty and broken is broken.
- Every screen still has to work at 1280×720 and on a phone in landscape.

---

## 10. What is deliberately out of scope

Judging these is a wasted review, and "fixing" them does damage.

### Card art coverage

The card paintings are hand-authored and **in progress** — roughly 120 of 296 at
the time of writing. That number is the artist's schedule, not a quality signal.

- **Never score art coverage.** A collection grid full of placeholders is
  evidence that art is being made, and nothing else.
- **Never generate, synthesise or fabricate card art** — not procedurally, not as
  a temporary fill, not for a demo, not to make a screenshot look better in a
  review. Art arrives one way: a PNG dropped into
  `public/assets/art/<card-id>.png`. Nothing else may write into that space.
- **Do not quietly downweight the placeholder either**, which is the opposite
  mistake. 176 cards wear it today and some will wear it for months. It is a
  long-lived, heavily-seen state and §5 applies to it in full: it must look
  *deliberate*, so a player reads "art pending" rather than "this one is broken".

The genuine test the art gap exposes — and it is a good one — is whether **the
frame carries the card on its own.** Black out the portrait on a Hearthstone or
MTG Arena card and there is still an object: frame material, textbox, rarity
furniture, collector line. That is what to judge, and improving it improves all
296 cards rather than the painted ones only.

### Anything the player cannot see

Refactors, file organisation and internal naming are not visual quality. If a
change does not alter a pixel or a frame, it does not belong in this work.
