# HYPEBOUND — Battle Layout & Feel Reference

> ## ⚠ Implementation decisions — read before acting on this document
>
> Most of this has been implemented. **Three recommendations were deliberately
> rejected** and one was accepted but inverted. Recorded so the reasoning is not lost.
>
> **REJECTED — "board units should be portrait medallions."** HYPEBOUND shows
> full cards on the battlefield. The reference strips its minions to medallions
> because its minion art is a small window inside a card frame; ours is
> full-bleed art with a Current-shaped silhouette, and that art is the point.
> Project owner's explicit call.
>
> **REJECTED — "kill the camera tilt; move to an upright plane."** The stated
> reason was that a top-down table hides full-bleed art. That does not hold for
> an *orthographic* camera: ours sits ~11° off vertical, so cards foreshorten by
> cos(11°) ≈ 0.98 — a 2% squash, not a hidden card face. The owner asked for a
> "fully from above" board and that is what this is.
>
> **REJECTED — "fixed 6-slot lattice with visible empty sockets; drop the
> make-room slide."** The dense centre-justified row and its make-room slide are
> what the owner asked for, and they feel better.
>
> **ACCEPTED BUT INVERTED — the adjacency conflict.** The analysis was right
> that a dense visual row contradicted `select: "adjacent"`, which resolved
> neighbours by raw board-array index: with a hole between two characters, cards
> drawn side by side counted as non-adjacent. Its fix was to change the visuals
> to match the engine; we changed the engine instead, so adjacency now reads over
> the occupied sequence and means what the player sees. Regression test in
> `tests/rules.test.ts`.
>
> ### Second measurement pass — "cards look clustered in the middle"
>
> The owner reported twice that board cards huddle in the centre. A dedicated
> re-measurement of the footage found the intuitive fix was the wrong one, and
> §2.2's hero-portrait figures were superseded. Corrections, all re-derived from
> the frames rather than from this document:
>
> **The row was never too narrow.** At every card count our row already spanned a
> *larger* fraction of the mat than the reference's does — 36% vs 33% at three
> units, 49% vs 45% at four. Widening the pitch, which was the first attempt,
> could not have fixed the complaint and did not.
>
> **The mat was too wide.** The reference's playable ground measures **61.4% of
> screen width**, sitting inside decorated border work that reaches 71.6%. Ours
> was 72.5% — sized like the reference's *border* but painted like its *ground*.
> That left a broad empty apron on both flanks. `BOARD.width` 25 → 21 puts the
> ground at 60.9% and lifts a three-card row from 36% to 47% of it.
>
> **The flanks are never empty in the reference.** Its mat edges sit 0–40px from
> real furniture (history rail left; deck stacks, End Turn housing and hero-power
> discs right), so the eye never sees mat-then-void. We cannot copy the furniture,
> so the arena's hard bright rectangle now fades out at the corners instead — a
> crisp boundary invites the eye to measure how much of the box is empty.
>
> **REJECTED — "tighten pitch to the reference's 1.20 pitch-to-width."** It is a
> cohesion fix, and it makes the row *narrower*, which is the opposite of what was
> asked for. We sit at 1.38 by choice.
>
> **§2.2 hero-portrait sizes are wrong.** Re-measurement across ten frames found
> both portraits are the **same width** (166px); the claimed 1.09× near/far depth
> cue does not survive, and the quoted 161×192 is the framed portrait, not the art
> window. The silhouette is a **pointed ogival arch** (superellipse n≈1.58; a
> semi-ellipse is off by 15px), and its lower 54% is a true rectangle with square
> corners — so the arch was never what made it read as a portrait.
>
> **What actually stops the reference's hero reading as a card** is that it is a
> window cut into board masonry: no free-floating outer edge, no drop shadow,
> shared lighting. We have no masonry, so copying the silhouette copied the wrong
> half of the idea. The leader is now a landscape struck medallion — see
> `renderLeader.ts` — and the rectangular glow plate that used to frame it (sized
> to `cardWidth × cardHeight`, which told the eye "card" before the art could say
> otherwise) is gone.
>
> **DEPARTURE — leader is 0.6× a board card's height, not the reference's 1.2×.**
> The reference hero outsizes its board unit because that unit is a stripped
> medallion carrying art and two gems. Ours is a full card with cost gem, name
> plate, type line and rules box — roughly three times the information. Matching
> 1.2× would make the leader out-mass the cards it sits behind and would take
> space rather than give it.
>
> Also applied: equal sizing for both rows (the careful pass measured a 1.00
> ratio, overturning earlier "far row is 7% smaller" reports), damage numbers
> pinned ~2s instead of floating away, screen shake capped, and the hand's fan
> discontinuity at 4 cards with exaggerated rotation.

> **Status:** Discipline specification for the battle-screen rebuild. Subordinate to
> [`../design/00-core-rules.md`](../design/00-core-rules.md) (rules canon),
> [`../tech/00-architecture-contract.md`](../tech/00-architecture-contract.md) (tech canon),
> and [`../../src/engine/types.ts`](../../src/engine/types.ts) (type canon).
> Where those are silent this document decides, and its decisions bind
> `src/ui/battle/` (`scene.ts`, `board.ts`, `cardMesh.ts`, `handBar.ts`, `hud.ts`,
> `presenter.ts`, `vfx.ts`).
>
> Siblings: [Art requirements](./01-art-requirements.md) ·
> [Animation requirements](./02-animation-requirements.md) ·
> [Audio requirements](./03-audio-requirements.md)
>
> **Durations declared here are proposals for the `TIMING` table in `presenter.ts`**,
> which remains the single source of truth. Where a number here conflicts with
> `02-animation-requirements.md`, §12.7 resolves it explicitly.

---

## 0. How to read this document

Everything is reverse-engineered from a 40.6 s Hearthstone capture at 1920 × 1080,
sampled at **5 fps (200 ms per frame)**. Two independent focused studies plus eight
segment reports were reconciled; where they disagreed, §12.8 records the disagreement
and the reading chosen.

**Confidence markers appear on every non-obvious claim:**

| Mark | Meaning |
|---|---|
| **[M]** | **Measured** directly from frames, usually to sub-pixel via template matching or cross-correlation. Trust it. |
| **[D]** | **Derived** — arithmetic on measured values (proportions, easing constants fitted to a measured curve). |
| **[I]** | **Inferred** — consistent with the footage but not directly observed. Treat as a design proposal, not evidence. |
| **[U]** | **Unknown** — never appeared in 40.6 s. You must design it yourself. Do not pretend the reference covers it. |

**A capture-rate caveat that applies everywhere:** at 200 ms sampling, any transition
completing "in one frame" could be anywhere from 1 ms to 200 ms. Every "instant" below
means **≤ 200 ms and visually immediate**, and is specified as ≤ 100 ms for
implementation. Easing curves fitted from 3–5 samples are honest about shape
(exponential ease-out) but only approximate in their time constant.

**All positions are given as percentages of screen width (W) and height (H)** so the
layout scales to any resolution. Pixel values in parentheses are the 1920 × 1080
measurements they came from. Card-relative sizes are given as multiples of card width
so they survive HYPEBOUND's different card aspect ratio (§12.2).

---

## 1. The core insight

### 1.1 It is not a 3D table. It is a flat 2D layout on a painted backdrop.

This is the single most important finding, and it is the thing HYPEBOUND currently
gets wrong.

The reference *looks* like a diorama viewed from a raised three-quarter angle. It is
not. The gameplay layer is **completely flat, orthographic, and camera-facing**, and
every impression of depth comes from painted art in the backdrop and the periphery.

**Proof — same frame, far row vs near row [M]:**

| Object | Far (enemy) row | Near (player) row | Ratio |
|---|---|---|---|
| Minion medallion, bezel outer | 115 × 155 px | 117 × 152 px | **1.00** |
| Location crest | 132 × 158 px | 125 × 158 px | **1.00** |
| Attack gem diameter | 26.7 px | 26.7 px | **1.00** |
| Slot pitch | 137–140 px | 138–143 px | **1.00** |

Zero foreshortening. A minion 182 px "further away" renders at exactly the same size.
There is no vanishing point, no converging verticals, no per-row scale factor, no
trapezoid, and no skew. Minions are **upright, camera-facing billboards on a flat
plane**.

**Proof — the camera never moves [M]:** cross-correlating a static backdrop region
between the frame before an impact and the impact frame itself gives a best match at
`dx = 0, dy = 0` with a residual of **0.008 / 255** — the regions are effectively
bit-identical. Every ±1 px offset scores ≥ 0.35. Mean luminance of the End Turn region
is identical to three decimal places across the whole trade (119.662 / 119.662 /
119.663 / 119.662). There is **no screen shake, no punch-zoom, no rotation, no drift,
and no breathing vignette** anywhere in 40.6 s, including on a lethal minion-vs-minion
trade. Idle bob of the whole board is ≤ 0.8 px on a ~3 s sinusoid — subliminal.

**The only depth cues, all painted or peripheral [M]:**

1. **Hero portraits** — near hero art window 161 × 192 px vs far 147 × 177 px = **1.09×**.
2. **Hero-power discs** — near Ø 125 vs far Ø 120 = **1.05×**.
3. **Hands** — player hand cards ~135 px wide vs enemy card backs ~100 px = **1.35×**.
   This is the strongest depth cue in the entire scene, and it costs nothing.
4. **Deck piles** drawn as genuine 3D stacks — the top card's face is visible ~35 px
   wide on the left with ~40 px of stacked card edges receding right.
5. **The playfield silhouette** — an elongated hexagon/lozenge that bulges widest at
   the vertical mid-line (x 370→1550 at the seam, pinching to x≈560→1360 near the hero
   plinths). This bulge alone sells "table" better than any projection would.
6. **Soft elliptical contact shadows** under every medallion and every floating card.

So: depth lives in the **hands, the heroes, the deck stacks, and the painted
silhouette** — three of which are at the screen's edges, where distortion does not hurt
readability. The gameplay rows, where the player actually needs to read state, are
perfectly flat and perfectly uniform.

### 1.2 Why this matters — and what HYPEBOUND does today

`src/ui/battle/scene.ts` currently builds:

```ts
const camera = new THREE.OrthographicCamera(-10, 10, 6.7, -6.7, 0.1, 140);
camera.position.set(0, 18, 3.4);
camera.lookAt(0, 0, 0);
```

with board geometry laid on the ground plane (`mesh.rotation.x = -Math.PI / 2`
throughout `board.ts`). That is a camera **~79° above the horizon looking down at a
ground plane** — a near-top-down tilted table.

The existing code comment defends the orthographic choice, and it is right to: a
perspective camera would skew the arena into a trapezoid and make hit-testing disagree
with what the player sees. **Keep the orthographic projection.** The problem is not the
projection, it is the **tilt combined with ground-plane geometry**:

- Anything lying on the ground plane is viewed at a steep angle, so **card art and
  character faces are seen from above rather than face-on**. Full-bleed art (§12.2) is
  HYPEBOUND's single biggest visual investment, and a top-down table is the one camera
  that systematically hides it.
- Upright billboards under a 79° downward tilt render nearly edge-on — so the scene
  cannot mix "flat tokens on the table" and "readable upright portraits" without one of
  them looking wrong.
- The `z` foreshortening is uniform but still real: two rows separated in `z` do not
  land at a predictable, authorable screen separation, so the layout cannot be specified
  in screen proportions — which is exactly what a premium card game needs.

**The rebuild directive:** treat the battle screen as a **flat 2D layout authored in
screen proportions**, rendered by an orthographic camera looking straight down the
`-z` axis at an upright `xy` plane, with a painted, parallaxed backdrop behind it.
Three.js stays; the tilt goes. Board decorations that want to look like a table are
**painted into the backdrop texture**, not modelled on a ground plane.

Concretely: `camera.position.set(0, 0, D)`, `camera.lookAt(0, 0, 0)`, all gameplay
meshes at `rotation = (0, 0, 0)` on planes parallel to the screen, `z` used **only for
draw order** (§2.4). Every coordinate in §2 then maps to world units by a single
constant, and the layout is authorable, testable, and resolution-independent.

### 1.3 The three principles that make it feel expensive

Distilled from the whole capture, in priority order:

1. **Layout leads content.** Space is opened *before* the thing that fills it arrives.
   The hand reflows **~400 ms before** a drawn card sprite is visible [M]. The board gap
   opens **~900 ms before** the card is released [M]. The player's eye is never asked to
   track a shove.
2. **Nothing snaps except state.** UI state changes (button labels, playable outlines,
   mana text) are single-frame hard cuts. Every *layout* change is a 500–700 ms
   exponential ease-out. Corpses linger ~800 ms before fading. The mix of instant
   information and slow motion is the entire trick.
3. **All energy goes into sprites, never the camera.** Impact is sold with a one-frame
   silhouette flash, a spark, a lunge, particles and a persistent number — with the
   camera locked to sub-pixel stillness.

---

## 2. Screen layout map

### 2.1 Vertical band structure

```
 0%  ┌──────────────────────────────────────────────────────────────────┐
     │                    ENEMY HAND (card backs, clipped by top edge)  │  8%
 8%  ├──────────────────────────────────────────────────────────────────┤
     │                                                                  │
     │        [enemy mana pill]              ENEMY HERO      (○ HP)     │
     │                                    ┌────────────┐   ╭─────╮      │ 18%
     │                                    │  portrait  │   │hero │      │
     │                                    └────────────┘   ╰pwr──╯      │
28%  ├──────────────────────────────────────────────────────────────────┤
     │  ┌──┐   ╭───╮  ╭───╮  ╭───╮  ╭───╮  ╭───╮  ╭───╮        ┌────┐  │
     │  │hi│   │ ◯ │  │ ◯ │  │ ◯ │  │ ◯ │  │ ◯ │  │ ◯ │        │deck│  │ 15%
     │  │st│   ╰─A♥╯  ╰─A♥╯  ╰─A♥╯  ╰─A♥╯  ╰─A♥╯  ╰─A♥╯        └────┘  │
     │  │  │        ENEMY ROW  (centre-line 37.2% H)                    │
45.6%│~~│~~│~~~~~~~~~~~~~ SEAM / ROPE ~~~~~~~~~~~~~~~~~~~~~~ [END TURN] │  ← 46.2% H
     │  │ra│                                                            │
     │  │il│   ╭───╮  ╭───╮  ╭───╮  ╭───╮  ╭───╮  ╭───╮        ┌────┐  │
     │  │  │   │ ◯ │  │ ◯ │  │ ◯ │  │ ◯ │  │ ◯ │  │ ◯ │        │deck│  │ 15%
     │  └──┘   ╰─A♥╯  ╰─A♥╯  ╰─A♥╯  ╰─A♥╯  ╰─A♥╯  ╰─A♥╯        └────┘  │
     │           PLAYER ROW  (centre-line 54.1% H)                      │
61%  ├──────────────────────────────────────────────────────────────────┤
     │                                    ┌────────────┐   ╭─────╮      │
     │                                    │  portrait  │   │hero │      │ 18%
     │        PLAYER HERO                 └────────────┘   ╰pwr──╯      │
     │                                              (○ HP)              │
86%  ├──────────────────────────────────────────────────────────────────┤
     │            ▗▄▄▖▗▄▄▖▗▄▄▖▗▄▄▖▗▄▄▖         [n/n]◆◆◆◆◆◆◆◆◆◆          │ 14%
     │            HAND (27% of each card clipped)   MANA TRAY           │
100% └──────────────────────────────────────────────────────────────────┘
      0%        16%          48%          62%        80%        100%  W
                             ↑hand apex   ↑mana tray  ↑end turn
                                49.7% ↑ row centre / hero axis
```

Note the seam sits at **45.6 % H — above the vertical centre**. The player's half is
larger than the opponent's (54.4 % vs 45.6 %) [M]. This is deliberate and worth
copying: your own board, your own hero and your own hand get more room than the
opponent's, and the asymmetry is invisible until measured.

### 2.2 Proportion table

All values [M] unless noted. Percentages of screen W/H; pixels are the 1920 × 1080
source measurements.

#### Global frame

| Element | Position (centre or box) | Size | % of screen |
|---|---|---|---|
| Stone board frame (outer) | x 14.8 %–86.2 %, y 5.1 %–95.8 % | 1370 × 980 | **71.4 % W × 90.7 % H** |
| Sand playfield (lozenge, widest at seam) | x 19.3 %–80.7 %, y 24.5 %–70.4 % | ~1180 × 495 | **61.5 % W × 45.8 % H** |
| Decorative margin, left | x 0 %–14.8 % | 285 px | 14.8 % W — pure art |
| Decorative margin, right | x 86.2 %–100 % | 265 px | 13.8 % W — pure art |

**Everything gameplay-critical lives inside x 32 %–86.5 %** (615–1660 px). The outer
~28 % of the screen carries no information [M].

#### Opponent side

| Element | Centre | Size | % of screen |
|---|---|---|---|
| Enemy hand (card backs) | (49.9 %, ~5.6 %) | backs ~100 × 150, pitch 73 | 21 % W × 8 % H band |
| Enemy mana pill | (63.6 %, 6.2 %) | 85 × 39 | 4.4 % W × 3.6 % H |
| Enemy hero portrait (art window) | (49.8 %, **18.3 %**) | 147 × 177 | **7.7 % W × 16.4 % H** |
| Enemy hero health gem | (53.4 %, 24.2 %) | 43 × 62 | 2.2 % W × 5.7 % H |
| Enemy hero power disc | (58.7 %, 22.5 %) | Ø 120 | **6.25 % W** |
| — its cost hexagon | (58.7 %, 15.9 %) | 33 × 35 | 1.7 % W |
| **Enemy row centre-line** | y = **37.2 %** | band h = 161 px | 14.9 % H |
| Enemy deck stack | (84.3 %, 31.1 %) | 77 × 162 | 4.0 % W × 15.0 % H |

#### Centre

| Element | Position | Size | % of screen |
|---|---|---|---|
| **Seam / rope line** | y = **45.6 %** | 2 px seam, rope Ø 15 | — |
| End Turn stone housing | (80.5 %, 46.2 %) | 160 × 94 | **8.3 % W × 8.7 % H** |
| — inner lozenge | (80.4 %, 45.4 %) | 107 × 55 | 5.6 % W × 5.1 % H |
| Row separation (centre to centre) | 182 px | — | **16.9 % H** |
| Row band gap (enemy bottom → player top) | 23 px | — | **2.1 % H** |

The rows are only **2.1 % H apart**. That tightness is why an attack reads as a lean
rather than a journey (§9).

#### Player side

| Element | Centre | Size | % of screen |
|---|---|---|---|
| **Player row centre-line** | y = **54.1 %** | band h = 156 px | 14.4 % H |
| Player deck stack | (84.7 %, 58.4 %) | 75 × 143 | 3.9 % W × 13.2 % H |
| Player hero portrait (art window) | (49.8 %, **76.0 %**) | 161 × 192 | **8.4 % W × 17.8 % H** |
| Player hero health gem | (53.4 %, 83.0 %) | 43 × 62 | 2.2 % W × 5.7 % H |
| Player hero power disc | (58.8 %, 76.5 %) | Ø 125 | **6.5 % W** |
| — its cost hexagon | (59.0 %, 70.6 %) | 36 × 43 | 1.9 % W |
| Mana trough | x 62.4 %–85.8 %, y 89.8 %–94.6 % | 449 × 52 | **23.4 % W × 4.8 % H** |
| — "n/n" pill | (65.4 %, 92.4 %) | 80 × 35 | 4.2 % W × 3.2 % H |
| — crystals ×6, first at | (69.1 %, 92.6 %), **pitch 1.67 % W** | 28 × 30 each | 1.5 % W × 2.8 % H |
| Hand fan apex | (**47.8 %**, 95.8 %) | card 130 × 197 | 6.8 % W × 18.2 % H |

#### Row centre and hand anchor — a deliberate 2 % offset

| Anchor | x | Rationale |
|---|---|---|
| Screen centre | 50.0 % (960) | — |
| **Board / hero / row centre** | **49.7 %** (954) [M] | Effectively centred; the 6 px is measurement noise. |
| **Hand fan apex** | **47.8 %** (917) [M] | **43 px / 2.2 % W left of centre**, consistent at every card count. It clears the mana tray, which starts at 62.4 % W. |

The hand being deliberately off-centre while the board is centred is a real, repeatable
finding, not noise — it was identical across every frame at every card count [M].

### 2.3 Height budget

| Band | Range | % H |
|---|---|---|
| Enemy hand | 0 %–8.1 % | 8.1 % |
| Enemy hero band | 10.2 %–27.8 % | 17.6 % |
| **Enemy row** | 29.8 %–44.7 % | 14.9 % |
| Seam | 45.6 % | — |
| **Player row** | 46.9 %–61.3 % | 14.4 % |
| Player hero band | 67.1 %–85.2 % | 18.1 % |
| Hand (visible) | 86.1 %–100 % | **13.9 %** |

**Both minion rows together = 31.5 % H** [M]. This is the headline proportion: roughly
a third of the screen is the two rows, roughly a third is the two hero bands, and the
remainder is hands and margin.

### 2.4 Z-order (bottom to top)

Since the rebuild uses `z` purely for draw order, fix the stack now [M for observed
layers, I for the ordering constants]:

| Layer | Contents |
|---|---|
| 0 | Painted backdrop, table, scenery, ambient VFX |
| 10 | Playfield sand, seam, slot sockets |
| 20 | Contact shadows |
| 30 | Board objects (medallions, Locations) — **a lunging attacker temporarily promotes above its row neighbours** [M] |
| 40 | Board status badges, keyword sigils, sleep particles |
| 50 | Board VFX (summon plumes, impact stars, deathrattle blooms) |
| 60 | **Damage numbers** — above all board VFX, and they outlive their target [M] |
| 70 | Rope, End Turn, mana tray, hero powers, decks |
| 80 | Hand cards at rest |
| 90 | Dragged card |
| 100 | **Hover preview** — above *everything* on the play field, including the player's own row, hero portrait and hero power [M] |
| 110 | Tooltips, keyword panels |
| 120 | Turn banner, full-screen set-pieces |
| 130 | Cursor |

---

## 3. Board minion rendering

### 3.1 A board minion is not a card

This is the second-most-important structural finding. On the board, a minion is an
**oval portrait medallion** with *all* card chrome deleted: no name, no cost, no rules
text, no type line, no rarity gem.

| Property | Value | % of screen |
|---|---|---|
| Medallion (bezel outer) | 118 × 152 px | **6.15 % W × 14.1 % H** |
| Relative to a hand card | same width, **77 % of the height** | ~55 % of the card's area |
| Art window inside bezel | 99 × 136 px | 5.2 % W × 12.6 % H |

The medallion is **the same width as a hand card but three-quarters its height**. That
is what makes a board full of them read as a row of units rather than a row of cards.

### 3.2 Anatomy

Offsets are from the medallion centre, in % of screen and as multiples of medallion
width `Mw` so they survive a size change.

| Part | Spec |
|---|---|
| **Bezel** | Cast pewter/steel ring **10–12 px thick** (≈ 0.09 × Mw), subtle bevel, darker inner line, thickening into a lip along the bottom where the gems clip on. |
| **Art window** | Card art cropped to the oval, full-bleed inside the ring. |
| **Side brackets** | Two silver "wing/bolt" ornaments ~21 × 25 px at 8 and 4 o'clock, offset (± 0.53 × Mw, + 0.16 × Mw). They — not the gems — define the silhouette's full width (127 px). |
| **ATTACK gem** | **Circle, Ø 26–32 px** (0.24 × Mw ≈ **1.46 % W**), offset **(−34, +54) px = (−0.29 Mw, +0.46 Mw)**. Cream/ivory face `#EBE7DF`, olive-gold rim `#A8912F`. Numeral white, heavy dark outline, cap height ~22 px. **A 0-attack minion uses the identical gem — no desaturation, no removal** [M]. |
| **HEALTH gem** | **Teardrop, point at the TOP, 25 × 32 px** (**1.3 % W × 3.0 % H**), offset **(+42, +52) px = (+0.36 Mw, +0.44 Mw)**. Crimson `#B50D24`, white numeral, same outline weight. |
| Gem seating | Both straddle the bezel's lower edge, roughly half in / half out. |
| **Contact shadow** | Soft ellipse on the playfield beneath. |

**The readability trick, and the single cheapest thing to copy: circle = attack,
teardrop = health.** The stats are distinguishable by *silhouette alone*, before colour
registers, at any zoom. The capture extends this to a full shape language:

| Stat | Silhouette |
|---|---|
| Attack | **Circle** |
| Health | **Teardrop** (point up) |
| Cost | **Hexagon** |
| Durability (Location) | **Shield** |

### 3.3 State treatments

| State | Rendering | Conf. |
|---|---|---|
| **Full health** | Health numeral **WHITE** | [M] |
| **Damaged** | Health numeral **RED**. No extra icon, no bar, no colour on the gem itself — just the numeral. Both heroes at 27/30 and 23/30 showed red numerals; every full-health unit showed white. | [M] |
| **Legendary / elite** | Bezel swaps steel → **polished gold**, ~14 px thick, plus laurel-and-leaf flourishes flaring from the lower-left (~40 × 40) and lower-right, and a gold arc under the base. Footprint grows to ~122 × 163 (**+7 %**). This is the *only* rarity signal on the board. | [M] |
| **Keyword badge (Deathrattle)** | Bone-white skull-and-crossbones **47 × 25–37 px**, centred at **(cx, cy + 78 px) = (0, +0.66 Mw)**, straddling the bottom rim — roughly half above, half below the bezel. | [M] |
| **Summoning-sick / asleep** | Bright yellow-green **"Z" glyphs**, dark-green outline. Spawn at ≈(cx + 40, cy − 45), **rise ~57 px, drift ~10 px right, grow slightly, fade to zero over ~1000 ms**; new one every ~500 ms so **2–3 are alive at once**. They **translate with the minion during row reflow** [M]. Emission is *periodic in bursts* — a burst, then quiet for > 4 s — not a constant stream [M]. | [M] |
| **Targeted / pointed-at** | Warm **orange-red rim glow ~10 px** hugging the outer silhouette, `#FF7B23` inner fading to `#E03A10` over another ~5 px, additive, also warming the bezel. **Hard on/off in ≤ 200 ms** in most instances; one instance ramped over 400 ms. Holds 400–1800 ms. | [M] |
| **Being hit (impact frame)** | The whole medallion — art, bezel and gems — renders as a **flat dark blue-grey silhouette `#2A3A48` for exactly one frame (≤ 200 ms)**. Art returns the next frame. | [M] |
| **Lethal damage taken** | The health gem immediately shows the **negative result** ("−1", "−3") as an oversized **red** numeral (~1.2× normal cap height) overflowing the gem, and keeps showing it until removal. A tiny detail that sells the arithmetic. | [M] |
| **Idle** | Card art animates in place (fire licks, poses shift); occasional white/magenta sparkle particles above the frame; some units carry a slow multi-second rim-light pulse. | [M] |

### 3.4 Not observable — you must design these **[U]**

**Taunt, Divine Shield, Frozen, Stealth, buffed (green) stats, and the "ready to
attack" glow never appear in 40.6 s.** The player's units were summoning-sick or
Locations for the whole of their turn, and ready-outlines are turn-gated and fully
suppressed on the inactive side. Do not invent Hearthstone conventions for these from
memory and claim this document as the source — design them against §3.2's shape
language instead.

### 3.5 Second board-object type: the Location / persistent permanent

Shares the row and the identical slot pitch but has a **completely different
silhouette**, which is exactly why it works [M]:

- A **heraldic crest / shield**, ~**125–132 × 155 px**: flat-arched top, shoulder
  lobes, side lobes at mid-height, tapering to a rounded point.
- Wooden/bronze frame ~14 px with a gold inner pinstripe; art fills the interior.
- **No attack gem, no health gem.** One number only: a **red durability numeral** on a
  small **silver shield plate 30 × 34 px** at the lower-right, offset ≈ (+50, +48).
- **Two states.** *Ready*: art at full brightness. *On cooldown*: two vertical dark-red
  bars (~15 px each) across the face plus a large round latch boss (~32 × 60) at
  left-centre, art dimmed 40–50 %.
- **Coming off cooldown (~600 ms):** bars and latch slide away, art brightens 50 % →
  100 %, the slab flashes solid cyan for one frame with ~10 white/cyan bokeh sparkles
  (8–15 px) thrown to a ~60 px radius, plus two vertical light shafts rising ~50 px.

HYPEBOUND has Locations in its card-type list, and this "same slot, different
silhouette, one number instead of two" pattern transfers wholesale.

---

## 4. Row layout and make-room maths

> **This is the section HYPEBOUND diverges from most.** Read it for the maths and the
> easing, then read **§12.4**, which rejects the dense-row model on rules-correctness
> grounds. The easing constants transfer; the layout model does not.

### 4.1 The reference model: fixed pitch, centre-justified, dense

```
slot_i_x = ROW_CENTRE + (i − (n−1)/2) × PITCH

ROW_CENTRE = 49.7 % W  (954 px)   — both rows
PITCH      =  7.34 % W (141 ± 3 px)
row_y      = 37.2 % H (enemy) / 54.1 % H (player)
```

Verified across every settled configuration in the capture [M]:

| n | Measured centres (px) | Pitch | Fitted centre |
|---|---|---|---|
| 4 (player) | 741 / 882.5 / 1021 / 1164 | 141.5, 138.5, 143 | 952.1 |
| 3 (enemy) | 814 / 954 / 1091 | 140, 137 | 952.5 |
| 3 (player) | 818 / 955 / 1097 | 137, 142 | 956.7 |
| 2 (player) | 885 / 1030 | 145 | 957.5 |
| 3 (enemy) | 805 / 953 / 1090 | 148, 137 | 947.5 |

**Pitch does not compress with count** (2 → 3 → 4 all sit at 137–145) [M], and it does
**not stretch for wider Location crests** — the minion→Location pitch (141.5) is no
larger than minion→minion (143) [M]. It is a plain fixed cell, not a width-packed
layout. With 118 px medallions the visual gutter is ~23 px (~9 px between bracket
ornaments) — very tight, and part of why the row reads as one unit.

Compression presumably only begins when the row exceeds the usable playfield
(~1180 px → ~8 slots) [I — never observed].

### 4.2 Make-room: the gap opens when the card leaves the hand

Because the row is dense and centre-justified, adding one unit slides **every existing
unit by exactly `PITCH / 2` = 70 px = 3.67 % W** [M — measured at 69 px and 65 px on
two independent events].

**Trigger.** The sources initially appear to disagree — one segment reports the gap
opening "on commit", another "on release", three others "on grab". They reconcile
cleanly and the unified rule is:

> **The gap opens the instant the card leaves the hand** — which for a human drag is
> **mouse-down**, and for the AI (which has no drag) is **commit**. It never opens on
> mere hover.

Evidence [M]: in both captured player drags the row began moving on the *same frame* as
the grab (the frame mana snapped from `1/6` to `0/6`) and was fully settled **3–4 frames
before mouse-up** — a 900 ms lead. In the opponent's play, the card hovered over the
board for 4.0 s with the row **completely unmoved**, and the row shifted only on the
frame after mana was deducted. Hover is not commitment; grab is.

**Timing and easing** — the leading unit's centre, tracked per frame [M]:

| t from grab | 0 ms | 200 ms | 400 ms | 600 ms | 800 ms |
|---|---|---|---|---|---|
| x (px) | 811 | 767 | 749 | 744 | 743 |
| % complete | 0 % | **64 %** | 90 % | 97 % | 99 % |

A clean **exponential ease-out / smooth-damp with no overshoot, no bounce and no
anticipation** [M]. Fitted time constant across all measured events spans **τ ≈ 0.15–0.20 s**
(different segments closed 55–75 % of the remaining distance per 200 ms frame).

> **Specify τ = 0.18 s, nominal settle 600 ms.** [D] This sits inside the measured
> range and reproduces the table above within 4 points. Implement as a per-frame
> smooth-damp (`x += (target − x) × (1 − exp(−dt/τ))`), not a fixed-duration tween, so
> a second change mid-flight blends instead of restarting.

**Other rules [M]:**

- **Purely horizontal.** Vertical position, scale and rotation of existing units are
  untouched — attack gems sat at y 635 before and after.
- **Attached particles translate in lockstep** (a sleep-glyph bounding box moved with
  its owner frame-for-frame).
- **All existing objects translate together**; they are not re-spaced individually.
- Insertion index follows the **cursor's x** resolved against current slot centres.
  (Both observed drags were right-end insertions; **mid-row insertion is unverified [U]**.)
- **The open gap is left completely EMPTY** — no ghost minion, no placeholder outline,
  no floor decal, no sand glow. See §7.4.

---

## 5. Hand resting layout

### 5.1 The card atom

| Property | Value | % of screen |
|---|---|---|
| Hand card at rest | **130 × 197 px** | **6.8 % W × 18.2 % H** |
| Aspect (w/h) | **0.659** | — |
| Fan apex card centre | (917, 1035) | **(47.8 % W, 95.8 % H)** |
| Bottom clip | card bottom at y 1134, screen ends 1080 | **27 % of every card is off-screen** |

Card size is **invariant with hand count** — proven by template-matching a card between
a 3-card and a 5-card frame: best scale 0.98–1.00, NCC 0.96 [M].

**What 27 % clipping means for composition:** the player never sees a hand card's
attack/health gems or its last line of rules text. They see **cost gem, art, name
banner, rarity mark, and the first 1–2 lines of rules**. This is a deliberate
information-density choice — the hover preview (§6) is where full reading happens.

### 5.2 Fan geometry by card count

Measured off rarity diamonds — the only landmark unaffected by card rotation [M]:

| n | Pitch | Pitch ÷ card width | Centre positions (px) | Rotation per card | Arc sag |
|---|---|---|---|---|---|
| **≤ 3** | **132 px** | **1.015** | 785, 918, 1051 | **0° — flat** | **0 px — flat** |
| **4** | **121.5 px** | **0.935** | 734, 856, 977, 1098 | **+21.5°, +9.2°, −5.8°, −21.4°** (step ≈ 14.3°) | **15 px** |
| **5** | **96.5 px** | **0.742** | 722, 819, 916, 1012, 1108 | **+23.3°, +14.1°, +1.7°, −10.8°, −25.2°** (step ≈ 12.1°) | **14 px** |

(+ = counter-clockwise on screen. Independently verified: at n = 5 the leftmost card's
top edge measures −24.6° off horizontal; at n = 3 it is horizontal.)

**Express pitch as a multiple of card width**, not in pixels — that is what makes this
table survive HYPEBOUND's different card aspect (§12.2).

#### The four non-obvious findings

1. **There is a hard discontinuity at 4 cards [M].** At ≤ 3 the hand is a perfectly
   flat, upright row with a ~2 px gap. The instant a 4th card arrives the whole hand
   snaps into a **± 21° fan**. There is no gradual ramp. This reads as a hand-authored
   layout table, not a formula — **reproduce the discontinuity**, it is what makes a
   full hand feel *full*. Corroborated independently by two segment reports that
   measured 3-card hands as flat with zero rotation.
2. **Rotation is exaggerated ~3× beyond tangency [M].** A ± 22° tangent rotation implies
   an arc radius of ~470 px, which would sag ~42 px. Measured sag is only **~15 px**.
   So: lay the cards on a *very shallow* arc and rotate them far more than the arc
   requires. **This is the single cheapest trick in the whole layout.**
3. **Overlap only appears at 4+.** n = 3: 2 px gap. n = 4: 8 px overlap (6 %). n = 5:
   33 px overlap (26 %).
4. **Total footprint saturates.** Centre-span goes 264 → 364 → 388 px as n goes 3 → 4 → 5;
   total silhouette 394 → 494 → 518 px (20 % → 27 % W). It converges on a cap around
   **520–560 px ≈ 28 % W**; pitch collapses to hold that cap [D].

**z-order within the fan:** outer cards tuck *behind* their inner neighbours; the apex
card is on top [M].

### 5.3 Two things that do NOT happen

- **The hand does not move between turns.** Template-matching the leftmost card between
  an opponent's-turn frame and a player's-turn frame at the same count gives best scale
  1.00 at the *identical* pixel position, NCC 0.958 [M]. Earlier segment reports of a
  25–30 px "sink on the opponent's turn" were an artifact of comparing different card
  counts — the fan's outer cards sit 15 px lower than the apex, so a count change looks
  like a sink. **Do not implement a turn-based hand lift.**
- **The resting hand has no idle motion.** Mean frame-to-frame luminance delta over the
  hand region across 25 static frames: **1.4 / 255**, with ~3 % of pixels moving by
  > 12 — and *all* of that is video compression plus **animated card art** (a premium
  card shimmers at 4.6 Δluma/frame; plain cards are pixel-static) [M]. The card
  *transforms* do not bob, breathe or sway. **Zero idle motion on the layout, and it
  still looks expensive** — because the art inside the cards is alive.

### 5.4 Playability outlines — two colours, and what they mean

The capture resolves an ambiguity that individual segments could not [M]:

| Outline | Meaning |
|---|---|
| **GREEN**, ~10 px stroke + soft bloom, traces the card silhouette | **Affordable right now.** Unaffordable cards get *no* outline. Confirmed 4×: at 6 mana the 2/3/5-cost cards glow and the 7-cost does not; at 0 mana only the 0-cost glows. |
| **AMBER/GOLD**, ~15 px, thicker and warmer | **Affordable AND a conditional keyword bonus is currently satisfied.** A second state layered on top of playable — *not* a hover indicator. Proof: with no hover at 1 mana, a cost-1 card whose "bonus if this spends all your remaining mana" condition is met renders amber while the cost-0 card beside it renders green. A hovered card with no conditional keyword stays **green even while hovered**. |

Additional [M]: a **discounted cost renders its numeral in green** instead of white —
state carried by text colour, with no extra badge. Both outlines switch on/off in a
**single frame with no fade**, for the whole hand simultaneously, at the moment control
is handed to the player.

The outlines **trace the actual card silhouette** — following notched/scalloped frame
edges — not a bounding rectangle [M]. For HYPEBOUND this is load-bearing: see §12.3.

---

## 6. Hand hover

Four independent hover events measured; the behaviour is rigid and trivially
implementable [M].

### 6.1 The pose

| Property | Value |
|---|---|
| **Scale** | **× 2.45** (measured range 2.4–2.5) → body **318 × 483 px = 16.6 % W × 44.7 % H** |
| **Rotation** | forced to **0°** — the card straightens completely |
| **x** | **exactly the card's own resting centre x. Zero horizontal shift.** (hovered card 3-of-5 → preview x 916, resting x 916) |
| **y** | **fixed regardless of which card is hovered**: top ≈ y 540, **bottom pinned at y 1023 = 94.7 % H**. All four hovers landed in the same band (glow tops 528–544). |
| **Lift** | top −397 px, bottom −111 px, centre −262 px |
| **z-order** | **above absolutely everything** on the play field — covers the player's own row, hero portrait, hero power and mat |

**Equivalent formulation, and the one to implement [D]:** a uniform **× 2.45 scale about
a pivot at `(card.restX, y = 112.8 % H)`** — 138 px *below* the bottom of the screen, or
`cardTop + 1.39 × cardHeight`. Solving independently from the top and bottom edges gave
pivots of 1215/1215 in one event and 1227/1228 in another. Either implement it as
"scale about a point at 1.13 × screenHeight" or as "fixed size, bottom edge pinned at
0.947 × screenHeight" — they are the same thing, and the second is easier to keep stable
across aspect ratios.

### 6.2 Timing

| Beat | Duration | Curve |
|---|---|---|
| **Hover-in** | **≤ 100 ms — treat as instant** | No intermediate scale in any of 4 events; no overshoot |
| Residual settle | preview creeps **up ~12 px over 400 ms** | ease-out (glow top 535 → 529 → 526 → 525) |
| Idle float | **± 3 px** thereafter | continuous — the only motion the preview has |
| **Hover-out, stage 1** | at **200 ms**: back to **~1.05×**, still lifted ~37 px, straightened, outline still on | — |
| **Hover-out, stage 2** | at **400 ms**: fully re-seated, rotation restored | — |
| **Total un-hover** | **300–400 ms** — **scale collapses faster than position** | asymmetric with hover-in |

The asymmetry is the point: **instant in, eased out**. Copy it.

### 6.3 Neighbours do not move — at all

Verified by pixel-differencing the leftmost card's region across an entire hover
(baseline vs 12 subsequent frames): mean delta 8/255 over 16 % of pixels, and **all of
it is animated card art and glow breathing — zero positional shift** [M].

The preview is a **pure z-order overlay that occludes its neighbours**. This is far
cheaper than a push-aside, avoids any reflow cost, and reads perfectly. Four segment
reports independently confirmed it.

### 6.4 Attached UI, gated by dwell time

The hover discloses information in **three tiers** [M] — this staging is a large part of
why the UI feels considered:

| t | Beat |
|---|---|
| **0 ms** | Card pops to × 2.45 (instant feedback) |
| **+200 ms** | **Mana cost preview**: N crystals blow out to near-white, N = the card's cost. They are the **last N *filled* crystals** — counted from the right end of the blue group. At 6/6 with a cost-5 card, crystals 2–6 light and crystal 1 stays plain blue. Ramp ~200 ms. |
| **+400–600 ms** | **Keyword tooltip** fades in over ~200 ms. **Removed instantly with no fade** the frame hover ends. |

**Tooltip panel spec [M]:** dark stone rounded rect, bevelled; **fixed width 230 px
(12 % W)**; height fits content (77 px for a 1-line body, 104 px for 2 lines, 167 px for
4). Gold/white bold keyword title, white body. First panel's top at y ≈ 578 (53.5 % H),
≈ 38 px below the preview's top edge. Stacked panels use a **~23 px gap**; up to 2
observed.

**Side-selection rule, confirmed 4 / 4 [M]:** the tooltip goes on **whichever side has
more room between the preview's edge and the screen edge**, with a **35–40 px gap** from
the card. Preview centred at 916 → tooltips right at x 1120–1355. Preview centred at
1017 or 1112 → tooltip left at x 592–820 / 683–895.

**Card-type plate [M]:** a small stone plate (~150 × 40 px) sits *below* the preview at
y ≈ 1030–1070, centred, reading the card type. It is a separate element **outside** the
card silhouette.

### 6.5 Hovering a board minion is different

Hovering a unit on the board does **not** outline it. It pops a **full 290 × 460 px card
tooltip to its left, instantly (no fade, no scale-in)**, dismissed just as instantly
[M]. The board object itself gets no highlight. This keeps board hover cheap and
distinct from targeting (which *is* a rim glow, §3.3).

---

## 7. Drag and drop

### 7.1 The grab frame — everything fires at once

All of the following happen on the **same single frame** as mouse-down [M]:

1. **The hover preview is discarded outright.** The card does not shrink continuously
   from 2.45×; it is *replaced* by a new "held card" spawned at **≈ 1.16× resting**
   (151 × 229 px) — an undershoot relative to its final drag size.
2. **The card snaps to the pointer** at its captured grab offset (§7.3), jumping up to
   ~350 px in one frame.
3. **The playability outline is removed.**
4. **A burst of cyan sparkle motes** is emitted around the card.
5. The card may carry a **tilt up to ~20°** at this instant, which lerps upright within
   ~200 ms. It casts a **soft drop shadow down-and-left**.
6. **Mana is deducted NOW, on grab, not on release [M].** Verified by filmstripping the
   mana pill: three consecutive frames read `1/6`, the grab frame reads `0/6` — and
   release did not occur until **900 ms later**. The crystals then drain white-hot →
   spent-dark over **600–800 ms with an ease-out**, decoupled from the text.
7. **The rest of the hand begins re-fanning** to the n−1 layout (§7.5).
8. **The board's row begins opening its gap** (§4.2) — *before* the card has even
   entered the play area.

> **The decoupling of instant text from slow art is a deliberate pattern.** The mana
> *number* snaps for information; the mana *crystals* drain over 700 ms for feel. Apply
> this rule anywhere a value changes.

### 7.2 Appearance while dragging

| Property | Value |
|---|---|
| **Settled size** | **× 1.47 resting ≈ 191 × 290 px = 9.9 % W × 26.9 % H** [M — measured via the rigid attack-gem-to-health-gem span: 154 px vs 105 px at 1×; both drags converged on 1.47–1.49] |
| **Scale ramp** | 1.16× → 1.45× → 1.49×: **~78 % of the growth in the first 200 ms**, settled by 400–600 ms, ease-out |
| **Rotation** | upright, 0°. No tilt, no inertia sway, no lag-lean once settled |

The drag size is the **geometric middle of "in hand" (1.0×) and "hover preview"
(2.45×)** — big enough to read the rules text, small enough not to hide the board. That
is not a coincidence; it is the design constraint that determines the number.

**Two visual states [M]:**

- **Neutral / just picked up:** full colour, ~60–70 % opacity, faint white-cyan rim,
  sparkle motes.
- **Over a valid drop zone — the "hologram":** every pixel re-tinted **blue-violet**;
  art desaturated to violet; all frame ornament redrawn as **cyan-white line art**; a
  **~14 px cyan outer glow plus a magenta secondary rim**; white sparkle motes drifting
  across the surface. **Numerals stay fully legible** (cost/attack cyan-white, health
  white with a magenta cast). Cross-fade over **200–400 ms** (specify **300 ms** [D]),
  triggered by **entering the play area**, not by the grab.

### 7.3 Cursor relationship — the card is NOT centred on the pointer

This surprised the analysis and is worth copying [M]. The card **preserves the grab
offset captured at mouse-down** and holds it rigidly:

- Drag A: cursor at the card's **x-centre, 25 px below its y-centre** — the card floats
  slightly above the pointer.
- Drag B: card hangs **84 px left, 0 px vertically** — the pointer rides just inside the
  card's right edge.

Both offsets stayed constant frame-to-frame while the pointer was stationary, so this is
**not lag**. The card is **rigidly parented to the pointer with the mouse-down offset.
No spring, no lag, no inertia.**

**Cursor sprites [M]:** exactly **two**. A pale **gauntlet with the index finger
extended, ~19 × 27 px, hotspot at the fingertip**, used for hover, grab, drag *and* drop
— it never changes during the interaction. And an ornate **gold arrowhead with a blue
jewel, ~23 × 25 px**, used over non-interactive scenery and during the opponent's turn.
**The swap happens on the exact frame the playable outlines turn on.**

### 7.4 The crucial negative finding: there is NO drop indicator

Verified across all 9 drag frames in both drags [M]. **No slot rectangle. No ghost card
outline. No highlighted footprint. No ground decal. No arrow. No landing-spot shadow.**

The drop target is communicated by exactly **two** things, and they are sufficient:

1. **The card turning blue/hologram** = "this is a legal drop".
2. **The row having already slid apart** = "this is *where* it lands".

The make-room animation *is* the drop indicator. That is why §4.2's 900 ms lead matters
so much — and it is also why §12.4 must replace it for HYPEBOUND rather than simply
delete it.

### 7.5 What the rest of the hand does

The remaining cards re-fan to the n−1 layout **starting on the grab frame** [M]:

- **5 → 4**: settled in ~600 ms, ~90 % done by 400 ms.
- **4 → 3**: complete within one 200 ms frame (smaller travel distance).
- The hand re-centres on 47.8 % W as always; the mid-card barely moves and the rest
  redistribute around it.
- Remaining cards keep normal brightness and their own playability outlines. **The hand
  is not dimmed during a drag.**

Use the same τ ≈ 0.18 s smooth-damp as the board, capped so short travels finish fast.

### 7.6 Cancel — **[U] never occurs in the footage**

No cancelled drag, no right-click abort, no return-to-hand exists in 40.6 s. You must
design it. Given that **mana is spent on grab** and **the row gap opens on grab**, a
cancel must reverse both.

**Proposal [I]:** mirror the same τ = 0.18 s smooth-damp for the row closing; reuse the
un-hover curve (300–400 ms, scale collapsing before position) for the card returning to
its slot; refund the mana with the crystals refilling over 700 ms ease-out while the
*text* snaps back instantly (the §7.1 decoupling rule, run backwards).

---

## 8. Card play animation

### 8.1 The shared grammar

Release → clean minion takes **≈ 900–1000 ms** [M], and the reference never flies the
card to the slot. **The card dissolves in place, at exactly the position and scale it had
while dragged**, and the minion is born out of it.

**The card is released to a world position, not to the pointer [M]:** at the release
frame the card ghost's centre was at (859, 575) while the cursor was at (937, 587); one
frame later the cursor had moved 380 px away and **the card had not followed at all**.
The play animation runs completely independently of the pointer after mouse-up.

### 8.2 Variant A — extrusion (the primary one to copy)

| t from release | State |
|---|---|
| **+100 ms** | Card frame flattens into a **lavender/white translucent "husk"** (210 × 275) at ~30 % opacity. Simultaneously the **minion medallion is extruded out of the card's art window** at **~1.12–1.15× final size**, floating **~55 px above** the target slot centre, already showing its correct attack/health. |
| **+300 ms** | Husk at ~15 %. Medallion has descended ~15 px and is shrinking toward 1.0×. |
| **+500 ms** | Husk gone. Medallion lands at the exact slot centre. A **ring of white/blue smoke puffs (~110 × 170 px)** erupts and curls up-and-right; the portrait flashes cyan-white. |
| **+500–900 ms** | Plume breaks into rising sparkle particles; art fades back in; keyword badges appear. |
| **+900 ms** | FX gone, minion clean. Sleep glyphs first appear **~1600–1800 ms after landing**. |

Descent path: essentially straight, **~62 px down and 14 px left**, decelerating
(35 px then 29 px per frame) — ease-out over ~400 ms [M].

### 8.3 Variant B — dissolve

The card sits on the board as a **solid cyan-white energy silhouette of the whole card**
(208 × 284) → drops to ~50 % opacity → the minion's oval fades in inside it → an **oval
dust burst exactly on the minion footprint** (142 × 190 ≈ **1.15× the medallion**),
cream-coloured, **ring-shaped with a hollow centre**, with a **violet-magenta halo rim**
and the minion a dark silhouette inside → dust dissipates as a tan haze (~220 × 230) →
minion fully opaque. ~1000 ms [M].

Note both variants land on **burst size ≈ 1.1–1.5× the medallion footprint, centred on
the slot**. That is the number to reuse.

### 8.4 The opponent's play — a two-track staging worth stealing

The opponent's play is staged completely differently from the player's, and it is the
most "expensive"-feeling sequence in the capture [M]:

| t | Beat |
|---|---|
| 0 ms | **Commit** — mana pill flips (e.g. 6/6 → 0/6). The held card back is still parked over the board. |
| +200 ms | **Three things fire simultaneously:** (a) the row makes room; (b) the played card's **full face appears at screen-left**, **302–315 × 425–437 px = ~15.7 % W × 39.4 % H ≈ 2.15–2.4× a resting hand card**, arriving at **full size in one frame with no scale-up tween**; (c) the card back begins its flight to the slot. |
| +200–600 ms | **Flight**, ease-out: +185 px then +75 px per 200 ms, ~260 px total, scaling 120 × 190 → 176 × 293 (**1.5×**), turning saturated magenta with a white/pink rim. **It never flips face-up during the flight** — it stays a card back the whole way. |
| +600 ms | **White-hot card-shaped flash**, 202 × 300 px, with an **orange bloom spilling ~80 px past the card silhouette**, visibly relighting the surrounding sand and the neighbouring hero-power disc. |
| +800 ms | Flash gone in one frame; replaced by ~20 thin orange/pink motion streaks (60–120 px each) radiating **up-and-right** — an angled directional burst, not a symmetric ring. |
| +1000–1200 ms | **White/yellow radial bloom** centred on the slot: core radius ~90 px, rays to ~250 px, peaking at +400 ms then decaying 70 % / 40 % / 15 % / 0 over ~800 ms. |
| Later | The **oversized card face is dismissed instantly (≤ 200 ms, no shrink, no fade)**, timed to coincide with the **battlecry's impact**, not with the summon. |

> **The two-track idea is the transferable insight.** An **oversized, perfectly static,
> readable card face parked at the screen edge for the player to read**, while a
> **separate, abstracted, glowing token does the physical travel** to the slot. One track
> carries information, the other carries motion. Neither compromises for the other.
>
> Note also: a newly-summoned minion appears **~15 px outboard** of its final slot and
> eases in over ~1000 ms [M].

### 8.5 Cards entering the hand

Two flows, both worth copying [M].

**Deck draw — the expensive one, ~1800 ms total:**

| t | Beat |
|---|---|
| 0 ms | Card lifts out of the deck **rotated ~100° off-upright, mid-flip**. *Same frame:* **the hand pre-compresses to open the new slot.** |
| +200–400 ms | Rotates upright, settles into a large **reveal pose ~280 × 405 px**. |
| +600 ms | Drifts ~55 px left / 40 px up while growing to ~320 × 425. |
| +600–1600 ms | **Holds nearly still for ~1000 ms.** This is the entire point of the beat. |
| +1800 ms | Shrinks and **arcs down-left into the hand over ~400 ms**, already carrying its playable glow. |

Flight speed profile is a clear ease-out (1760 px/s → 1250 px/s), scale interpolates
monotonically ~1.55× → 1.0×, rotation sweeps ~35° to land exactly on the fan angle, and
**the card casts a soft ground shadow while airborne** [M].

**Generated / discovered card — the cheap one, ~600 ms:** source VFX converges → a tiny
25 × 40 px card sprite appears at the source point → in flight at 76 × 100 px, tilted
~5°, bright green glow → arrives at ~110 × 150 px → seated, **retaining a persistent
green outline as a "this was created, not drawn" marker**.

> **In both cases the hand opens the destination slot ~400 ms BEFORE the incoming card
> is visible [M].** The layout reflows first; the card flies into a slot that is already
> waiting. **Never make the card arrive and then shove everyone aside.**

On arrival a card can **overshoot ~70 px high** of its resting height and settle
downward rather than snapping [M].

---

## 9. Attack animation

> **Sample-size warning [M]:** exactly **one** minion-vs-minion trade exists in the
> entire 40.6 s capture. Every timing in this section comes from that single event, at
> 200 ms sampling. Treat the *shape* as reliable and the *constants* as a starting point.

Geometry of the observed trade: attacker at (886, 399) strikes a defender at (1022, 583).
Centre-to-centre **231 px**, direction (0.59, 0.81), 54° below horizontal.

### 9.1 Frame-by-frame

| t | Event |
|---|---|
| −200 ms | Attacker **at rest, dead still**. **No wind-up, no pull-back, no anticipation squash was captured** — if one exists it is ≤ 200 ms [U]. |
| **0 ms** | **STRIKE + IMPACT on the same frame** (below). |
| +200 ms | Attacker **back at ~25 % residual** — effectively home. Both damage stars up. Sparks thrown. |
| +400 ms | ~14 % residual. |
| +600 ms | **Exactly at rest.** Both combatants begin fading. |

### 9.2 The strike

| Property | Value |
|---|---|
| **Translation** | **+33 x, +34 y = 47 px total** along the attack vector — **20 % of the 231 px centre-to-centre distance**, ≈ 2.4 % W |
| **Scale** | **~1.15×** (art window 118.5 → 131.8 wide; attack gem Ø 33 → 41) |
| **Path** | **dead-straight line.** No arc, no curve, no rotation (≤ 3°) |
| **z-order** | the lunging attacker draws **on top of its row neighbours** (it fully occluded a neighbour's attack gem) |

It is a **lean, not a traversal.** The attacker never leaves the neighbourhood of its
slot, but its bottom edge does cross the seam and overlap the defender's row band. The
stop position puts the attacker's leading rim **within ~10–15 px of the defender's rim**
— the silhouettes visually kiss.

> **Implement it as "move until the silhouettes touch"**, which for adjacent slots
> works out to ~45–50 px [D]. Do not implement it as a fixed pixel offset, or diagonal
> and long-range attacks will look wrong.

### 9.3 Impact — same frame as the strike

- **Contact spark at the defender's near rim**, on the line between the two: a ragged
  cream/white angular puff **~67 × 75 px** plus scattered debris flecks. **One frame
  (≤ 200 ms).**
- **Both health gems immediately display the arithmetic including negatives** as
  oversized red numerals (§3.3).
- **The struck defender renders as a flat dark blue-grey silhouette for exactly one
  frame.** Art returns the next frame.

### 9.4 Return

Snap-back, **≤ 400 ms out-and-back total**. Residuals from rest: 47 px (100 %) → 11.6 px
(25 %) → 6.5 px (14 %) → 0 [M]. Same exponential ease-out as everything else,
τ ≈ 0.15 s. **No overshoot, no settle-bounce.**

### 9.5 Particles

A spray of **8–12 golden sparks thrown along the attack vector *past* the defender**,
plus a low arc skimming the row seam. They travel **~900 px in 200 ms**, then vanish
[M]. One frame of streaks, one frame of far-field, gone. The direction — *through* and
*beyond* the target — is what sells force.

### 9.6 Screen shake: **NONE** — verified to sub-pixel

See §1.1. No shake, no global flash, no vignette pulse, no chromatic effect. **The
reference spends its entire impact budget on the sprite, the spark, the number and the
particles, and never moves the camera.**

Given that the idle bob is ≤ 0.8 px, if HYPEBOUND *does* author shake, **3–4 px will
read clearly** [D]. See §12.7 for the conflict with the existing animation spec.

### 9.7 Ranged / spell damage — the same grammar, four beats

| t | Beat |
|---|---|
| 0 ms | **Comet projectile**: fully-lit head with a tapering tail, **~175 px visible streak, ~30 px head**, straight line, no arc. Already ~93 % across on its first visible frame → **> 1150 px/s, travel < 200 ms**. |
| +200 ms | **8-pointed gold sunburst, 163 × 189 px**, centred on the target. Blown-out white core Ø ≈ 88, yellow halo to r ≈ 60, gold points to r ≈ 85–95. **One frame.** |
| +400 ms | **Collapses into a yellow tint-flash conforming to the target's oval** — a ragged pale-yellow blob filling the art window (120 × 140), plus 10–20 ember flecks spraying ~40 px. **One frame.** |
| +600 ms | **Damage number** appears (§10.2). |

Melee and ranged share the structure: **a one-frame *shape* event, then a two-second
*readout* event.** That two-layer hit language is §11's most reusable idea.

---

## 10. Death and damage numbers

### 10.1 Death — 1400 ms from lethal to a clean board

**Do not remove corpses instantly. The hold is a large part of why it feels expensive.**

| t from lethal | State |
|---|---|
| 0 ms | Lethal damage applied. Health gems show the negative in red. Struck unit dark-flashes for one frame. |
| +200–400 ms | **Corpses remain fully rendered and fully coloured**, sitting in their slots with the damage stars on top. **Nothing moves.** |
| +600 ms | **Fade begins.** Medallion at ~60–70 % opacity, washed slightly whiter/desaturated. **The row still has not moved.** |
| +800 ms | Corpses at **~25 %**. **The survivors start sliding on this frame** — the reflow overlaps the last of the fade. |
| +1000 ms | Corpses **gone**. Deathrattle VFX fires in the now-empty slot. |
| +1200–1400 ms | Rows settled. |

**No shatter, no crack sprite, no explosion, no fall-over** [M]. It is a straight opacity
fade with a slight desaturate/whiten over **~400 ms**.

**Row reflow after death** uses the same exponential ease-out as make-room: measured
745 → 789 (63 %) → 801 (79 %) → 808 (90 %) → 808 (settled), τ ≈ 0.2 s, ~600 ms total, no
overshoot [M].

**Deathrattle VFX** (fires at the dead unit's slot *after* removal): magenta/pink radial
bloom growing **180 × 190 → 250 × 220 over 400 ms**, packed with white sparkles and small
**heart-shaped particles** drifting up, holding ~400 ms, decaying to a diffuse orange-pink
haze by ~1000 ms [M]. If it generates a card, the card sprite appears **400 ms after the
hand has already reflowed** — layout first, card second, as always.

**Effect colour is keyed to effect *type*, not to the card** [M]: magenta/pink for
deathrattle, white/yellow for damage, warm orange for fire. This is a cheap, strong
convention and it maps directly onto HYPEBOUND's per-Current palettes (§12.5).

### 10.2 Damage numbers

A **jagged comic starburst**, 8–11 irregular points of varying length.

| Property | Value |
|---|---|
| **Size** | **121–132 × 139–154 px** = **~103 % of the medallion's width, ~92 % of its height**. It covers the unit. |
| **Anchor** | centred on the **medallion centre** ± 10 px, in **board space** |
| **Fill** | bright gold `#F2C43A` centre → deeper amber `#E8A828` at the rim, raised bevel lip (lighter `#F7D45E` upper-left) |
| **Outline** | dark brown/black `#3A2410`, 2–3 px |
| **Numeral** | **white with a heavy ~4 px dark outline**, bold slab-serif, **cap height ~32 px**, glyph block ~45 × 33 px, tilted ~−5° |
| **Pop-in** | first frame at ~85 % opacity, slightly compressed vertically; full form within **400 ms**. The sprite **jitters ± 5 % in scale and a few degrees in rotation** frame to frame |
| **Sustain** | deflates ~3–5 % per 200 ms (128 × 154 → 125 × 149 → 121 × 141), then **holds** |
| **Lifetime** | **~2000–2400 ms**, then **fades on opacity** over ~400 ms |
| **Motion** | **NONE.** No upward float, no drift, no arc. **It is pinned.** |
| **Persistence** | **survives the death and removal of its target**, and **does not follow the row reflow** — after corpses vanished, a "−5" stayed floating over empty sand at the dead unit's old slot while survivors slid out from under it. It also survived a turn change. |

Damage to a **unit** = this gold star. Damage to a **hero** = the plain red numeral in
the blood-drop gem simply counts down; **no star was observed on a hero** [M].

> **The two-second pinned lifetime is one of the highest-value findings in the whole
> study.** Because the numbers persist and do not float away, the player can read the
> *history* of a whole combat at a glance, several seconds after it resolved. Three
> separate "−N" bursts can be on screen simultaneously alongside a deathrattle bloom.
> This is the opposite of the conventional "float up and fade in 400 ms" pattern, and it
> is a large part of why the board feels legible rather than frantic.

### 10.3 Source disagreement, resolved

One segment reported damage splats "gone within 400 ms". The focused board study tracked
the *same* splat from its appearance to its disappearance and measured **2200 ms**. Both
observed the same final frame; the segment simply entered mid-life and saw only the fade
tail. **The 2000–2400 ms lifetime is correct** [M].

---

## 11. Polish inventory

Ranked by value-for-effort, all [M] unless noted.

1. **Layout leads content.** Hand reflows 400 ms before a drawn card appears; the board
   gap opens 900 ms before release. Nothing is ever shoved.
2. **Damage numbers hold ~2.2 s and do not float.** The board stays readable as history.
3. **Two-layer hit language.** A one-frame *shape* event (star / spark / dark-flash
   silhouette) followed by a two-second *readout* event (the number).
4. **Every removal is preceded by a fade; every fade is followed by a reflow.** The eye
   is never asked to track a teleport.
5. **Three-tier hover disclosure gated by dwell:** 0 ms enlarge → +200 ms mana preview →
   +500 ms keyword tooltip. Slow to commit, **instant to dismiss**.
6. **Instant text, slow art.** The mana *number* snaps; the mana *crystals* drain over
   700 ms. Applies to every value change.
7. **Animated art inside the medallions and inside hand cards** — fire licks, poses
   shift — while the *layout* has zero idle motion. The board is never static and the UI
   never wobbles.
8. **Deterministic looping status particles.** Sleep glyphs on a 1000 ms rise / 500 ms
   respawn cycle that **translate with their owner** during reflow.
9. **Lighting spill.** The summon flash visibly relights the surrounding sand and the
   neighbouring hero-power disc; the turn banner washes the whole mat warm. VFX that
   affects its surroundings reads as expensive far beyond its cost.
10. **Silhouette-first stat readout** (§3.2). Readable at 25 % zoom.
11. **Mana crystals have three states, not two:** empty (dark hollow), filled (bright
    faceted), and **"would be spent by the card you are hovering"** (blown out to white).
    That third state is the clearest single affordance in the entire UI.
12. **Information asymmetry.** You get a numeric pill **and** a physical crystal row; the
    opponent gets **only a pill, no crystals**. Cheap to implement and it keeps the top of
    the screen quiet.
13. **Disabled states are re-skins, not greys.** The End Turn button changes **label,
    colour and material** when it is not yours, rather than dimming.
14. **The End Turn button grows a pulsing green glow ring** the moment you have no legal
    plays left — the game tells you your turn is over before you work it out.
15. **Opponent "tells" are fully visible.** The AI's held card slides 20–40 px out of the
    fan with an amber rim glow for ~1.2 s before committing. You can read intent.
16. **Ambient scene life at zero gameplay cost.** Waterfalls with caustics, foliage
    sway, blinking eyes in the background, a stone idol's gem pulsing on a ~6 s
    fast-attack/slow-release cycle — all in the decorative margins, never overlapping
    gameplay.
17. **The turn timer *is* the board's centre divider.** The rope both separates the halves
    and burns down. One object, two jobs. It burns **left → right at ~54 px/s ≈ 2.8 % W/s**,
    giving ~19 s of runway, and **vanishes instantly on turn change**.
18. **Two cursor sprites**, swapped on the exact frame control is handed over.
19. **State via text colour**, not extra badges: a discounted cost renders green; damaged
    health renders red.
20. **The camera never moves.** §1.1.

**Implied audio hits** (from visuals alone) [I]: card pickup sparkle, gap-open whoosh,
card release thud, summon impact dust, projectile whoosh, impact crack, minion death
fade, deathrattle chime, turn-banner gong, rope crackle loop, end-turn click, crystal
chime on cost preview, UI tick on hover.

---

## 12. ADAPTATION — HYPEBOUND is not a Hearthstone clone

HYPEBOUND differs from the reference in five ways that matter structurally: **8 Currents
with distinct frame silhouettes**, an **Obsession meter**, **Confluences**, **full-bleed
card art**, and — most importantly — **6 fixed, index-addressable board slots**.

This section is the decision record. Each item is **ADOPT**, **ADAPT**, or **REJECT**.

### 12.1 Summary table

| # | Convention | Verdict | One-line reason |
|---|---|---|---|
| 1 | Flat orthographic gameplay layer, camera-facing billboards | **ADOPT** | Uniform scale, authorable in proportions, protects full-bleed art |
| 2 | Painted depth in backdrop/hands/heroes/decks | **ADOPT** | All the "3D" for none of the distortion |
| 3 | Static camera, zero shake | **ADOPT (with a capped exception)** | §12.7 |
| 4 | Board unit = stripped-down medallion, not a card | **ADAPT** | Shape must become the Current silhouette, not an oval — §12.3 |
| 5 | Circle/teardrop/hexagon/shield stat shapes | **ADOPT** | Greyscale-readable; satisfies core-rules A2/§10 |
| 6 | Health numeral white → red when damaged | **ADOPT** | Zero-pixel state encoding |
| 7 | Gold bezel = legendary | **REJECT** | The frame silhouette is already Current-coded; rarity needs a different channel — §12.3 |
| 8 | Dense centre-justified row + make-room slide | **REJECT** | Breaks `adjacent` correctness — §12.4 |
| 9 | No drop indicator | **REJECT** | Follows from #8 — §12.4 |
| 10 | τ ≈ 0.18 s exponential ease-out for all layout motion | **ADOPT** | The signature feel; applies to sockets too |
| 11 | Hand fan with a hard discontinuity at 4 cards | **ADOPT (retuned)** | §12.2 |
| 12 | Rotation exaggerated ~3× beyond arc tangency | **ADOPT** | Cheapest premium trick in the layout |
| 13 | Hover = ×2.45, straighten, pin bottom, neighbours frozen | **ADOPT** | §12.2 for the scale retune |
| 14 | Three-tier hover disclosure (0 / +200 / +500 ms) | **ADOPT** | Maps onto Currents, keywords and Confluence previews |
| 15 | Mana spent on grab; instant text, slow crystals | **ADOPT** | Extend to Obsession — §12.5 |
| 16 | 27 % of hand cards clipped off-screen | **ADAPT** | Full-bleed art changes the safe-zone maths — §12.2 |
| 17 | Card dissolves in place; minion extruded from art window | **ADAPT** | Full-bleed has no art window — §12.2 |
| 18 | Opponent play: static oversized reveal + separate flying token | **ADOPT** | Best single "expensive" pattern in the capture |
| 19 | Attack = 20 % lean + 1.15× scale, no traversal | **ADOPT** | §12.7 for the duration reconciliation |
| 20 | Damage numbers pinned ~2.2 s, no float | **ADOPT** | §12.7 |
| 21 | Corpse holds 800 ms before fading | **ADOPT** | §12.7 |
| 22 | Opponent gets a pill, no crystals | **ADOPT** | Keeps the top of the screen quiet |
| 23 | Rope doubles as centre divider and turn timer | **ADAPT** | Ring timer already specified — §12.6 |
| 24 | Play-history rail as observed | **REJECT as reference** | It is third-party stream chrome — §12.6 |

### 12.2 Full-bleed art changes four numbers

HYPEBOUND cards are **512 × 680, aspect 0.753** (`01-art-requirements.md` §0), against
the reference's **0.659**. HYPEBOUND cards are **14 % wider for their height**. Four
consequences:

**(a) Hand card size.** Keep the reference's *height* proportion — it is what sets the
hand's screen presence — and let width follow the aspect:

| | Reference | **HYPEBOUND** |
|---|---|---|
| Hand card height | 18.2 % H (197 px) | **18.2 % H (197 px)** |
| Hand card width | 6.8 % W (130 px) | **7.7 % W (148 px)** [D] |

**(b) Fan pitch must be expressed as a multiple of card width**, or the wider card will
overlap wrongly. From §5.2:

| n | Pitch ÷ card width | **HYPEBOUND pitch** |
|---|---|---|
| ≤ 3 | 1.015 | **150 px (7.8 % W)** — flat, upright, ~2 px gap |
| 4 | 0.935 | **139 px (7.2 % W)** — snap to ± 21.5° fan, 15 px sag |
| 5 | 0.742 | **110 px (5.7 % W)** — ± 23.3°, 14 px sag |
| 6+ | extrapolate, cap total silhouette at **28 % W** | compress pitch to hold the cap [I] |

Rotation steps and sag are **unchanged** — they are angular and vertical, unaffected by
width.

**(c) Hover scale must come down.** A ×2.45 hover on a 0.753-aspect card gives
**363 × 483 px = 18.9 % W** — noticeably wider than the reference preview and encroaching
on the tooltip's side allowance. **Specify ×2.30**, giving **340 × 453 px = 17.7 % W ×
41.9 % H** [D], and keep the bottom-edge pin at 94.7 % H. Re-verify the §6.4 side-selection
rule still leaves ≥ 35 px for a 230 px tooltip at the extreme fan positions.

**(d) The clipping maths changes, and full-bleed makes it more dangerous.** The reference
clips 27 % of each hand card, which is safe because its bottom band holds only stats. In
HYPEBOUND the bottom **42 %** of a card is scrims, text box and stat chips
(`01-art-requirements.md` §0). Clipping 27 % would cut into the text box and hide the
attack/health chips entirely.

> **[DECISION] Clip 22 %, not 27 %.** [D] This keeps the name banner (392–442 of 680 =
> 58–65 % down) and the first rules line visible while still pushing the card off the
> screen edge for the "hand hangs off the bottom" feel. The **attack/health chips will
> still be clipped, and that is correct** — the reference also never shows them in hand,
> and the hover preview is where full reading happens.

**(e) There is no art window to extrude a minion from.** §8.2's extrusion pulls the
medallion out of the card's oval art window. Full-bleed cards have no such window.

> **[DECISION] Use Variant B (dissolve, §8.3) as HYPEBOUND's primary summon.** [D] The
> whole card becomes a Current-tinted energy silhouette, the board unit fades in *inside
> it*, and a dust ring at **1.15× the unit footprint** punches out on the slot. This
> reads better with full-bleed art (the art *is* the card, so dissolving the card into
> the unit is literally true) and avoids inventing a window that does not exist.

### 12.3 Currents replace the rarity bezel — and the medallion becomes the silhouette

The reference has exactly **one** shape for every board unit (an oval) and uses the
**bezel material** (steel vs gold) as its only board-level rarity signal.

HYPEBOUND has **8 Currents with mandated distinct frame silhouettes** (core rules §8.2:
flame-notched, wave-edge, hexagonal stone, ribbon-cut asymmetric, circuit-notched,
circular radiant, fractured shard, crystal-facet), already implemented as `traceFrame()`
in `src/ui/cardRenderer/frameShapes.ts`. Core rules §8.2 requires "colour must never be
the only differentiator", and art principle **A2** requires greyscale identifiability.

> **[DECISION] ADOPT the medallion concept, REJECT the oval.** [D] A board unit is a
> **stripped-down card**: art, Current frame silhouette, and two stat chips — no name, no
> cost, no rules text, no type line. But its **outline is the Current's frame silhouette**
> at medallion proportions, not a universal oval.
>
> **Reuse `traceFrame()` directly** so the hand card and the board unit are provably the
> same shape at two sizes. This is strictly *more* readable than the reference: HYPEBOUND
> players will identify a unit's Current from its silhouette across the board, which
> Hearthstone cannot do at all.

**Board unit proportions** — keep the reference's relationship to the hand card:

| Property | Value |
|---|---|
| Board unit width | **same as a hand card = 7.7 % W (148 px)** |
| Board unit height | **77 % of hand card height = 14.0 % H (152 px)** |
| Attack chip | circle, Ø 0.24 × unit width, offset (−0.29 W, +0.46 W) from centre |
| Health chip | teardrop, offset (+0.36 W, +0.44 W) |
| Keyword badge | centred at (0, +0.66 × unit width) below the frame |

Note the board unit is now **wider than the reference's** (7.7 % vs 6.15 % W), which
interacts with slot pitch — see §12.4.

**Rarity needs a new channel.** Since the frame silhouette is spent on Current and the
frame *material* would fight the Current palette, use the **rarity gem row** that already
exists in the card's bottom band (`01-art-requirements.md` §0) promoted to a small
**gem cluster pinned to the board unit's bottom-centre**, adjacent to the keyword badge
[I]. Alternatively reserve an **animated rim treatment** (not a colour change) for
legendaries. **This is a genuine open design question — the reference gives no guidance
because it solved it with a channel HYPEBOUND has already spent.**

### 12.4 Six fixed slots: the dense row and make-room must be REJECTED

**This is the most consequential adaptation, and it is a correctness issue, not a taste
one.**

The engine defines `board: (CharacterInstance | null)[]` at a **fixed length of 6**
(core rules §3: "Board slots (characters) | 6 per player"), and `adjacent` resolves in
`src/engine/effects.ts` as:

```ts
case "adjacent": {
  const board = ctx.state.players[source.controller].board;
  for (const offset of [-1, 1]) {
    const neighbour = board[source.slot + offset];
    if (neighbour) refs.push(refOf(neighbour));
  }
}
```

**A null slot is skipped, not looked through.** So a character with an empty slot to its
left has **no left neighbour** — and that is a gameplay-visible fact that `adjacent`
targeting, and any card referencing it, depends on.

If HYPEBOUND rendered the reference's **dense, centre-justified row**, a hole in the
middle of the board would visually close up, and two characters that the engine treats as
**non-adjacent would appear side by side**. The UI would be lying about a targeting rule.
That is unacceptable regardless of how good the make-room animation feels.

> **[DECISION] REJECT the dense centre-justified row. Use a fixed 6-slot lattice.** [D]
>
> ```
> slot_i_x = ROW_CENTRE + (i − 2.5) × PITCH        // i = 0..5, always
> ROW_CENTRE = 49.7 % W
> PITCH      = 8.1 % W (156 px)                     // see below
> row_y      = 37.2 % H (enemy) / 54.1 % H (player)
> ```
>
> Slot positions are **constant for the entire match**. Nothing ever slides.

**Pitch must grow.** The reference's 7.34 % W pitch assumed a 6.15 % W oval; HYPEBOUND's
unit is 7.7 % W. Preserving the reference's ~23 px gutter (0.19 × unit width) gives
**pitch = 7.7 % + 0.4 % ≈ 8.1 % W (156 px)** [D]. Six slots then span
`5 × 156 + 148 = 928 px = 48.3 % W`, centred on 49.7 % W → **x 25.5 %–73.8 % W**. That
fits inside the 61.5 % W playfield with room to spare. Verify against the final playfield
art before locking.

**Three consequences follow, and each needs replacing:**

**(a) Make-room is gone — so the drop indicator must come back.** §7.4's "no drop
indicator" was only viable *because* the make-room slide was doing that job. With fixed
slots there is nothing to slide, so HYPEBOUND **must** render an explicit target
affordance.

> **[DECISION] Empty slots render as quiet, always-visible sockets** — a recessed
> shape-matched depression at ~15 % opacity, readable but never competing with occupied
> slots. This is *required* for adjacency legibility, not optional decoration: the player
> must be able to see the holes.
>
> **On drag over the board, the socket nearest the cursor lights up** with the dragged
> card's **Current colour**, ramping in over **≤ 100 ms** (matching the reference's
> hard-switch highlight timing, §3.3) and out in one frame. Keep the reference's other
> drop signal — **the card turning to a hologram ghost** (§7.2) — verbatim, and tint the
> hologram with the Current instead of the reference's universal blue-violet (§12.5).

**(b) Death must NOT reflow the row.** §10.1's survivor slide is a direct consequence of
the dense row. In HYPEBOUND a dead character **leaves its socket empty and the survivors
do not move** — because they genuinely did not become adjacent. **Keep the corpse fade
timing exactly** (800 ms hold, 400 ms fade, gone at 1000 ms); simply delete the reflow
step. The board settles ~400 ms faster than the reference as a result, which is fine.

**(c) The τ = 0.18 s smooth-damp is not wasted.** Redirect it to every remaining layout
motion: hand re-fan, drawn-card arrival, hover-out, socket highlight ramps, and any
future board-state animation. It is the *feel* constant for the whole screen, not a
make-room constant.

**The honest trade:** HYPEBOUND loses the reference's single most satisfying board
animation. It gains rule-correct adjacency, constant slot positions (which make
hit-testing, targeting arrows and replay scrubbing trivially stable), and a board where
the player can count their open slots at a glance. **Given a 6-slot cap and
index-addressable adjacency, this is not a close call.**

### 12.5 Obsession, Confluences, and Current colour

**Obsession meter.** Core rules §3.2: 0–10, thresholds at **3** (Fixation), **7**
(Ultimate Fixation), **8** (**Obsessed** — your leader takes **+1 damage from all enemy
sources**), **10** (Full Fixation → resets to 5). The reference has no analogue **[U]**,
so this is designed from its principles rather than copied.

> **[DECISION] Mirror the mana tray's grammar on the opposite side of the hero.** [D]
> The mana trough sits at **x 62.4 %–85.8 %, y 89.8 %–94.6 %** (right of the player hero).
> Place the **Obsession meter at the mirrored position, x 14.2 %–37.6 %** — left of the
> hero, in the currently-empty decorative margin — as a track of **10 pips** using the
> same physical-object language.
>
> Apply the reference's proven patterns:
> - **Three pip states**, exactly as mana crystals (§11.11): empty, filled, and
>   **"would be gained/spent by the card you are hovering"** blown out to white. The
>   third state is the highest-value affordance in the reference; Obsession is precisely
>   the kind of resource that needs it.
> - **Instant text, slow art** (§7.1): the numeric readout snaps; the pips fill over
>   **700 ms** with an ease-out.
> - **Threshold markers are structural, not coloured** — a visible notch in the track at
>   3, 7 and 10, so the player reads their distance to a Fixation by *shape*, satisfying
>   A2 and core rules §8.2.
> - **The Obsessed state (8+) is a liability and must be legible as one.** The reference's
>   language for "this object is in a special state" is a **rim glow on the object
>   itself** (§3.3), not a HUD badge. Put a **persistent warning rim on the player's own
>   hero portrait** while Obsessed, in the damage-red family, so the +1 vulnerability is
>   attached to the thing that suffers it. Reuse the §3.3 ramp (≤ 100 ms on, one-frame
>   off).
> - **Full Fixation at 10** is a set-piece and already budgeted at 400 ms in
>   `02-animation-requirements.md`. Borrow the **turn-banner grammar** (§12.6) at reduced
>   scale rather than inventing a new one.

**Confluences.** Nine of them, once per player per turn, requiring a button with **both
Current symbols and a rules preview** (core rules §8.5).

> **[DECISION] Confluence availability uses the AMBER outline slot.** [D] §5.4 established
> a two-tier outline language: **green = affordable**, **amber = affordable *and* a
> conditional bonus is live**. A Confluence being available is exactly a live conditional
> bonus. So: cards that would *complete* an available Confluence render **amber instead
> of green**, and the Confluence button itself takes the **End Turn button's
> "you-have-something-to-do" treatment** — the pulsing glow ring from §11.14 — since that
> pattern is already proven to draw the eye without a modal.
>
> The **rules preview** should reuse the **keyword tooltip** exactly (§6.4): 230 px fixed
> width, +400–600 ms dwell, 200 ms fade in, **instant dismissal**, placed on whichever
> side has more room. Do not invent a second panel style.
>
> Place the Confluence button **adjacent to the Obsession meter** on the left margin, so
> the left side of the screen owns "your resources and your set-pieces" and the right side
> owns "mana, deck, end turn" — mirroring the reference's clean left/right split.

**Current colour discipline.** The reference keys **effect colour to effect type, not to
the card** (§10.1): magenta = deathrattle, white/yellow = damage, orange = fire. HYPEBOUND
already mandates a per-Current motion and particle signature
(`02-animation-requirements.md` §4).

> **[DECISION] Split the channel by layer.** [D] **Effect *type* owns the core shape and
> the flash colour** (damage stars stay gold-and-white on every Current, so damage always
> reads as damage). **Current owns the particles, the trail, the tint of the summon
> dissolve, and the hologram tint.** This keeps the reference's most valuable property —
> you can identify *what happened* peripherally, without reading — while still giving all
> 8 Currents a distinct signature. If Current colour were allowed to recolour the damage
> star, damage would stop being instantly recognisable, and that would be a net loss.

### 12.6 The rope, the history rail, and other chrome

**The rope [ADAPT].** §11.17's "the divider *is* the timer" is a genuinely great idea, but
`02-animation-requirements.md` already specifies a **ring timer that turns red with a
countdown at 15 s**, and that spec is canon and accessibility-reviewed.

> **[DECISION] Keep the ring timer as the authoritative countdown; add a burning seam as
> a redundant ambient cue.** [D] The seam at **45.6 % H** already exists as a board
> feature; making it consume left → right over the turn costs one shader and gives the
> peripheral-vision benefit without replacing an accessible, numeric timer. **Both must
> agree**, and the ring remains the one that carries the number.

**The play-history rail [REJECT as reference].** Two independent studies identified the
left-edge thumbnail column in the capture as **third-party deck-tracker and stream
overlay chrome, not game UI**. Its 48 × 48 tiles, 57 px pitch and colour-coded borders
must **not** be copied as though they were reference material.

However, HYPEBOUND's own requirements list **"action history"** as a required battle
element (`REQUIREMENTS.md` §Battle, and `03-screens-and-navigation.md` §4.4.6). So:
**build a history rail because HYPEBOUND requires one — and design it deliberately from
this document's principles**, not by tracing an artifact. The reference *does* legitimately
supply the relevant grammar: new entries should **fly in over ~500 ms with an ease-out
while the stack slides down** (layout leads content, §11.1), and entries should be
**icon-coded by action type**, since that is the same silhouette-first logic as §3.2.

**End Turn button [ADOPT wholesale].** The state machine in §11.13–14 is complete and
directly usable: label + colour + material change for the opponent's turn; gold for your
turn; **bright green with a pulsing glow ring when you have no legal plays left**; one
frame of solid green on press. No slide, no tween — every swap is a hard cut.

**Opponent tells [ADOPT].** §11.15. HYPEBOUND's AI (`14-ai-design.md`) should telegraph
the same way: the card it is about to play slides 20–40 px out of the fan with an amber
rim for ~1.2 s (600 ms near-linear extension, 200 ms hold, 400 ms snappier retraction)
before committing. Free tension, and it makes the AI feel like it is thinking.

### 12.7 Reconciling with `02-animation-requirements.md`

Four genuine conflicts. `02-animation-requirements.md` is canon for *budgets*; this
document is the reference for *shape and feel*. Resolutions:

| Event | Existing budget | Reference [M] | Resolution |
|---|---|---|---|
| **Attack declared** | 380 ms, "lunges ~0.7 units and returns" | ≤ 400 ms out-and-back, 20 % lean, 1.15× scale | **No conflict — keep 380 ms.** Adopt the reference's *shape*: express the lunge as **"20 % of the distance to the target, until silhouettes touch"** rather than a fixed 0.7 units, so diagonal and long-range attacks scale correctly. |
| **Damage dealt** | 240 ms, "screen shake at ≥ 4 damage" | impact ≤ 200 ms; **number pinned ~2200 ms**; **zero shake** | **Separate the two clocks.** The 240 ms budget is the *impact animation* and is correct. The **damage number is a persistent board annotation, not an animation**, with a ~2200 ms lifetime + 400 ms fade — it must not block the presenter or count against the budget. **Add a `DAMAGE_NUMBER_LIFETIME` entry to `TIMING` separate from `damageDealt`.** |
| **Screen shake** | on at ≥ 4 damage, opt-out | **none anywhere, verified to sub-pixel** | **ADOPT WITH A CAP.** The reference proves shake is unnecessary for weight. But HYPEBOUND's shake is already accessibility-gated and reserved for ≥ 4 damage, which is a rarer, more meaningful event. **Keep it, cap the amplitude at 4 px** (§9.6: 3–4 px reads clearly against a ≤ 0.8 px idle bob), and **make the default OFF for the first session** — earn the shake, do not spend it on every hit. |
| **Character defeated** | 380 ms, "dark particle scatter, card fades" | 800 ms hold → 400 ms fade → gone at 1000 ms | **Conflict — the reference is slower and better.** The 800 ms hold before fading is a primary reason the reference feels expensive (§11.4). But 1000 ms × several deaths breaks the "a full turn never exceeds a few seconds" principle. **Compromise: 600 ms total — 300 ms hold, 300 ms fade** [D], preserving the *pattern* (a beat of stillness, then a fade, never an instant vanish) at 60 % of the reference's duration. Deaths already **parallelise** in HYPEBOUND, and with §12.4's reflow deleted there is no follow-on slide to wait for. |

Two further alignments, no conflict:

- **Card played (420 ms) + Character summoned (300 ms) = 720 ms** against the reference's
  ~900–1000 ms. **Keep 720 ms** — it is within 20 % and the reference's tail is largely
  sparkle decay, which can overlap the next action.
- **Reduced motion** (×0.25) and the skip path apply to everything here without
  modification. Note specifically: **damage numbers must remain fully visible in reduced
  motion** — they are information, not motion. Their *jitter* (§10.2) should be disabled,
  their lifetime should not.

### 12.8 Source disagreements, resolved

Recorded so future readers do not re-litigate them:

| Disagreement | Resolution |
|---|---|
| **Far-row minions 7–9 % smaller?** | **No.** Two segments inferred foreshortening from cross-frame comparisons of *different objects*. A same-frame comparison of comparable objects gives **ratio 1.00** on four independent measurements. **No per-row scale.** |
| **Hand card size** (125×185 … 155×235 across 8 reports) | **130 × 197.** The focused study used sub-pixel template matching; the segments used eyeballed bounding boxes at varying glow inclusion. |
| **Hover scale** (2.15× … 2.8×) | **×2.45.** Four measured events; the 2.8× figure included the outer glow, the 2.15× figures measured the opponent's *reveal panel*, which is a different element. |
| **Hand fan: flat or arced?** | **Both — it depends on count.** Reports describing a flat hand all observed 3 cards; reports describing a ± 10–25° fan all observed 4–5. The discontinuity at 4 is real and independently corroborated. |
| **Make-room trigger: hover / grab / release / commit?** | **When the card leaves the hand** — mouse-down for a human, commit for the AI. Every report is consistent with this once "hover" is distinguished from "grab". |
| **Damage-number lifetime: 400 ms or 2200 ms?** | **~2200 ms.** Both observations share the same *final* frame; the 400 ms report entered mid-life and caught only the fade. |
| **Rope direction and speed** | **Left → right at ~54 px/s.** Two reports give monotonically increasing tip x over multi-second spans (unambiguous); the dissenting report inferred direction from a single frame. The 43 px/s figure came from a shorter span. |
| **Make-room τ: 0.15 s or 0.2 s?** | Genuinely spans **0.15–0.20 s** across events. **Specify 0.18 s.** |
| **Is the left-edge thumbnail rail game UI?** | **No — third-party overlay.** Two studies identified it independently. §12.6. |

### 12.9 Acceptance checklist for the rebuild

- [ ] Camera is orthographic, axis-aligned, **zero tilt**; all gameplay meshes at
      `rotation = (0,0,0)`; `z` used only for the §2.4 draw order
- [ ] Board decoration lives in the **backdrop texture**, not on a ground plane
- [ ] A far-row and a near-row unit measure **identical** in a screenshot
- [ ] Every layout coordinate derives from a **screen-proportion constant**, not a
      hard-coded pixel or world unit
- [ ] Six slots render at **constant x for the whole match**; empty sockets are visible
- [ ] A hole in the middle of the board is **visually obvious** (adjacency legibility)
- [ ] Death leaves a hole; **survivors do not slide**
- [ ] Dragging over the board highlights the **target socket** in the card's Current colour
- [ ] Board unit silhouette is `traceFrame()` for the card's Current, at 77 % card height
- [ ] Attack = circle, health = teardrop, cost = hexagon, durability = shield — all
      identifiable in **greyscale at 25 % zoom**
- [ ] Hand is flat at ≤ 3 cards and snaps to a ± 21.5° fan at 4
- [ ] Hover: instant in, **300–400 ms eased out**, neighbours provably do not move
- [ ] Hover disclosure fires at 0 / +200 / +500 ms and dismisses **instantly**
- [ ] Mana and Obsession: **text snaps, pips animate over 700 ms**
- [ ] Damage numbers are **pinned, do not float, and outlive their target** ~2200 ms
- [ ] Screen shake never exceeds **4 px** and is off by default
- [ ] Layout always leads content: **every slot opens before the thing that fills it arrives**
- [ ] Camera is pixel-stable across an impact frame (cross-correlate to verify)
