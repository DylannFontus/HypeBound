# HYPEBOUND — UI Component Inventory

> **Status:** Technical specification. Subordinate to `../design/00-core-rules.md`
> (rules canon), `00-architecture-contract.md` (tech canon) and `../../src/engine/types.ts`
> (shape canon). Where this document gives pixel values, colours or timings they are
> **defaults** implemented in `src/ui/theme/base.css` (CSS custom properties) and
> `src/ui/cardRenderer/palette.ts` (canvas mirror) — components never hardcode raw values.
>
> This document is the complete component inventory for every screen listed in
> `../design/03-screens-and-navigation.md`. For each component it gives **purpose**,
> **states**, **key props**, and **which screens use it**. Layout of the screens
> themselves is owned by the screens document; this document owns the parts.

---

## 1. Scope, layers and conventions

### 1.1 The five rendering layers

Per architecture contract §5 the client is a hybrid: three.js is used for the battle
board and the lobby background scene, everything else is DOM. Every component in this
document belongs to exactly one layer.

| Layer | Tag | Technology | Owner modules | Notes |
|---|---|---|---|---|
| L1 — Screen DOM | `dom` | HTML + CSS custom properties | `src/ui/screens/**`, `src/ui/components/**` | Accessible, text-scalable, keyboard-navigable. Default for everything. |
| L2 — Card canvas | `canvas` | Canvas 2D via `cardRenderer/` | `src/ui/cardRenderer/**` | One renderer, two consumers (DOM `<canvas>` and three.js `CanvasTexture`), so a card is pixel-identical everywhere. |
| L3 — Board 3D | `3d` | three.js | `src/ui/battle/{scene,board,cards3d}.ts` | Board, card meshes, slot markers, lighting, VFX. Never renders text that must scale. |
| L4 — HUD overlay | `hud` | DOM positioned over the WebGL canvas | `src/ui/battle/hud.ts` | All battle numbers, meters, rails and buttons. Anchored to 3D objects through `scene.project()`. |
| L5 — Overlay / modal | `overlay` | DOM, above everything | `src/ui/components/**` | Dialogs, toasts, tooltips, card enlargement, mulligan, victory sequence. Never nests more than 2 deep. |

**Binding rule:** no gameplay-relevant number is ever rendered only inside L3. Health,
attack, cost, Obsession, Hype, timers and status magnitudes are either L2 canvas text
baked at high resolution or L4 DOM text that obeys the accessibility text scale.

### 1.2 Component contract

Every component is a plain factory function — no framework, no runtime dependency
beyond `three` and `zod` (contract §1).

```ts
export interface Component<P> {
  /** root element (L1/L4/L5) or Object3D (L3) */
  el: HTMLElement;
  /** re-render from new props; must be idempotent and allocation-light */
  update(next: Partial<P>): void;
  /** release listeners, observers, GPU resources */
  destroy(): void;
}

export function createButton(props: ButtonProps): Component<ButtonProps>;
```

Rules enforced by review:

1. **No rules logic.** Components render `EngineEvent`/`PlayerView`/`predict()` output.
   They never compute damage, legality, cost or win conditions (contract §3).
2. **Every string through `i18n.t()`.** Components take i18n *keys* or already-resolved
   strings, never hardcoded English.
3. **Every colour through a token.** DOM components use `var(--token)`; canvas
   components read `CURRENT_PALETTE` / `RARITY_STYLE` / `FACTION_COLOR`, which mirror
   the CSS tokens.
4. **Never colour-only.** Every state that carries meaning also carries a glyph, a
   silhouette, a label, or a text value (core rules §10).
5. **Update, don't rebuild.** `update()` mutates in place; components with canvas
   content cache by a key describing everything that can change the pixels.

### 1.3 Shared state vocabulary

All components draw their states from this fixed vocabulary; component sections list
only the states that are meaningful for them plus any component-specific ones.

| State | Applied as | Meaning |
|---|---|---|
| `default` | — | Resting. |
| `hover` | `:hover` (pointer:fine only) | Pointer is over the target. Never the only affordance — touch has no hover. |
| `focus` | `:focus-visible` | Keyboard/controller focus. 2 px `--accent-bright` outline, offset 3 px. |
| `pressed` | `:active` / `[data-pressed]` | Pointer or key is down. |
| `selected` | `[aria-selected]` / `[data-selected]` | Persistent choice (tab, filter, deck slot). |
| `disabled` | `[disabled]` / `[aria-disabled]` | Not actionable now; 42 % opacity **plus** a reason tooltip. |
| `loading` | `[data-loading]` | Awaiting async work; shows `Spinner`, keeps its box size. |
| `error` | `[data-error]` | Invalid input/state; red token **plus** an error glyph and message. |
| `empty` | `[data-empty]` | Zero content; shows `EmptyState`, never a blank box. |
| `dimmed` | `[data-dimmed]` | Present but not currently relevant (unowned card, illegal target). |

### 1.4 Density, sizing and touch

| Fact | Value |
|---|---|
| Reference resolution | 1280×720 landscape; layout scales fluidly to 4K |
| Density modes | `comfortable` (default), `compact` (auto below 900 CSS px of width, i.e. most phones in landscape) |
| Minimum hit target | 44×44 CSS px, all layers, both densities |
| Base spacing scale | `--sp-1..7` = 4/8/12/16/24/32/48 px |
| Radii | `--radius-sm` 6, `--radius` 12, `--radius-lg` 20, `--radius-pill` 999 |
| Type scale | `--fs-xs..3xl` = 0.72/0.84/1/1.25/1.6/2.2/3 rem, root font 14–21 px via `[data-text-scale]` |
| Motion | all durations via `--dur-*`; `[data-reduced-motion="true"]` collapses them to fades |
| Contrast | `[data-contrast="high"]` flattens glass and strengthens borders |
| Colour vision | `[data-colorblind="deuteranopia\|protanopia\|tritanopia"]` swaps the Current/faction hue ramps (**decision**: added to `theme/base.css`; shapes and labels are unchanged because they already carry the information) |

### 1.5 Component registry

Complete index; the sections that follow specify each one.

| # | Component | Layer | Module | Section |
|---|---|---|---|---|
| 1 | `CardFrame` (renderer) | canvas | `cardRenderer/renderCard.ts` | §2 |
| 2 | `CardCanvas` | dom | `components/cardCanvas.ts` | §2.10 |
| 3 | `CardTile` | dom | `components/cardTile.ts` | §2.10 |
| 4 | `CardBack` | canvas | `cardRenderer/cardBack.ts` | §2.10 |
| 5 | `CardFace3D` | 3d | `battle/cards3d.ts` | §2.10 |
| 6 | `Button` | dom | `components/button.ts` | §3.1 |
| 7 | `IconButton` | dom | `components/button.ts` | §3.2 |
| 8 | `SegmentedControl` | dom | `components/segmented.ts` | §3.3 |
| 9 | `Toggle` | dom | `components/toggle.ts` | §3.4 |
| 10 | `Slider` | dom | `components/slider.ts` | §3.5 |
| 11 | `SearchField` | dom | `components/searchField.ts` | §3.6 |
| 12 | `FilterChip` | dom | `components/chip.ts` | §3.7 |
| 13 | `Tabs` | dom | `components/tabs.ts` | §3.8 |
| 14 | `CountBadge` | dom | `components/badge.ts` | §3.9 |
| 15 | `ProgressBar` | dom | `components/progress.ts` | §3.10 |
| 16 | `Tooltip` | overlay | `components/tooltip.ts` | §3.11 |
| 17 | `Popover` | overlay | `components/popover.ts` | §3.12 |
| 18 | `Dialog` | overlay | `components/dialog.ts` | §3.13 |
| 19 | `ConfirmDialog` | overlay | `components/dialog.ts` | §3.14 |
| 20 | `Toast` / `ToastHost` | overlay | `components/toast.ts` | §3.15 |
| 21 | `InlineBanner` | dom | `components/banner.ts` | §3.16 |
| 22 | `EmptyState` | dom | `components/emptyState.ts` | §3.17 |
| 23 | `Skeleton` / `Spinner` | dom | `components/loading.ts` | §3.18 |
| 24 | `VirtualGrid` | dom | `components/virtualGrid.ts` | §3.19 |
| 25 | `CurrencyChip` | dom | `components/currencyChip.ts` | §3.20 |
| 26 | `Countdown` | dom | `components/countdown.ts` | §3.21 |
| 27 | `ComingOnlinePanel` | dom | `components/comingOnline.ts` | §3.22 |
| 28 | `LeaderHealthOrb` | hud | `battle/hud.ts` | §4.1 |
| 29 | `ArmorChip` | hud | `battle/hud.ts` | §4.2 |
| 30 | `HypeCrystalRail` | hud | `battle/hud.ts` | §4.3 |
| 31 | `ObsessionDial` | hud | `battle/hud.ts` | §4.4 |
| 32 | `ResonanceTracker` | hud | `battle/hud.ts` | §4.5 |
| 33 | `ZoneCounter` (deck/discard) | hud | `battle/hud.ts` | §4.6 |
| 34 | `TurnTimerRing` + `RopeStrand` | hud | `battle/hud.ts` | §4.7 |
| 35 | `EndTurnButton` | hud | `battle/hud.ts` | §4.8 |
| 36 | `HandFan` | 3d + hud | `battle/hand.ts` | §4.9 |
| 37 | `BoardSlot` | 3d | `battle/board.ts` | §4.10 |
| 38 | `CharacterToken` | 3d + hud | `battle/cards3d.ts` | §4.11 |
| 39 | `StatusIconStrip` | hud | `battle/hud.ts` | §4.12 |
| 40 | `LocationSlot` | 3d + hud | `battle/board.ts` | §4.13 |
| 41 | `ReactionZone` | hud | `battle/hud.ts` | §4.14 |
| 42 | `EventBanner` | hud | `battle/hud.ts` | §4.15 |
| 43 | `FixationButtons` | hud | `battle/hud.ts` | §4.16 |
| 44 | `ConfluenceButton` | hud | `battle/hud.ts` | §4.17 |
| 45 | `TriggerQueueRail` | hud | `battle/hud.ts` | §4.18 |
| 46 | `HistoryRail` / `HistoryEntry` | hud | `battle/hud.ts` | §4.19 |
| 47 | `TargetingArrow` | 3d | `battle/targeting.ts` | §4.20 |
| 48 | `PredictionBadge` | hud | `battle/targeting.ts` | §4.21 |
| 49 | `EmoteWheel` | hud | `battle/hud.ts` | §4.22 |
| 50 | `CardInspectOverlay` | overlay | `components/cardInspect.ts` | §4.23 |
| 51 | `CurrentsGuideOverlay` | overlay | `components/currentsGuide.ts` | §4.24 |
| 52 | `MulliganOverlay` | overlay | `battle/mulligan.ts` | §4.25 |
| 53 | `VictoryDefeatSequence` | overlay | `battle/outro.ts` | §4.26 |
| 54 | `ReplayControlBar` | hud | `battle/hud.ts` | §4.27 |
| 55 | `InMatchMenu` | overlay | `battle/hud.ts` | §4.28 |
| 56 | `CollectionGridCell` | dom | `components/collectionCell.ts` | §5.1 |
| 57 | `CardDetailPanel` | dom | `screens/collection.ts` | §5.2 |
| 58 | `FilterRail` | dom | `components/filterRail.ts` | §5.3 |
| 59 | `DeckListRow` | dom | `components/deckListRow.ts` | §5.4 |
| 60 | `CurveHistogram` | dom | `components/curveHistogram.ts` | §5.5 |
| 61 | `TypeDistributionBar` | dom | `components/deckStats.ts` | §5.6 |
| 62 | `CurrentSplitDonut` | dom | `components/deckStats.ts` | §5.7 |
| 63 | `DeckValidationPanel` | dom | `components/deckValidation.ts` | §5.8 |
| 64 | `DeckSlotCard` | dom | `components/deckSlotCard.ts` | §5.9 |
| 65 | `PackOpeningStage` | dom+canvas | `screens/packOpening.ts` | §5.10 |
| 66 | `PityProgressBar` | dom | `components/pityBar.ts` | §5.11 |
| 67 | `RatesTable` | dom | `components/ratesTable.ts` | §5.12 |
| 68 | `RewardTile` | dom | `components/rewardTile.ts` | §5.13 |
| 69 | `MissionCard` | dom | `components/missionCard.ts` | §5.14 |
| 70 | `MatchHistoryRow` | dom | `components/matchHistoryRow.ts` | §5.15 |
| 71 | `Sparkline` | dom | `components/sparkline.ts` | §5.16 |
| 72 | `TopBar` | dom | `components/chrome.ts` | §6.1 |
| 73 | `PlayerChip` | dom | `components/chrome.ts` | §6.2 |
| 74 | `CurrencyCluster` | dom | `components/chrome.ts` | §6.3 |
| 75 | `BottomNavBar` / `NavItem` | dom | `components/chrome.ts` | §6.4 |
| 76 | `ScreenTransition` | dom | `ui/shell.ts` | §6.5 |
| 77 | `RotateOverlay` | overlay | `ui/shell.ts` | §6.6 |
| 78 | `ConnectionBanner` | overlay | `ui/shell.ts` | §6.7 |

---

## 2. The premium card frame

The card frame is the single most important piece of craft in the product: the brief
requires the premium feel to live in the **frame**, not the art (which arrives later and
may be missing entirely). One renderer produces every card image in the game.

### 2.1 Geometry

| Fact | Value | Source |
|---|---|---|
| Card-space size | **400 × 560** units (5:7 portrait) | `palette.ts` `CARD_W`/`CARD_H` |
| Bleed | 10 units on every side (glow/notches live here) | `LAYOUT.bleed` |
| Frame inset | 13 units (inner bevel) | `LAYOUT.frameInset` |
| Art window | `x 27, y 66, w 346, h 244` | `LAYOUT.art` |
| Name plate | `x 27, y 300, w 346, h 42` | `LAYOUT.namePlate` |
| Text box | `x 27, y 350, w 346, h 158` | `LAYOUT.textBox` |
| Cost gem | centre `(43, 44)`, r 30 | `LAYOUT.costGem` |
| Current badge | `x 232, y 20, w 148, h 46` | `LAYOUT.badge` |
| Faction crest | centre `(200, 44)`, r 19 | `LAYOUT.crest` |
| Attack chip | centre `(48, 520)`, r 31 | `LAYOUT.attackChip` |
| Health chip | centre `(352, 520)`, r 31 | `LAYOUT.healthChip` |
| Rarity gems | centre `(200, 528)`, r 13, 1–4 gems | `LAYOUT.rarityGem` |

All callers draw in card-space and set their own scale, so the same code renders a
176 px collection thumbnail, a 420 px detail view and a 640 px board texture.

### 2.2 Layer stack (paint order)

| Z | Layer | Content | Skipped when |
|---|---|---|---|
| L0 | Outer glow | 26 px shadow in the Current key colour, traced on the silhouette | `compact` (thumbnails) |
| L1 | Frame body | Current silhouette filled with a 5-stop vertical metallic gradient | never |
| L2 | Brushed-metal streaks | 40 hairlines at 7 % alpha | `compact` |
| L3 | Specular sweep | Diagonal white→black gradient across the whole frame | `compact` |
| L4 | Chrome rim | Bright 2.5 px outer stroke + dark 1.5 px inner stroke (inset 4) | never |
| L5 | Inner well | Rounded dark plate (`20,58 → 380,476`) the content sits on | never |
| L6 | Art window | Owner art (cover-fit) or procedural placeholder + bottom vignette + rim | never |
| L7 | Name plate | Gradient plate with the auto-fitted card name | never |
| L8 | Text box | Type line + rich rules text (or flavour if no rules text) | `compact` (renders name only) |
| L9 | Cost gem | Faceted hexagonal Hype crystal with the cost numeral | leaders |
| L10 | Current badge | Current icon + **written Current name** (accessibility guarantee) | never |
| L11 | Faction crest | Ringed monogram, petal count per faction | never |
| L12 | Rarity gems | 1/2/3/4 diamonds — a non-colour rarity count | tokens |
| L13 | Stat chips | Attack (8-point blade) and Health (circle) | non-stat types |
| L14 | **Holo / premium overlay slots** | Foil sweep, alt-art seal, event seal, animated shimmer | non-premium |
| L15 | Interaction ring | Playable / target / selected halo traced on the silhouette | outside battle & builder |

### 2.3 ASCII anatomy

```
             (0,0)                                                        (400,0)
               +----------------------------------------------------------+
               |  (1) OUTER GLOW + BLEED  — 10 u, Current-keyed bloom      |
               |   +----------------------------------------------------+  |
               |   |  (2) CURRENT-SHAPED FRAME BODY  (silhouette varies  |  |
               |   |      per Current — see 2.5; brushed chrome + rim)   |  |
               |   |    _____                                            |  |
               |   |   /     \        (5)          +--------------------+|  |
               |   |  |  (3)  |     ( crest )      | (4) [ico] C I N D E R  |
               |   |   \ COST/                     +--------------------+|  |
               |   |    -----                                            |  |
               |   |   +----------------------------------------------+  |  |
               |   |   |                                              |  |  |
               |   |   |        (6)  A R T   W I N D O W              |  |  |
               |   |   |        346 x 244 @ (27,66)                   |  |  |
               |   |   |   owner art (cover-fit)  OR  placeholder     |  |  |
               |   |   |                                              |  |  |
               |   |   |........ (7) bottom vignette ..................|  |  |
               |   |   +----------------------------------------------+  |  |
               |   |   +----------------------------------------------+  |  |
               |   |   |     (8)  N A M E   P L A T E                 |  |  |
               |   |   +----------------------------------------------+  |  |
               |   |   +----------------------------------------------+  |  |
               |   |   |            CHARACTER - IDOL      <- type line|  |  |
               |   |   |  (9)  **Spotlight.** When you play this,     |  |  |
               |   |   |       give another friendly Idol +1/+1.      |  |  |
               |   |   |       *Enemies must attack characters with*  |  |  |
               |   |   |       *Spotlight before other targets.*      |  |  |
               |   |   +----------------------------------------------+  |  |
               |   |     _____          (11)               _____         |  |
               |   |    /     \       <> <> <>            /     \        |  |
               |   |   < (10)  >   RARITY  GEMS          |  (12) |       |  |
               |   |    \_____/                           \_____/        |  |
               |   |     ATTACK                            HEALTH        |  |
               |   +----------------------------------------------------+  |
               +----------------------------------------------------------+
             (0,560)                                                    (400,560)

  (13) HOLO / PREMIUM OVERLAY  — composited over 1..12, clipped to silhouette (2)
  (14) INTERACTION RING        — traced 3 u outside (2); never overlaps text
```

### 2.4 Layer specifications

**(1) Outer glow / bleed.** 10 units of transparent margin so silhouette spikes
(Cinder flames, Prism facets, Veil shards) can exceed the nominal card rectangle. The
glow is `shadowColor = current.key @ 55 %`, `shadowBlur = 26`. Dropped in `compact`
mode and on the `low` render tier (see `05-performance-and-platform.md` §4).

**(2) Frame body.** `traceFrame(ctx, shape, rect)` fills the Current silhouette with a
five-stop vertical gradient (highlight → key → mid → low → near-black), then adds
brushed streaks and a diagonal specular sweep, then a two-tone chrome rim. This is the
"premium" read: the frame looks like machined, backlit metal at any size.

**(3) Cost gem.** A faceted hexagonal Hype crystal (r 30) at the top-left with a
cyan-blue gradient, an inner facet highlight and the cost numeral at up to 34 px. It is
deliberately the same visual object as the `HypeCrystalRail` pips (§4.3) so "what a card
costs" and "what you have" are literally the same icon. Modified-cost display: when
`costDelta ≠ 0` (Trending, `modifyCost`, aura discounts) the numeral renders in
`--success` for cheaper / `--danger` for pricier **and** a small `▼N` / `▲N` delta glyph
sits at the gem's lower-right — never colour alone.

**(4) Current badge.** Pill at the top-right containing the Current icon and the
**written label** (`CINDER`, `TIDE`, …) at 16 px with 1.5 px letter-spacing. Canon §8.2
requires a written Current label on every card; this badge is that guarantee and must
never be reduced to an icon, even in `compact` mode (in compact the badge shrinks to
icon + 3-letter abbreviation `CIN`/`TID`/`ROO`/`GAL`/`PUL`/`HAL`/`VEI`/`PRI`).

**(5) Faction crest.** Ringed monogram at top-centre, r 19; the petal count
(`3 + factionIndex % 8`) plus the faction colour distinguishes the eleven faction
values. Neutral cards use the grey `--faction-neutral` crest with 3 petals.

**(6) Art window + (7) vignette.** Owner art is cover-fitted; when absent, the
procedural placeholder draws a Current-themed stage composition seeded by the card name
(see `05-performance-and-platform.md` §6.4). A bottom vignette in the Current's abyss
tone guarantees the name plate reads over any image.

**(8) Name plate.** Auto-fitting single line, 25 px down to 13 px. Names longer than the
plate at 13 px are ellipsised and the full name is exposed via the component's
`aria-label` and the inspect overlay.

**(9) Text box.** Two zones: an 11 px letter-spaced **type line**
(`CHARACTER — IDOL`, `ACTION`, `REACTION`, `EQUIPMENT`, `LOCATION`, `TRANSFORMATION`,
`EVENT`, `LEADER`) and the rules body. The body is rich text with a two-token mini
markup — `**bold**` for keyword names, `*italic*` for reminder text — word-wrapped and
auto-shrunk from 17 px to 10 px. Cards with no rules text show their flavour line in
italic at 62 % alpha instead. Per canon §6, reminder text is present on Common/Rare and
omitted on Epic/Legendary; the accessibility setting "detailed card text" re-adds it at
render time without touching card data.

**(10)(12) Stat chips.** Attack is an 8-point blade rosette in amber; Health is a circle
in red. Distinct silhouettes, so a colourblind player never confuses them. Numerals
recolour to `--success` when buffed above base and `--danger` when damaged below max,
**and** the chip gains a small notch mark (`+`/`−`) at its upper-right so the state is
not colour-only. Equipment shows only the stats it grants; Locations show Durability in
the health chip position with a shield-pip glyph; Leaders show health only.

**(11) Rarity gems.** 1 = Common, 2 = Rare, 3 = Epic, 4 = Legendary diamonds. Counting
gems is the accessible rarity read; colour is decoration.

**(13) Holo / premium overlay slots.** See §2.8.

**(14) Interaction ring.** Traced 3 units outside the silhouette in green (`playable`),
red (`target`) or gold (`selected`) with a 22 px bloom. Because it follows the Current
silhouette, the ring itself reinforces the Current at a glance.

### 2.5 The eight Current frame shapes

Frame shape is the primary **non-colour** identifier of a card's Current (canon §8.2).
Shapes are procedural paths in `cardRenderer/frameShapes.ts`, keyed by
`data/currents.json → frameShape`.

| Current | `frameShape` | Silhouette signature | At-a-glance tell | Legible down to |
|---|---|---|---|---|
| Cinder | `flame-notch` | 5 upward flame peaks (15 u, alternating 100 %/60 % height) along the top edge; one wide 12 u ember flare at bottom-centre; 16 u corner radius | "spiky top, dripping bottom" | 96 px wide |
| Tide | `wave-round` | 34 u corner radius; three outward wave bulges (9 u) on each vertical edge, mirrored | "soft pill that breathes at the sides" | 88 px |
| Root | `hex-stone` | 40 u chamfer on all four corners — a true elongated hexagon, no curves | "cut stone slab" | 72 px |
| Gale | `ribbon-sweep` | Asymmetric: 62 u swept cuts at top-right and bottom-left, 14 u at the other two corners, joined by quadratic curves | "leaning into the wind" | 96 px |
| Pulse | `circuit-angle` | 26 u chamfers plus two outward 12 u stepped tabs on the right edge (30–42 % height) and mirrored on the left (58–70 %) | "PCB with solder tabs" | 104 px |
| Halo | `radiant-circle` | Top edge bows upward into a 26 u dome (cubic); bottom is a plain 18 u rounded rect | "domed reliquary" | 80 px |
| Veil | `shard-mirror` | 16 deterministic jagged vertices, ±7 u, every edge broken | "cracked mirror" | 112 px |
| Prism | `crystal-facet` | 16 facet cuts: 22 u corner chamfers plus 6 u protrusions at all four edge midpoints | "cut gemstone" | 104 px |

Supporting rules:

- **Determinism.** `shard-mirror`'s jitter is a fixed trigonometric hash, not RNG — the
  same card renders identically every run and in every replay.
- **Board rim.** `CardFace3D` extrudes a thin emissive rim in the Current's `lo`/`key`
  colours, so the silhouette is still readable under the board's raking light.
- **Below the legibility floor** (thumbnail strips, mini-map, history rail chips) the
  card is not drawn: the `CurrentIcon` glyph + label chip is used instead.
- **Refract.** A character whose Current changed in play (`refract` op / `refracted`
  event) keeps its printed frame in the collection but its **board token** re-renders
  with the adopted Current's shape and a small `⇄` prefix on the badge label
  (`⇄ TIDE`), so the board always shows the live Current used for advantage maths.

### 2.6 Frame variants by card type

| Card type | Cost gem | Stat chips | Extra furniture |
|---|---|---|---|
| `character` | yes | Attack + Health | Keyword badge row below the name plate |
| `action` | yes | none | Text box gains 24 u height (no stat row) |
| `transformation` | yes | none | Type line reads `TRANSFORMATION`; a chevron watermark behind the text box |
| `reaction` | yes | none | Diamond "trap" notch on the left rim; type line names the trigger condition |
| `equipment` | yes | granted stats only | Two hanger hooks drawn on the frame's top inner edge |
| `location` | yes | Durability in the health slot | Durability rendered additionally as pips under the name plate |
| `event` | yes | none | Duration pill (`3 TURNS`) at the text box's top-right |
| `leader` | **no** | Health only | Wider name plate with `title` subline; two ability strips (Fixation 3 / Ultimate 7) replacing the lower text box |
| token (`token:true`) | yes | Attack + Health | No rarity gems; frame body renders at 70 % rim brightness |

### 2.7 Holo / premium overlay slots

Cosmetic variants never change rules identity (canon §9, `variantOf`). Four composable
overlay slots exist; a variant may use any subset.

| Slot | Composite | Content | Cost to render |
|---|---|---|---|
| `foil` | `screen` | Animated diagonal sweep (cyan → white → pink) driven by `phase` | 1 gradient fill per frame |
| `holoPattern` | `overlay` | Static per-Current interference pattern (masked to art window only) | 1 cached pattern fill |
| `seal` | `source-over` | Corner seal glyph: `ALT ART`, `EVENT`, `SIGNED` | 1 path + label |
| `frameSkin` | replaces L1–L4 | Alternate frame material (e.g. "Obsidian", "Convention Gold") from the cosmetics catalog | full frame repaint |

States: `off` (default), `static` (reduced motion / low tier — foil renders as a fixed
30° gradient), `animated` (60 fps `phase` advance, only for the focused card — see
performance doc §3.3). Collection previews animate at most **one** card at a time.

### 2.8 Renderer props

```ts
export interface RenderCardOptions {
  art?: HTMLImageElement | ImageBitmap | null; // omit => procedural placeholder
  premium?: boolean;                            // foil slot on
  phase?: number;                               // 0..1 foil animation phase
  compact?: boolean;                            // thumbnail detail level
  dimmed?: boolean;                             // unowned / unplayable
  highlight?: "none" | "playable" | "target" | "selected";
  liveAttack?: number;                          // board character's current stats
  liveHealth?: number;
  liveMaxHealth?: number;
}
```

**Decision — additions required by this document** (extend the interface; defaults keep
current behaviour): `costOverride?: number` + `costDelta?: number` (Trending / aura
pricing), `currentOverride?: CurrentId` (Refract), `detailedText?: boolean`
(accessibility reminder text), `overlays?: { foil?: boolean; holoPattern?: boolean;
seal?: "alt" | "event" | "signed"; frameSkin?: string }`, and `tier?: "high" | "medium"
| "low"` (drops L0/L2/L3 on low).

### 2.9 Card wrapper components

#### `CardCanvas` — `dom`
**Purpose.** Wrap the canvas renderer in a DOM element with correct DPR handling,
art-load invalidation, and an accessible text alternative.
**States.** `default`, `hover` (lift 6 px + 1.04 scale), `focus`, `selected`, `dimmed`,
`loading` (placeholder art still rendering), `animated` (foil ticking).
**Key props.**
```ts
interface CardCanvasProps {
  card: CardDef;
  width: number;                 // CSS px; height derived from the 5:7 ratio
  options?: RenderCardOptions;
  interactive?: boolean;         // adds tabindex, hover/press affordances
  onActivate?: (card: CardDef) => void;      // click / Enter / Space
  onInspect?: (card: CardDef) => void;       // right-click / long-press 400 ms
}
```
**Behaviour.** Subscribes to `onArtLoaded()`; when the owner's art for this card id
appears, it re-renders once. Text alternative: `role="img"` with
`aria-label = "{name}. {cost} Hype. {current} {type}. {attack}/{health}. {rules text}"`.
**Used by.** Collection, Deck builder, Card detail, Patch notes diff, Reward claim,
Pack opening, Inbox deck previews, Character gallery, Mulligan, Card enlargement.

#### `CardTile` — `dom`
**Purpose.** `CardCanvas` plus collection metadata furniture (ownership pips, badges).
Specified fully as `CollectionGridCell` in §5.1.

#### `CardBack` — `canvas`
**Purpose.** The face-down card image: deck stacks, enemy hand, set Reactions, pack
fronts. Rendered once into a 256×358 cached texture; cosmetic card backs replace the
texture by id (`cardBackId` on `DeckList`).
**States.** `default`, `selected` (deck-builder picker), `dimmed`.
**Key props.** `{ backId: string; width: number }`.
**Used by.** Battle (enemy hand, decks, Reactions), Deck builder (card-back picker),
Shop, Pack opening, Match history thumbnails.

#### `CardFace3D` — `3d`
**Purpose.** A card as a board object: front plane textured by the shared renderer, back
plane, and an emissive rim box giving physical thickness.
**States.** `faceUp`/`faceDown`, `idle`, `hovered` (lift + tilt toward camera),
`dragging` (easing disabled, `immediate = true`), `attacking`, `damaged` (shake +
red flash — suppressed by the screen-shake setting), `defeated` (fade + fall),
`summoningSick` (desaturated rim, no ring).
**Key props.** `{ card: CardDef; faceUp: boolean; userData: { kind: "hand"|"board"|"leader"; instanceId; cardId; seat } }`
plus per-frame animation targets `targetPosition`, `targetRotation`, `targetScale`.
**Used by.** Battle only.

### 2.10 Standard render sizes

| Context | CSS width | Texture width | Detail level |
|---|---|---|---|
| History rail chip | — | — | icon+label only (no card) |
| Deck list row thumb | 34 px | 34 px | `compact` |
| Collection grid cell | 176 px | 176 px | `compact` |
| Deck-builder pool cell | 150 px | 150 px | `compact` |
| Hand card (rest) | 132 px equiv. | 320 px board texture | full |
| Hand card (hovered) | 220 px equiv. | 320 px board texture | full |
| Board character | 150 px equiv. | 320 px board texture | full |
| Card detail panel | 420 px | 420 px | full + foil |
| Card enlargement overlay | 500 px | 500 px | full + foil |

---

## 3. Primitives

### 3.1 `Button` — `dom`
**Purpose.** The single text-action primitive. Variants carry meaning: `primary` (one
per screen region), `secondary`, `ghost`, `danger`, `play` (the lobby hero button with
its sheen sweep).
**States.** `default`, `hover` (lift 2 px + glow), `pressed` (0.985 scale), `focus`,
`disabled` (+ reason tooltip), `loading` (spinner replaces the label, width locked),
`selected` (toggle buttons only).
**Key props.**
```ts
interface ButtonProps {
  label: string;                 // i18n-resolved
  variant?: "primary" | "secondary" | "ghost" | "danger" | "play";
  size?: "sm" | "md" | "lg";     // 36 / 44 / 76 px min-height
  icon?: IconId; iconSide?: "start" | "end";
  disabled?: boolean; disabledReason?: string;
  loading?: boolean;
  onClick(): void;
  hotkey?: string;               // shown as a kbd hint on desktop
}
```
**Used by.** Every screen.

### 3.2 `IconButton` — `dom`
**Purpose.** Square icon-only actions (settings gear, close, back, reroll, favourite).
**States.** As `Button`, plus `active` (persistent toggle such as favourite/lock).
**Key props.** `{ icon: IconId; label: string /* required, used for aria-label + the "show icon labels" accessibility mode */; badge?: number; onClick(): void }`.
**Used by.** Top bar, dialogs, collection cells, battle HUD, filter rail.

### 3.3 `SegmentedControl` — `dom`
**Purpose.** 2–5 mutually exclusive options shown at once (animation speed, grid/detail
view, 1×/2×/4× replay speed, AI difficulty).
**States.** per segment: `default`, `selected`, `hover`, `focus`, `disabled`.
**Key props.** `{ options: {id, label, icon?}[]; value: string; onChange(id): void; density?: "comfortable"|"compact" }`.
**Used by.** Settings, Accessibility settings, Collection, Match history, Mode selection,
Replay bar.

### 3.4 `Toggle` — `dom`
**Purpose.** Boolean setting. Always paired with a label and, where behaviour is
non-obvious, a one-line description.
**States.** `off`, `on`, `focus`, `disabled`, `indeterminate` (mixed selection in bulk
operations). The knob carries a `✓`/`✕` glyph so state is not colour-only.
**Key props.** `{ checked: boolean; label: string; description?: string; onChange(v): void }`.
**Used by.** Settings, Accessibility, Privacy, Spending controls, Banner page
(animation skip), Collection (locks).

### 3.5 `Slider` — `dom`
**Purpose.** Continuous ranges: 5 audio channels + master, text scale, pointer
sensitivity, resolution scale.
**States.** `default`, `dragging`, `focus` (arrow keys ±1 step, Home/End), `disabled`.
**Key props.** `{ value, min, max, step, label, valueFormat?: (n) => string, onInput(v), onCommit(v) }`.
Always shows the numeric value; audio sliders play a preview tick on commit.
**Used by.** Settings, Accessibility settings.

### 3.6 `SearchField` — `dom`
**Purpose.** Text search over cards, articles, FAQ, clubs.
**States.** `empty`, `typing` (debounce 120 ms), `results`, `noResults`, `focus`.
**Key props.** `{ placeholder, value, onChange(v), suggestions?: string[], scopeChips?: Chip[] }`.
**Used by.** Collection, Deck builder, Crafting workshop, Patch notes, Support FAQ,
Fan Clubs.

### 3.7 `FilterChip` — `dom`
**Purpose.** One filter value (faction, cost, rarity, type, keyword, Current, ownership).
**States.** `default`, `selected` (filled + check glyph), `hover`, `focus`, `disabled`
(no matching results), `count` (shows matching-card count when the filter rail is open).
**Key props.** `{ id, label, icon?: IconId, selected: boolean, count?: number, onToggle(id): void }`.
**Used by.** Collection, Deck builder, Crafting workshop, News, Match history,
Statistics dashboard.

### 3.8 `Tabs` — `dom`
**Purpose.** Sibling views inside one screen (Daily/Weekly, Shop tabs, Achievements
categories, card detail tabs).
**States.** per tab: `default`, `selected`, `focus`, `disabled`, `badge` (unclaimed
count), `comingOnline` (greyed + tag).
**Key props.** `{ tabs: {id, label, badge?, disabled?, tag?: "coming-online"}[]; value; onChange(id) }`.
**Used by.** Missions, Shop, Achievements, Collection detail, Leaderboards, Event hub,
Deck builder (list/stats/compare).

### 3.9 `CountBadge` — `dom`
**Purpose.** Small numeric overlay (inbox unread, unclaimed rewards, owned copies, deck
count). Never used for promotion (screens doc §5.4 rule 7).
**States.** `hidden` (count 0), `number` (1–99), `overflow` (`99+`), `dot` (unspecified
new content), `urgent` (expiring — adds a clock glyph).
**Key props.** `{ count?: number; dot?: boolean; tone?: "neutral" | "accent" | "urgent"; label: string }`.
**Used by.** Bottom nav, Top bar, Inbox, Reward claim, Collection cells, Missions.

### 3.10 `ProgressBar` — `dom`
**Purpose.** Determinate progress: mission progress, pass tier XP, mastery, pity
counters, loading stages.
**States.** `empty`, `partial`, `complete` (adds ✓ glyph), `overflow` (segment beyond
100 % rendered striped), `indeterminate`.
**Key props.** `{ value, max, label, valueText?: string, segments?: number, tone?: "accent"|"gold"|"success" }`.
Always shows `value/max` as text next to the bar.
**Used by.** Missions, Battle pass, Achievements, Profile, Banner page, Loading,
Crafting, Doomscroll.

### 3.11 `Tooltip` — `overlay`
**Purpose.** Short explanatory text anchored to a trigger. On touch, tooltips are opened
by tap-and-hold (400 ms) and dismissed by tap-outside; they are never hover-only.
**States.** `hidden`, `opening` (80 ms delay on desktop hover), `open`, `pinned`
(clicked/tapped — stays until dismissed), `flipped` (auto-repositioned to stay on
screen).
**Key props.** `{ anchor: HTMLElement; content: string | Node; placement?: "top"|"bottom"|"start"|"end"; maxWidth?: number; interactive?: boolean }`.
**Used by.** Everywhere; mandatory on every status icon, keyword badge, disabled control
and abbreviated number.

### 3.12 `Popover` — `overlay`
**Purpose.** Rich anchored panel with interactive content (Confluence rules preview,
deck picker drawer, cosmetic picker, emote wheel host, quick mode list).
**States.** `closed`, `open`, `flipped`, `dismissing`. Traps focus while open; Esc
closes; returns focus to the trigger.
**Key props.** `{ anchor, content: Node, placement?, dismissOnOutside?: boolean, width?: number }`.
**Used by.** Lobby, Battle HUD, Deck builder, Shop, Profile.

### 3.13 `Dialog` — `overlay`
**Purpose.** Modal decisions and detail views. Never stacks more than 2 deep (screens
doc §1.2).
**States.** `closed`, `opening` (scale 0.98→1 + scrim fade, 280 ms), `open`, `closing`,
`blocking` (no outside-dismiss, e.g. data-loss confirmations).
**Key props.**
```ts
interface DialogProps {
  title: string; body: Node | string;
  actions: ButtonProps[];             // rightmost = primary
  dismissible?: boolean;              // Esc + scrim click + close button
  size?: "sm" | "md" | "lg" | "full";
  onClose?(): void;
}
```
**Accessibility.** `role="dialog"`, `aria-modal="true"`, focus trap, focus restore,
close target ≥ 44×44.
**Used by.** All screens; in battle it is the in-match menu host.

### 3.14 `ConfirmDialog` — `overlay`
**Purpose.** Irreversible or costly actions: concede, dismantle, delete deck, spend
currency, overwrite cloud save, abandon Doomscroll run.
**States.** `default`, `typedConfirm` (requires typing a word — account/data deletion),
`delayedConfirm` (primary enabled after N seconds — purchase-confirmation delay from
spending controls), `processing`.
**Key props.** `{ title, body, confirmLabel, cancelLabel, danger?: boolean, requireText?: string, delaySeconds?: number, itemization?: {label, amount}[] }`.
**Used by.** Battle (concede), Crafting workshop, Deck builder, Shop, Banner page,
Settings, Doomscroll.

### 3.15 `Toast` / `ToastHost` — `overlay`
**Purpose.** Non-blocking feedback: "Deck saved", "Rank rewards claimed", "Route
locked — finish the tutorial first", "Art loaded for 12 cards".
**States.** `entering` (slide 12 px + fade, 160 ms), `visible` (4 s default, 7 s if it
has an action), `hovered` (timer paused), `exiting`, `stacked` (max 3 visible; older
ones collapse into a `+N more` chip).
**Key props.** `{ message: string; tone?: "info"|"success"|"warning"|"error"; icon?: IconId; action?: {label, onClick}; duration?: number }`.
**Rules.** Toasts never carry information that is required to continue; they never
appear over the battle board's centre seam or the End Turn button; each tone has a
distinct glyph.
**Used by.** All screens including Battle (rules-error surfacing from the driver).

### 3.16 `InlineBanner` — `dom`
**Purpose.** Persistent in-page notice: deck invalid, event ending, "rates last changed
2026-05-04", offline-build explainer, returning-player grant.
**States.** `info`, `success`, `warning`, `error`, `dismissed` (remembered per id).
**Key props.** `{ tone, title, body, action?: ButtonProps, dismissId?: string }`.
**Used by.** Deck builder, Banner page, Shop, Event hub, Settings, Inbox, Support.

### 3.17 `EmptyState` — `dom`
**Purpose.** Every list/grid has a designed zero state — never a blank region.
**States.** `noContent`, `noResults` (filters active → offers "clear filters"),
`locked` (unlock condition shown), `comingOnline` (delegates to §3.22).
**Key props.** `{ illustration?: IconId; title; body; action?: ButtonProps }`.
**Used by.** Collection, Deck slots, Inbox, Match history, Achievements, Friends, Event
hub, Reward claim.

### 3.18 `Skeleton` / `Spinner` — `dom`
**Purpose.** Occupancy during async work. Skeletons for known-shape content (grids,
lists); spinner only for indeterminate ≤ 1 s waits inside buttons.
**States.** `pulsing` (default), `static` (reduced motion).
**Key props.** `{ shape: "card"|"row"|"text"|"circle"; count?: number }`.
**Used by.** Collection, Deck builder, News, Match history, Loading screen.

### 3.19 `VirtualGrid` — `dom`
**Purpose.** Windowed rendering for large card sets (a full collection can exceed 1 000
cells). Only visible cells + 1 row of overscan exist in the DOM.
**States.** `idle`, `scrolling` (canvas rendering deferred to idle callbacks),
`filtering` (cross-fade 160 ms), `empty`.
**Key props.** `{ items: T[]; cellWidth: number; cellHeight: number; gap: number; render(item, el): void; recycle(el): void; onEndReached?(): void }`.
**Accessibility.** Grid semantics (`role="grid"`, arrow-key roving focus, Home/End,
PageUp/PageDown), and an "all results" count announced via a live region.
**Used by.** Collection, Deck builder pool, Crafting workshop, Character gallery, Shop.

### 3.20 `CurrencyChip` — `dom`
**Purpose.** One currency balance or price. Currency ids and names are owned by
`../design/07-economy-and-monetization.md`; this component is currency-agnostic and
resolves name/icon from `data/economy` content.
**States.** `balance`, `price`, `insufficient` (price > balance: adds a strike-through
free glyph and an "earn more" affordance), `gain` (brief +N count-up, 600 ms),
`spend` (−N count-down).
**Key props.** `{ currencyId: string; amount: number; mode: "balance"|"price"; delta?: number; compact?: boolean }`.
**Used by.** Top bar, Shop, Banner page, Crafting workshop, Pack opening, Reward claim,
Event hub, Battle pass.

### 3.21 `Countdown` — `dom`
**Purpose.** Time remaining for events, banners, missions, seasons.
**States.** `far` (`ends 12 Aug, 09:00 UTC`), `near` (< 48 h → `2d 14h`), `urgent`
(< 1 h → `47m` + clock glyph), `ended` (content disappears; never counts negative).
**Key props.** `{ endsAtIso: string; showAbsolute?: boolean }`.
**Binding rule (core rules §10).** The absolute end datetime is always available (in
the label or its tooltip). No artificial urgency, no fake countdowns, no "hurry" copy.
**Used by.** Lobby, Event hub, Banner page, Missions, Battle pass, Shop, News.

### 3.22 `ComingOnlinePanel` — `dom`
**Purpose.** The honest presentation of designed-for-online features (contract §7):
greyed entry + tag + a one-paragraph explainer. Never a fake queue, fake friend, or
disabled button pretending to be broken.
**States.** `tagOnly` (inline chip on a tile), `panel` (full explainer with the feature
description and "designed, not yet available" line).
**Key props.** `{ featureId: string; title; body; illustration?: IconId }`.
**Used by.** Mode selection, Ranked overview, Friends, Fan Clubs, Leaderboards, Shop
(Limelight tab), Inbox, Event hub, Support.

---

## 4. Battle HUD, board and match overlays

All components in this section are fed exclusively by `EngineEvent`s through
`presenter.ts` and by `predict()` output. None of them re-derive rules (contract §3).

### 4.1 `LeaderHealthOrb` — `hud`
**Purpose.** A leader's identity and survival state; the most-looked-at object on the
board after the hand.
**States.** `default`, `damaged` (orb fluid drops with a 400 ms ease + numeral tick),
`healed`, `armored` (see §4.2), `obsessed` (8+ Obsession: adds a cracked-ring overlay
and the label `OBSESSED`), `lethalThreat` (a `predict()` line shows lethal available
against this leader: skull glyph + numeral outline), `defeated` (fracture + desaturate),
`inspecting` (raised, shows passive text).
**Key props.**
```ts
interface LeaderHealthOrbProps {
  seat: Seat; leaderCardId: string;
  health: number; maxHealth: number; armor: number;
  obsessed: boolean; lethalIncoming?: number | null;
  onInspect(): void;
}
```
**Anatomy.** Circular orb, r 46 px at reference; liquid fill height = `health/maxHealth`;
the **numeral is always drawn** (`23`), never implied by fill. Leader portrait sits
behind at 30 % opacity; passive-ability icon pinned at the orb's lower-left with a
tooltip carrying the passive's full text.
**Used by.** Battle only (both seats).

### 4.2 `ArmorChip` — `hud`
**Purpose.** Show `armor` as a separate, absorbable pool (core rules §5.4).
**States.** `hidden` (0), `visible`, `absorbing` (chip flashes and the absorbed amount
floats off), `depleted` (chip collapses with a shatter glyph).
**Key props.** `{ amount: number; anchor: "leader" | "character" }`.
**Used by.** Battle (leader orbs, character tokens).

### 4.3 `HypeCrystalRail` — `hud`
**Purpose.** The primary resource read: how much you can spend right now.
**States.** per pip: `filled`, `spent` (hollow), `locked` (Overload debt for next turn —
padlock glyph, never merely dimmed), `temporary` (this-turn-only Hype: dashed outline +
`+N` chip), `capped` (10/10 shows a gold rim). Rail states: `default`, `gainPulse`,
`insufficient` (a card being dragged costs more than available → the missing pips
outline in `--danger` and the numeral shakes once).
**Key props.** `{ hype: number; hypeMax: number; temp: number; lockedNextTurn: number; previewCost?: number }`.
**Anatomy.** Ten pip slots (cap 10 per canon §3.1) using the same faceted crystal shape
as the card cost gem, plus the `5/5` numeral. When `previewCost` is set, the pips that
would be consumed animate to a "pending" outline — the drag-time cost preview.
**Used by.** Battle (your rail always; enemy rail as a compact numeral `hype/hypeMax`).

### 4.4 `ObsessionDial` — `hud`
**Purpose.** The push-your-luck meter (canon §3.2): fuel for Fixations and, at 8+, a
liability. This component must make "you are winning yourself into danger" legible at a
glance.
**States.**
| State | Range | Presentation |
|---|---|---|
| `calm` | 0–2 | Flat segments, `--chrome-mid` fill, numeral `2/10` |
| `charged` | 3–6 | Segments filled in the leader's faction colour; the **Fixation notch** at 3 lights with a ✓ and the button in §4.16 enables |
| `brink` | 7 | Ultimate notch at 7 lights; a thin warning underline appears; label `ULTIMATE READY` |
| `obsessed` | **8–9** | **Danger-zone styling (distinct, not colour-only):** the last three segments render as 45° hazard-striped chevrons; the dial gains a doubled outline and a broken-ring glyph; a persistent chip below reads `OBSESSED · +1 DMG TAKEN`; the numeral switches to a boxed treatment; on entering, a one-shot 600 ms pulse + audio cue fires (`obsessedThresholdCrossed` event) |
| `full` | 10 | All segments striped + a filled diamond cap; chip reads `FULL FIXATION · ULTIMATE FREE THIS TURN`; at end of turn the reset to 5 animates as a visible drain with the `fullFixationReset` label |
**Reduced motion.** The pulse becomes a single cross-fade; the stripes stay (they are
information, not decoration).
**Key props.**
```ts
interface ObsessionDialProps {
  seat: Seat; value: number; max: number;         // from balance.obsession.max
  obsessedThreshold: number; fixationCost: number; ultimateCost: number;
  fixationUsedThisTurn: boolean; ultimateUsed: boolean;
  onInspect(): void;                               // opens the Obsession rules overlay
}
```
**Used by.** Battle (both seats — the enemy dial uses the same danger styling, because
knowing the enemy is Obsessed is a real tactical read).

### 4.5 `ResonanceTracker` — `hud`
**Purpose.** Pure-deck Perfect Resonance progress (canon §8.6).
**States.** `hidden` (dual decks), `progress` (`Resonance 4/7` + pip row),
`ready` (7/7, pre-activation glow), `activated` (one-shot flourish, then a static
"activated" seal with the resonance name from `data/currents.json`).
**Key props.** `{ progress: number; threshold: number; current: CurrentId | null; activated: boolean }`.
**Used by.** Battle (yours always; the enemy's is shown because `RedactedOpponent`
exposes `resonanceProgress` and `pureCurrent`).

### 4.6 `ZoneCounter` — `hud`
**Purpose.** Deck and discard counts for both seats.
**States.** `default`, `low` (deck ≤ 5: pulses once per draw), `empty` (deck 0: shows
the Burnout preview `next draw: 3` using the escalating fatigue value), `inspectable`
(discard piles are public — tap opens a scrollable list overlay).
**Key props.** `{ kind: "deck" | "discard"; count: number; seat: Seat; fatigueNext?: number; onInspect?(): void }`.
**Used by.** Battle.

### 4.7 `TurnTimerRing` + `RopeStrand` — `hud`
**Purpose.** Communicate the 75 s turn and the 15 s "Stream Buffering" rope
(canon §2).
**States.** `idle` (not your turn — ring shows the enemy's remaining time in a muted
tone), `running`, `rope` (last 15 s: the ring switches to a segmented countdown, the
`RopeStrand` glitch-strand animates across the board's centre seam, an audio cue fires,
and a numeral appears — never audio/colour only), `expired` (auto end-turn),
`paused` (vs-AI in-match menu only; online never pauses).
**Key props.** `{ secondsRemaining: number; totalSeconds: number; ropeSeconds: number; active: boolean }`.
**Used by.** Battle.

### 4.8 `EndTurnButton` — `hud`
**Purpose.** The primary battle action; also the turn-state indicator.
**States.** `yourTurn` (enabled, `END TURN`), `attention` (you have unspent Hype and at
least one legal play, per the Gameplay setting — a slow pulse + hint tooltip),
`waiting` (`WAITING…`, disabled, enemy timer in the ring), `confirming` (when the
"confirm end turn with unspent Hype" setting is on, a second press is required and the
label reads `END TURN? (5 Hype unspent)`), `resolving` (triggers are resolving — the
button is briefly locked and shows a small queue glyph).
**Key props.** `{ phase: "yours"|"enemy"|"resolving"; unspentHype: number; hasLegalPlay: boolean; timer: TurnTimerRingProps; onEndTurn(): void }`.
**Used by.** Battle. Replaced by `ReplayControlBar` in replay/spectate.

### 4.9 `HandFan` — `3d` + `hud`
**Purpose.** Your hand: browse, evaluate, play. The most touched object in the game.
**States.** `idle` (arc fan, up to 10 cards; card pitch tightens as the count grows),
`hovered` (card lifts 0.35 world units, scales 1.18, neighbours part 8 %),
`focused` (keyboard/controller: same as hovered plus a focus ring),
`dragging` (card follows the pointer, hand collapses to a compact strip, legal board
slots highlight), `tapSelected` (touch tap-tap mode: card raises and stays; second tap
on a slot/target plays it), `unaffordable` (cards costing more than current Hype render
`dimmed` with the cost gem outlined in `--danger`), `burning` (hand at 10 and a draw is
incoming — the `cardBurned` "Lost in the Feed" event plays on the incoming card).
**Key props.**
```ts
interface HandFanProps {
  cards: { instanceId: string; card: CardDef; costNow: number; playable: boolean; reason?: RulesErrorShape["code"] }[];
  maxFanWidth: number; density: "comfortable" | "compact";
  onDragStart(instanceId): void; onPlay(instanceId, slot?, targets?): void;
  onInspect(instanceId): void;
}
```
**Notes.** `costNow` comes from the engine (Trending, `modifyCost`, auras) and is what
the cost gem renders — the UI never recomputes cost. Unplayable cards always expose the
reason on hover/hold ("Not enough Hype", "Board full", "No legal target").
**Used by.** Battle.

### 4.10 `BoardSlot` — `3d`
**Purpose.** One of the six character positions per side; also the drop target.
**States.** `empty`, `occupied`, `legalDrop` (pulsing glow marker while dragging a
character), `illegalDrop` (no marker at all — illegal targets never snap),
`insertHint` (slot ordering preview when dropping between existing characters),
`summonFlash` (240 ms on `characterSummoned`).
**Key props.** `{ side: "player"|"enemy"; index: number; slots: number; occupantId?: string }`.
**Used by.** Battle.

### 4.11 `CharacterToken` — `3d` + `hud`
**Purpose.** A character in play: `CardFace3D` plus the live HUD furniture anchored to
its projected screen position.
**Furniture.** Stat chips (live values from `CharacterInstance`), `StatusIconStrip`
(§4.12), keyword badge row (Spotlight/Raid/Comeback/…), equipment hanger badge, Grow
counter (`Grow 2/3`), Comeback timer (`returns next turn`), attack-availability ring
(bright = can attack, hollow = summoning sick or already attacked), Refract marker.
**States.** `idle`, `canAttack`, `exhausted`, `selected` (attack source),
`legalTarget`, `illegalTarget` (dimmed, non-snapping), `spotlight` (a beam glyph plus
a `MUST ATTACK` label on enemy hover), `lurking` (translucent + hidden-eye glyph;
untargetable), `warded`, `cancelled` (text blanked, a strike band across the frame),
`banished` (removed to the banish tray with a return-turn label), `damaged`, `defeated`.
**Key props.** `{ instance: CharacterInstance; card: CardDef; liveAttack: number; canAttack: boolean; highlight: "none"|"playable"|"target"|"selected" }`.
**Used by.** Battle.

### 4.12 `StatusIconStrip` — `hud`
**Purpose.** All statuses on a unit, always as **distinct silhouettes** (canon §5.4).
**States.** per icon: `applied` (pop-in 180 ms), `active`, `expiring` (final turn: the
duration ring is one segment from empty), `triggering` (flash on `statusTriggered`,
e.g. Scorched burn), `removed` (fade out). Strip states: `default`, `overflow` (> 4
statuses collapse into a `+N` chip that opens the full stack), `inspecting`.
**Key props.** `{ statuses: StatusInstance[]; anchor: TargetRef; density }`.
**Content per icon.** Silhouette from `drawStatusIcon`, magnitude numeral for
`armor`/`weakened`/`empowered`, and a duration ring for timed statuses. Tooltip text
comes verbatim from `data/statuses.json`.
**Used by.** Battle (characters and leaders), Card inspect overlay.

### 4.13 `LocationSlot` — `3d` + `hud`
**Purpose.** The one location per side, at each row's outer end.
**States.** `empty`, `occupied`, `activatable` (has an `activate` effect, durability > 0,
not used this turn — shows a pressable rune), `usedThisTurn`, `replacing` (new location
played: the old one slides out with a `replacedCardId` caption), `durabilityLow`
(1 pip left: pip pulses), `disabled` (Eclipse — a struck-through aura glyph with the
"auras disabled" label and the turn it returns).
**Key props.** `{ side; location: LocationInstance | null; card?: CardDef; canActivate: boolean; onActivate(): void; onInspect(): void }`.
**Used by.** Battle.

### 4.14 `ReactionZone` — `hud`
**Purpose.** Face-down Reactions (max 2, canon §4). Yours are inspectable; the enemy's
are counted only (redaction is enforced by `redact()`, not by the UI).
**States.** `empty`, `set` (card backs with a set-turn label), `peeking` (you tap your
own → reveals to you only, 3 s, with a "only you can see this" note),
`triggering` (the `reactionTriggered` event flips the card up with its condition
named: "Enemy attacks your leader → **Sudden Ratio**"), `full` (2/2 — playing another
Reaction is illegal; the hand card shows `reactionLimit` as its reason).
**Key props.** `{ seat: Seat; reactions: ReactionInstance[]; revealed: boolean; onPeek(id): void }`.
**Used by.** Battle.

### 4.15 `EventBanner` — `hud`
**Purpose.** The active Event per player (max 1, canon §4), visible to both.
**States.** `empty`, `active` (name + `remainingTurns` pill), `ticking`
(`eventTicked` → the pill decrements with a tick animation), `expiring` (1 turn left:
outline switches to dashed), `ended` (slides out), `replaced`.
**Key props.** `{ seat; event: ActiveEventInstance | null; card?: CardDef; onInspect(): void }`.
**Used by.** Battle.

### 4.16 `FixationButtons` — `hud`
**Purpose.** The two Leader abilities: **Fixation** (3 Obsession, once per turn) and
**Ultimate Fixation** (7, once per match).
**States.** `locked` (not enough Obsession — shows `3` requirement and how far away you
are), `ready`, `free` (Full Fixation at 10: the Ultimate shows cost `0` with a
`FREE THIS TURN` tag), `usedThisTurn` (Fixation), `spent` (Ultimate, permanent for the
match), `targeting` (ability requires a target: the targeting arrow mode engages),
`disabled` (`fixationUnavailable`).
**Key props.** `{ fixation: LeaderAbility; ultimate: LeaderAbility; obsession: number; fixationUsedThisTurn: boolean; ultimateUsed: boolean; fullFixation: boolean; onUse(kind): void }`.
Hover/hold shows the full ability text plus a `predict()` preview of its effect.
**Used by.** Battle.

### 4.17 `ConfluenceButton` — `hud`
**Purpose.** The once-per-turn Confluence (canon §8.5) with its **dual-symbol preview**.
**Anatomy.**
```
   +-------------------------------------------------+
   |  (o) CINDER  ><  (~) TIDE                       |   <- two Current icons + labels
   |        S T E A M V E I L                        |   <- confluence name
   |  Choose a friendly character: it cannot be      |   <- rules text from
   |  targeted by enemy Actions until your next turn |      data/confluences.json
   |                              [ ACTIVATE ]  (1)  |   <- once-per-turn pip
   +-------------------------------------------------+
```
**States.** (mapped 1:1 to `ConfluenceAvailability`)
| State | Trigger | Presentation |
|---|---|---|
| `hidden` | no pair playable in this deck | not rendered |
| `dormant` | `reasonUnavailable: "currentsNotPlayed"` | ghosted at 35 %, shows which Current is still missing (`play a TIDE card`) |
| `available` | `available: true` | full colour, gentle breathing glow, hotkey hint |
| `needsTarget` | `reasonUnavailable: "noValidTargets"` | ghosted with `no legal target` |
| `used` | `reasonUnavailable: "alreadyUsed"` | greyed + the used Confluence's name and a spent pip |
| `previewing` | hover / press-hold | `Popover` with full rules, legal targets highlighted on the board, and `predict()` numbers |
| `refraction` | Prism pair | shows `PRISM >< ?` and, on press, a Current chooser (matching the `refract` op's intent choice) |
**Key props.** `{ availability: ConfluenceAvailability[]; def: ConfluenceDef; onPreview(id): void; onActivate(id, targets?, choice?): void }`.
**Used by.** Battle (centre seam, right of the trigger rail).

### 4.18 `TriggerQueueRail` — `hud`
**Purpose.** Make trigger resolution order visible (canon §5.5) — the difference between
"magic happened" and "I understand what happened".
**Anatomy.** A horizontal rail of numbered chips at the board's centre seam. Each chip:
ordinal, source card's Current icon, trigger name (`Afterparty`, `Inspire`, `Flow`,
`Grow`, `Reaction`…), owner side marker (▲ you / ▼ enemy).
**States.** `hidden` (empty queue), `queued` (chips slide in on `triggerQueued`),
`resolving` (the active chip scales 1.25 and brightens; the board unit it belongs to
gets a matching halo), `resolved` (chip desaturates and drifts left),
`capReached` (`triggerCapReached` → a red-bordered chip reads
`Feed overloaded — {dropped} triggers fizzle` and stays 3 s),
`fastForwarded` (queue was skipped: chips collapse into a single `N triggers` chip that
can be expanded in the history rail).
**Key props.** `{ entries: { id, sourceCardId, trigger: TriggerId, seat: Seat, depth: number }[]; activeIndex: number; dropped?: number }`.
**Used by.** Battle.

### 4.19 `HistoryRail` / `HistoryEntry` — `hud`
**Purpose.** The persistent record of the match, newest on top, grouped by turn — the
brief's "card history" requirement.
**`HistoryEntry` anatomy.** `[turn chip] [actor marker] [icon] [plain-language line]`,
e.g. `T5 ▲ ⚔ Encore Diva attacked Ad Break Goblin (4 dmg, +1 Cinder→Gale)`.
**States.** per entry: `default`, `hover` (the involved units highlight on the board and
the entry expands to the full sentence), `focus`, `new` (slide-in 160 ms, then settles),
`grouped` (consecutive same-source events collapse: `3 triggers ▸`), `expanded`.
Rail states: `collapsed` (icon chips only, ~48 px wide), `expanded` (full log panel,
scrollable, filterable by `cardPlayed / attack / trigger / status / confluence`),
`autoScrolling`, `pinned` (user scrolled up — auto-scroll pauses and a
`jump to latest` pill appears).
**Key props.** `{ entries: HistoryEntryModel[]; expanded: boolean; filter?: HistoryFilter; onHighlight(refs: TargetRef[]): void }`.
**Event mapping.** Entries are produced by the presenter from `EngineEvent`s; every
event type has an i18n template. Redacted enemy information is never inferred (a
`cardDrawn` with `cardId: null` renders "Opponent drew a card").
**Used by.** Battle; the same entry renderer is reused by Match history replay.

### 4.20 `TargetingArrow` — `3d`
**Purpose.** The explicit targeting gesture required by canon §5.3.
**Variants.** `attack` (barbed chevron head, `--danger` gradient, slight sag),
`beneficial` (rounded head, `--accent-gold`, upward arc), `ability`
(Fixation/Confluence/Location — chevron with the ability's Current colour and a small
Current icon riding the arrow), `invalid` (dashed grey, no head, no snap).
**States.** `idle` (hidden), `dragging` (bezier from source to pointer),
`snapped` (head locks to a legal target: 6 px magnet radius, target ring brightens,
`PredictionBadge` appears), `blocked` (Spotlight enforcement: legal Spotlight targets
pulse and a `SPOTLIGHT` label appears over the forced targets),
`released-illegal` (arrow snaps back with a 120 ms recoil and a toast naming the
`RulesErrorShape.code`), `confirming` (touch tap-tap: arrow persists between taps).
**Key props.** `{ sourceRef: TargetRef | {kind:"hand"; instanceId: string}; legalTargets: TargetRef[]; kind: "attack"|"beneficial"|"ability"; pointer: {x,y} }`.
**Used by.** Battle.

### 4.21 `PredictionBadge` — `hud`
**Purpose.** Show `predict()` output before confirmation — damage, healing, elemental
bonus, absorption, lethality (canon §5.2/§5.3).
**Anatomy.** Anchored to each affected unit: a numeral (`−5`, `+3`), plus modifier
chips: `⚡+1` with both Current icons for the elemental bonus, a struck-through shield
for `absorbedByShield`, `armor −2`, a skull glyph for a lethal result, and `↔` on the
attacker for counter-damage.
**States.** `hidden`, `preview` (during drag/hover), `lethal` (distinct skull badge +
audio cue), `noEffect` (`0` with an "immune / warded" reason), `blockedHeal`
(Blackflame — crossed-out heart), `stale` (recomputed on every state change; never
shows an outdated number).
**Key props.** `{ preview: AttackPreview | EffectPreview; anchors: TargetRef[] }`.
**Used by.** Battle.

### 4.22 `EmoteWheel` — `hud`
**Purpose.** Six equipped emotes on the leader portrait.
**States.** `closed`, `open` (radial popover), `cooldown` (5 s per emote, ring drains),
`muted` (enemy emotes muted from their portrait context menu; safe default for
non-friends online), `disabled` (moderation restriction).
**Key props.** `{ emotes: {id, label, icon}[]; cooldownRemaining: number; onEmote(id): void }`.
**Used by.** Battle.

### 4.23 `CardInspectOverlay` — `overlay`
**Purpose.** Card enlargement anywhere: full frame at 500 px, keyword reminder text
(always, even on Epic/Legendary), the Current advantage mini-wheel, live status list for
board instances, related-card links, owned-variant strip.
**States.** `opening` (200 ms scale from the source rect), `open`, `flipping`
(variant/alt-art toggle), `closing`. Opened by right-click, long-press (400 ms), or the
`I` key; Esc/tap-outside closes.
**Key props.** `{ card: CardDef; instance?: CharacterInstance; showVariants?: boolean; sourceRect?: DOMRect }`.
**Used by.** Battle, Collection, Deck builder, Pack opening, Reward claim, Patch notes,
Match history, Inbox.

### 4.24 `CurrentsGuideOverlay` — `overlay`
**Purpose.** The in-game interaction guide the brief requires: 8 Currents with icon,
frame shape and signature keyword; the advantage cycle diagram; all 9 Confluences;
Resonance rules.
**States.** `closed`, `open` (tabbed: Currents / Advantage / Confluences / Resonance),
`contextual` (opened from the Confluence preview → deep-links to that Confluence).
**Key props.** `{ initialTab?: "currents"|"advantage"|"confluences"|"resonance"; focusId?: string }`.
**Used by.** Battle (in-match menu and Confluence preview), Collection, Onboarding,
Support FAQ.

### 4.25 `MulliganOverlay` — `overlay`
**Purpose.** The one-time opening-hand replacement (canon §2).
**Anatomy.**
```
   +-----------------------------------------------------------------------+
   |  MULLIGAN — tap cards to replace them.  Once only.        [ 0:38 ]    |
   |                                                                       |
   |    [card]      [card]      [card]      [card]      [card]             |
   |    KEEP        REPLACE     KEEP        KEEP        REPLACE            |
   |     -           (x)         -           -           (x)               |
   |                                                                       |
   |  You are going second: you also start with  [ Borrowed Clout ]  (?)   |
   |                                                                       |
   |                       [  CONFIRM  (2 replaced) ]                      |
   +-----------------------------------------------------------------------+
```
**States.** `entering` (cards deal in, 90 ms stagger), `selecting`,
`marked` (per card: desaturated + a `REPLACE` label and a swap glyph — not colour only),
`confirming` (cards fly back, replacements deal in, count preserved),
`timeout` (45 s `timer.mulliganSeconds` → auto-confirm current marks),
`waiting` (opponent still mulliganing — shows a neutral "opponent is deciding" line,
no fake progress).
**Key props.** `{ hand: {instanceId, card}[]; seat: Seat; secondsRemaining: number; hasBorrowedClout: boolean; onToggle(instanceId): void; onConfirm(replaceInstanceIds: string[]): void }`.
**Notes.** Emits exactly one `{ type: "mulligan" }` intent. The **Borrowed Clout**
explainer tooltip states the card's exact text ("0 cost Action: +1 Hype this turn only").
**Used by.** Battle.

### 4.26 `VictoryDefeatSequence` — `overlay`
**Purpose.** The match outro: celebratory but fast, always skippable, auto-shortened
after first view (canon §10).
**Stages (full speed / fast / instant).**
| # | Stage | Full | Fast | Instant |
|---|---|---|---|---|
| 1 | Final blow freeze-frame + camera push-in on the winning leader | 1.2 s | 0.5 s | 0 |
| 2 | Banner: `VICTORY` / `STREAM ENDED` (defeat is brief and non-humiliating) | 1.6 s | 0.6 s | 0 |
| 3 | Leader animation + voice line | 2.5 s | 0.8 s | skipped |
| 4 | Results panel (XP, faction/leader mastery, missions ticked, rank delta) counts up | 3.0 s | 1.0 s | instant values |
| 5 | Continue → `Reward claim` (if grants) → originating screen | — | — | — |
**States.** `playing`, `skipping` (any input fast-forwards to the results panel),
`results`, `dismissed`. Reduced motion: stages 1–3 collapse into a single cross-fade.
**Key props.** `{ outcome: "victory"|"defeat"|"draw"; reason: MatchEndedEvent["reason"]; rewards: RewardSummary; firstView: boolean; onContinue(): void }`.
**Used by.** Battle.

### 4.27 `ReplayControlBar` — `hud`
**Purpose.** Playback transport for replays and (online) spectating; replaces the End
Turn button.
**States.** `playing`, `paused`, `speed` (1× / 2× / 4× segmented), `scrubbing`
(jump-to-turn rail), `atEnd`, `liveDelay` (spectate: shows the broadcast delay honestly).
**Key props.** `{ turn: number; totalTurns: number; playing: boolean; speed: 1|2|4; onSeekTurn(n): void; onTogglePlay(): void; onSpeed(s): void }`.
**Used by.** Battle in replay/spectate mode (entered from Match history).

### 4.28 `InMatchMenu` — `overlay`
**Purpose.** Settings without leaving the match.
**Sections.** Gameplay/Graphics/Audio/Controls (the same panels as the Settings screen),
Accessibility, Currents guide, deck reminder (cards remaining by type — public
information only), Concede (double-confirm).
**States.** `closed`, `open` (scrim; vs-AI pauses the timer, online never pauses and
says so), `concedeConfirm`.
**Key props.** `{ mode: "ai"|"online"|"replay"; onConcede(): void; onClose(): void }`.
**Used by.** Battle.

---

## 5. Collection, deck-building and economy components

### 5.1 `CollectionGridCell` — `dom`
**Purpose.** One card in any card grid, with ownership state.
**Anatomy.**
```
   +----------------------+
   | [NEW]         [pin]  |   <- new badge, favourite pin
   |                      |
   |     CardCanvas       |
   |      (176 px)        |
   |                      |
   |  x2            [lock]|   <- owned-count pips, dismantle lock
   +----------------------+
     CRAFT 400            <- craft chip (missing cards only)
```
**States.** `owned` (count pips `x1`/`x2`; Legendary shows `x1` max),
`missing` (`dimmed` + craft chip with the exact Signal price),
`partial` (own 1 of 2 — a half-filled pip, plus the numeral),
`new` (badge until inspected), `favourite`, `locked`, `selected` (bulk operations),
`inDeck` (deck-builder context: shows `2/2 in deck` and greys out further adds),
`notLegal` (deck-builder context: outside the leader's faction/Currents — dimmed with a
reason tooltip, e.g. "Requires Halo or Pulse"), `animatedPreview` (premium variant
foil ticking; at most one cell at a time).
**Key props.**
```ts
interface CollectionGridCellProps {
  card: CardDef; owned: number; maxOwnable: number;
  isNew?: boolean; favourite?: boolean; locked?: boolean;
  deckContext?: { inDeck: number; legal: boolean; illegalReason?: string };
  craftPrice?: number; dustValue?: number;
  onActivate(): void; onInspect(): void; onQuickAdd?(): void;
}
```
**Used by.** Collection, Deck builder pool, Crafting workshop, Character gallery card
strip, Shop bundle contents, Patch notes.

### 5.2 `CardDetailPanel` — `dom`
**Purpose.** The full card page: 420 px frame, variant selector, keyword explanations,
interaction notes, lore tab, craft/dismantle actions, "recent changes" link.
**States.** `default`, `variantSelected`, `crafting` (progress + confirm),
`dismantling`, `locked`, `missing`.
**Key props.** `{ card: CardDef; owned: number; variants: CardDef[]; onCraft(); onDismantle(); onAddToDeck?() }`.
**Used by.** Collection, Crafting workshop, Reward claim, Pack opening.

### 5.3 `FilterRail` — `dom`
**Purpose.** The full filter set: faction, cost (0–7+), rarity, type, keyword, Current,
ownership.
**States.** `collapsed` (compact density: a `Filters (3)` button opening a sheet),
`expanded`, `active` (filters applied — a clear-all chip appears with the count),
`noResults` (offers "clear filters").
**Key props.** `{ groups: FilterGroup[]; value: FilterState; resultCount: number; onChange(next): void }`.
**Used by.** Collection, Deck builder, Crafting workshop, Character gallery.

### 5.4 `DeckListRow` — `dom`
**Purpose.** One entry in the 30-card deck list.
**Anatomy.**
```
   +---------------------------------------------------------------+
   | (4) | [thumb] Encore Diva            [HALO] [R] |  x2  |  [-]  |
   +---------------------------------------------------------------+
     ^cost gem        ^name          ^current ^rarity  ^count ^remove
```
**States.** `default`, `hover` (shows the full card in a side preview + a `−` button),
`focus`, `maxed` (2 copies, or 1 for Legendary — the count pip fills and further adds
are rejected with a toast), `missing` (you don't own enough copies: a warning glyph plus
"craft for 100 Signal" — the deck stays editable but validation flags it),
`illegal` (violates Current/faction rules after a leader change — red band + reason),
`prismSplash` (counts against the 3-card Prism splash limit — shows `PRISM 2/3`),
`justAdded` (300 ms highlight), `dragging` (reorder is cosmetic only).
**Key props.** `{ card: CardDef; count: number; maxCount: number; owned: number; legal: boolean; illegalReason?: string; onRemove(): void; onInspect(): void }`.
**Used by.** Deck builder, Doomscroll run sidebar (temporary deck), Match history deck
view, Inbox deck-code previews.

### 5.5 `CurveHistogram` — `dom`
**Purpose.** The Hype-cost curve: the primary deck-health read.
**Anatomy.**
```
   CURVE                              avg 3.4
   8 |                 ##
   6 |            ##   ##   ##
   4 |       ##   ##   ##   ##   ##
   2 |  ##   ##   ##   ##   ##   ##   ##   ##
   0 +----------------------------------------
      0    1    2    3    4    5    6    7+
      1    4    6    7    5    4    2    1     <- counts
```
**Buckets.** 0, 1, 2, 3, 4, 5, 6, 7+ (8 columns; the 7+ bucket aggregates everything at
the top of the curve, which matters because Hype caps at 10).
**States.** `empty` (no cards yet — axis only), `partial`, `complete` (30/30),
`hoveredBucket` (that bucket's cards filter into the list; the column brightens and the
count label enlarges), `warning` (a heuristic advisory, never a block: "no 2-cost plays"
or "9 cards at 6+" — rendered as a chip under the axis with an explainer tooltip),
`comparing` (deck-version compare mode: the previous version renders as a hollow outline
behind the current bars).
**Key props.** `{ buckets: number[]; average: number; advisories?: {bucket: number, text: string}[]; compareBuckets?: number[]; onBucketHover?(b: number|null): void }`.
**Accessibility.** Rendered as an accessible list: each column is a focusable element
labelled "cost 3: 7 cards"; the whole component has a table fallback in the deck stats
tab.
**Used by.** Deck builder, Statistics dashboard, Doomscroll run sidebar, Match history
deck view.

### 5.6 `TypeDistributionBar` — `dom`
**Purpose.** Character / Action / Reaction / Equipment / Location / Transformation /
Event mix as a single stacked bar with counts.
**States.** `empty`, `partial`, `complete`, `hoveredSegment`, `warning` (e.g. "0
removal-type cards" advisory).
**Key props.** `{ counts: Record<CardType, number>; total: number }`. Each segment
carries a pattern (solid, dots, diagonal, cross-hatch, …) as well as a colour.
**Used by.** Deck builder, Statistics dashboard.

### 5.7 `CurrentSplitDonut` — `dom`
**Purpose.** Current composition plus the Resonance/Confluence consequence.
**States.** `pure` (single natural Current → `Pure Halo — Perfect Resonance enabled`),
`dual` (→ `Halo + Pulse — Confluence: Tempest`), `prismPrimary`, `overSplash`
(> 3 Prism cards → error state feeding the validation panel), `illegalCurrent`.
**Key props.** `{ counts: Partial<Record<CurrentId, number>>; leader: LeaderCardDef; prismSplashLimit: number }`.
Segments use the Current icons as inline labels, so it reads without colour.
**Used by.** Deck builder, Statistics dashboard.

### 5.8 `DeckValidationPanel` — `dom`
**Purpose.** Say exactly why a deck is or isn't playable.
**States.** `valid` (`30/30 · legal · ready to play`), `incomplete` (`27/30 — add 3`),
`errors` (blocking list: size, copy limits, faction, Current, Prism splash, missing
leader), `warnings` (non-blocking: unowned copies, no early plays, no answers to wide
boards), `fixable` (each row offers a one-tap fix where possible: "remove 1 copy",
"craft for 100 Signal").
**Key props.** `{ errors: ValidationIssue[]; warnings: ValidationIssue[]; onFix(issueId): void }`.
**Used by.** Deck builder, Mode selection (deck picker), Lobby active-deck widget.

### 5.9 `DeckSlotCard` — `dom`
**Purpose.** One of the 12 saved deck slots.
**States.** `empty` (`+ New deck`), `filled`, `active` (the deck the lobby PLAY button
uses — a pinned marker), `invalid` (badge + reason), `editing`, `renaming`,
`deleting` (confirm), `imported` (fresh from a deck code — a `NEW` chip).
**Key props.** `{ deck: DeckList | null; leader?: LeaderCardDef; valid: boolean; stats?: {games, winrate}; isActive: boolean; onOpen(); onSetActive(); onDelete() }`.
**Used by.** Deck builder, Mode selection deck picker, Lobby deck widget.

### 5.10 `PackOpeningStage` — `dom` + `canvas`
**Purpose.** The reveal ceremony for a 5-card pack (`economy.packSize`), and the batch
result for 10 packs.
**Anatomy / flow.**
```
   [1] PACK STACK            [2] TEAR              [3] REVEAL           [4] RESULT GRID
   +-------------+       +-------------+     +-----------------+    +---------------+
   |  ///////    |  drag |   \  |  /   |     |   [card back]   |    | [c][c][c][c][c]|
   |  Merch Drop | ====> |    tear      | ==> |  tap to flip    | => | dupes: +25 S  |
   |   x 12      |       |   line       |     |  1 / 5          |    | [Open another]|
   +-------------+       +-------------+     +-----------------+    +---------------+
```
**States.**
| State | Presentation |
|---|---|
| `idle` | Pack stack with type + remaining count; `Open 1` / `Open 10` buttons |
| `tearing` | Drag/tap-to-tear with a foil-rip VFX; 700 ms full / 250 ms fast / 0 instant |
| `revealing` | Cards flip one at a time; per-rarity VFX tier (Common: soft glow; Rare: ring pulse; Epic: shockwave; **Legendary: full-stage flare + audio sting + camera-ish zoom**) |
| `revealAll` | "Reveal all" flips the remainder simultaneously |
| `skipped` | "Skip animation" (remembered per user, per the Banner page toggle) jumps straight to the result grid |
| `batch` | 10-pack: a 5×10 result grid with staggered 40 ms pop-in, one summary row |
| `duplicate` | Dupe cards show an inline conversion chip (`+25 Signal`) and their pity contribution |
| `pityHit` | The guaranteed-card moment gets a distinct frame ("guaranteed Legendary — pack 30 of 30") so the guarantee is visibly honoured |
| `reducedMotion` | Instant grid, no flips, no flare; identical information |
| `empty` | No packs owned → `EmptyState` linking to Shop and Crafting workshop |
**Key props.**
```ts
interface PackOpeningStageProps {
  packType: { id: string; name: string; size: number };
  results: { card: CardDef; duplicate: boolean; dustAwarded?: number; pityGuaranteed?: boolean }[];
  animationSpeed: "full" | "fast" | "instant";
  onRevealComplete(): void; onOpenAnother(): void; onViewInCollection(cardId): void;
}
```
**Binding rules.** Odds are never re-derived or "dramatised" client-side — the server
(or, offline, the seeded local roll) decides, and the stage only presents. No near-miss
animations, no fake pity teasing (core rules §10).
**Used by.** Pack opening screen; the same component runs inside Reward claim for
pack grants.

### 5.11 `PityProgressBar` — `dom`
**Purpose.** Guaranteed-card progress with the exact rule stated in text.
**States.** `progress` (`17 / 30 to guaranteed Legendary`), `nearGuarantee` (final 5 —
label only, no urgency styling), `guaranteedNext`, `carriedOver` (shows that progress
carries between same-type banners).
**Key props.** `{ current: number; threshold: number; ruleText: string; kind: "rarity"|"featured" }`.
**Used by.** Banner page, Shop, Probability disclosures.

### 5.12 `RatesTable` — `dom`
**Purpose.** Exact published probabilities per pack/banner type.
**States.** `default`, `expanded` (per-slot breakdown), `versioned` (shows "rates last
changed" with a diff link).
**Key props.** `{ rows: {label: string; percent: number; note?: string}[]; version: string; changedAtIso: string }`.
**Used by.** Probability disclosures, Banner page, Shop, first-purchase confirmation.

### 5.13 `RewardTile` — `dom`
**Purpose.** One granted item in any reward context (missions, pass, achievements,
events, mastery, compensation).
**States.** `unclaimed`, `claiming` (short reveal, skippable, auto-shortened after first
view), `claimed`, `locked` (tier not reached), `converted` (duplicate → currency, with
the conversion shown), `overflow` (inventory-limited items explained inline).
**Key props.** `{ kind: "card"|"currency"|"pack"|"cosmetic"|"title"; payload: unknown; amount?: number; state: RewardState; onClaim?(): void }`.
**Used by.** Reward claim, Battle pass, Missions, Achievements, Event hub, Inbox,
Doomscroll post-run, Victory sequence results.

### 5.14 `MissionCard` — `dom`
**Purpose.** A daily/weekly/event objective with progress and reward.
**States.** `active`, `progressed` (bar animates on entry when it moved since last
view), `complete` (claim button), `claimed`, `rerollable` (one free daily reroll),
`expiring` (shows honest reset time), `locked`.
**Key props.** `{ mission: MissionDef; progress: number; goal: number; rewards: RewardTileProps[]; onClaim(); onReroll?(); onGo?() }`.
**Used by.** Daily missions, Weekly missions, Event hub, Lobby sidebar widget.

### 5.15 `MatchHistoryRow` — `dom`
**Purpose.** One recorded match with replay access.
**States.** `win`, `loss`, `draw` (result carried by a glyph + word, not colour alone),
`hovered` (shows final board thumbnail), `replayAvailable`, `replayIncompatible`
(recorded on an older `schemaVersion` — honest label, no crash), `expanded`.
**Key props.** `{ record: MatchRecord & {summary}; onWatch(); onCopyCode(); onRematch() }`.
**Used by.** Match history, Statistics dashboard drill-down, Profile.

### 5.16 `Sparkline` — `dom`
**Purpose.** Compact trend for the last 30 matches (winrate, match length, Obsession
peak).
**States.** `default`, `insufficientData` (< 5 points → shows the count instead of a
misleading line), `hovered` (point tooltip).
**Key props.** `{ points: number[]; format: (n) => string; baseline?: number }`.
**Used by.** Statistics dashboard, Profile, Deck builder per-deck stats.

---

## 6. Navigation chrome

### 6.1 `TopBar` — `dom`
**Purpose.** Persistent identity + currencies + settings on every hub root and
sub-screen (56 px at reference, scales with text size).
**States.** `hubRoot` (no Back), `subScreen` (Back + title), `overlayHost`
(dialog open — inert), `compact` (mobile landscape: currencies collapse to icons with
values, player chip to avatar only).
**Key props.** `{ title?: string; showBack: boolean; onBack?(): void; currencies: CurrencyChipProps[]; player: PlayerChipProps }`.
**Used by.** All hub roots and sub-screens (never Battle, never boot screens).

### 6.2 `PlayerChip` — `dom`
**Purpose.** Avatar + name + level, linking to the profile.
**States.** `default`, `levelUp` (one-shot flare after a match), `unclaimed` (badge when
rewards await), `guest` (offline/local profile — labelled honestly).
**Key props.** `{ name: string; level: number; avatarId: string; frameId?: string; badge?: number; onClick(): void }`.

### 6.3 `CurrencyCluster` — `dom`
**Purpose.** The full balance row, one `CurrencyChip` per currency plus the top-up
affordance (which is `ComingOnlinePanel`-tagged in the offline build).
**States.** `default`, `changed` (a balance moved this session — brief count animation),
`compact`.
**Key props.** `{ balances: {currencyId, amount}[]; showTopUp: boolean }`.

### 6.4 `BottomNavBar` / `NavItem` — `dom`
**Purpose.** The fixed hub navigation:
`PLAY · COLLECTION · DECK BUILDER · MODES · EVENTS · SHOP · SOCIAL · INBOX · NEWS`
(order is fixed; the first three are never reordered, hidden or covered — screens doc
§1.3/§5.4).
**States.** per item: `default`, `active` (current hub — icon fill + label weight +
a 3 px underline), `badge`, `disabled` (`comingOnline` items keep their place, greyed
with the tag), `focus`.
**Key props.** `{ items: NavItemModel[]; activeId: string; onNavigate(id): void }`.
**Binding rule.** Height 64 px reference; each target ≥ 44×44; promotional content may
never overlay it.
**Used by.** All hub roots.

### 6.5 `ScreenTransition` — `dom`
**Purpose.** Route change presentation owned by `shell.ts`.
**States.** `enter` (fade + 10 px rise + 0.995→1 scale, 280 ms), `exit`,
`instant` (reduced motion / instant animation speed), `blocked` (a guarded route
redirected — pairs with a toast explaining why).
**Key props.** `{ from?: RouteId; to: RouteId; direction: "forward"|"back" }`.

### 6.6 `RotateOverlay` — `overlay`
**Purpose.** Landscape enforcement on mobile (contract §5). Full-screen, above
everything, at `z-index 9999`.
**States.** `hidden` (landscape), `visible` (portrait — animated rotate glyph,
`"Rotate your device — HYPEBOUND is landscape only"`), `staticGlyph` (reduced motion).
While visible the app pauses rendering and any running turn timer is **not** affected
in online play (documented honestly in the overlay copy for online modes).
**Key props.** none (driven by orientation media queries).
**Used by.** Global — every screen including Battle.

### 6.7 `ConnectionBanner` — `overlay`
**Purpose.** Online-build connection state; never rendered in the offline build (nothing
to fake).
**States.** `hidden`, `reconnecting` (with attempt count and elapsed time),
`degraded`, `lost` (offers "return to lobby" and explains match-reconnection policy).
**Key props.** `{ state: "ok"|"reconnecting"|"lost"; attempt?: number; onLeave?(): void }`.

---

## 7. Component → screen matrix

`●` = primary component of that screen; `○` = present.

| Component | Lobby | Collection | Deck builder | Battle | Pack open | Shop / Banner | Missions / Pass | Profile / History | Settings | Modes / Story / Doomscroll |
|---|---|---|---|---|---|---|---|---|---|---|
| `CardCanvas` / `CardTile` | ○ | ● | ● | ● | ● | ○ | ○ | ○ | | ○ |
| `CardBack` | | ○ | ○ | ● | ● | ○ | | ○ | | |
| `CardFace3D` | ○ (leader) | | | ● | | | | | | |
| `Button` / `IconButton` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `SegmentedControl` | ○ | ○ | ○ | ○ | | ○ | ○ | ○ | ● | ○ |
| `Toggle` / `Slider` | | ○ | | ○ | ○ | ○ | | ○ | ● | |
| `SearchField` / `FilterChip` / `FilterRail` | | ● | ● | | | ○ | | ○ | | |
| `Tabs` | ○ | ● | ● | | | ● | ● | ● | ● | ○ |
| `Dialog` / `ConfirmDialog` | ○ | ○ | ● | ● | ○ | ● | ○ | ○ | ● | ● |
| `Toast` / `InlineBanner` | ○ | ○ | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ |
| `Tooltip` / `Popover` | ○ | ● | ● | ● | ○ | ● | ○ | ○ | ○ | ○ |
| `ProgressBar` / `Countdown` | ● | ○ | | ○ | ○ | ● | ● | ● | | ● |
| `VirtualGrid` | | ● | ● | | ○ | ○ | | | | |
| `CurrencyChip` / `CurrencyCluster` | ● | ○ | | | ● | ● | ○ | | | ○ |
| `LeaderHealthOrb` / `ArmorChip` | | | | ● | | | | | | |
| `HypeCrystalRail` | | | | ● | | | | | | |
| `ObsessionDial` | | | | ● | | | | | | |
| `ResonanceTracker` | | | | ● | | | | | | |
| `HandFan` / `BoardSlot` / `CharacterToken` | | | | ● | | | | | | |
| `TargetingArrow` / `PredictionBadge` | | | | ● | | | | | | |
| `TriggerQueueRail` / `HistoryRail` | | | | ● | | | | ○ (replay) | | |
| `ConfluenceButton` / `FixationButtons` | | | | ● | | | | | | |
| `MulliganOverlay` / `VictoryDefeatSequence` | | | | ● | | | | | | |
| `CardInspectOverlay` | ○ | ● | ● | ● | ● | ○ | ○ | ○ | | ○ |
| `CurrentsGuideOverlay` | | ○ | ○ | ● | | | | | ○ | ○ (onboarding) |
| `CurveHistogram` / `TypeDistributionBar` / `CurrentSplitDonut` | | | ● | | | | | ○ | | ○ (Doomscroll) |
| `DeckListRow` / `DeckSlotCard` / `DeckValidationPanel` | ○ | | ● | | | | | ○ | | ● |
| `CollectionGridCell` | | ● | ● | | ○ | ○ | | | | |
| `PackOpeningStage` / `PityProgressBar` / `RatesTable` | | | | | ● | ● | | | ○ | |
| `RewardTile` / `MissionCard` | ○ | | | ○ | ○ | ○ | ● | ○ | | ● |
| `MatchHistoryRow` / `Sparkline` | | | ○ | | | | | ● | | |
| `TopBar` / `BottomNavBar` / `PlayerChip` | ● | ● | ● | | ● | ● | ● | ● | ● | ● |
| `RotateOverlay` / `ScreenTransition` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `ComingOnlinePanel` | ○ | | | | | ● | ○ | ○ | ○ | ● |

---

## 8. Cross-cutting contracts

### 8.1 Accessibility (binding — core rules §10, contract §5)

| Requirement | How components satisfy it |
|---|---|
| Never colour-only | Every state in this document pairs colour with a glyph, silhouette, label or numeral. Reviewer test: render the screen in greyscale; no information is lost. |
| Scalable text | All DOM components size from `rem`; the root font is 14–21 px. Canvas card text auto-fits and the inspect overlay is the escape hatch for tiny thumbnails. |
| Reduced motion | `[data-reduced-motion="true"]` collapses `--dur-*`; presenter switches to fades; foil goes `static`; `RotateOverlay` glyph stops; `PackOpeningStage` uses the instant grid. |
| Keyboard | Every interactive component is reachable and operable: roving focus in grids/rails, Enter/Space to activate, Esc to dismiss, arrow keys for meters and sliders, `Tab` order follows visual order. Battle exposes hotkeys for hand slots 1–0, End Turn, Confluence, Fixation, inspect. |
| Controller | The same focus model with a virtual cursor for the board; remappable in Settings. |
| Screen readers | Cards expose a composed `aria-label`; meters use `role="meter"` with `aria-valuenow/min/max/text`; the history rail is an `aria-live="polite"` log; trigger resolution announces "resolving 2 of 5: Afterparty". |
| Icon labels | The "always show text labels under icons" setting adds labels to `IconButton`, `NavItem`, `StatusIconStrip` and the Current badge. |
| Audio cues | Turn start, rope, lethal available, Obsessed threshold crossed, Confluence available — each mirrors a visual, never replaces one. |

### 8.2 Input (unified pointer — contract §5)

| Gesture | Mouse | Touch | Keyboard |
|---|---|---|---|
| Play a card | drag from hand to slot/target | drag, **or** tap-tap (tap card → tap slot) | select with 1–0, Enter, then arrows + Enter for slot/target |
| Attack | drag from character to target | drag or tap-tap | focus character, Enter, arrows, Enter |
| Inspect | right-click or hover 600 ms | long-press 400 ms | `I` on the focused card |
| Cancel | Esc or right-click | tap outside / drag back to origin | Esc |
| Fast-forward animation | click | tap | Space |

Touch specifics: `touch-action: none` on the WebGL canvas; pointer capture during drags;
multi-touch beyond the first pointer is ignored during a drag; a 6 px movement threshold
distinguishes tap from drag.

### 8.3 Data flow

```mermaid
flowchart LR
  ENGINE["engine reducer<br/>applyIntent()"] -->|EngineEvent[]| PRES["presenter.ts<br/>animation queue"]
  ENGINE -->|redact(state, seat)| VIEW["PlayerView"]
  PRES --> HUD["HUD components §4"]
  PRES --> BOARD3D["3D components §4"]
  VIEW --> HUD
  PREDICT["predict()"] --> PB["PredictionBadge / ConfluenceButton"]
  HUD -->|PlayerIntent| DRIVER["LocalMatchDriver"]
  BOARD3D -->|PlayerIntent| DRIVER
  DRIVER --> ENGINE
  CONTENT["ContentIndex (data/*.json)"] --> RENDER["cardRenderer §2"]
  RENDER --> HUD
  RENDER --> DOMSCREENS["DOM screens §5, §6"]
```

Components never import the reducer, never mutate `MatchState`, and never infer hidden
information — a redacted `cardId: null` renders as an unknown card, always.

### 8.4 Implementation order

| Phase | Components | Rationale |
|---|---|---|
| 1 | §2 card frame + `CardCanvas` + `CardBack` | Everything else displays cards |
| 2 | §3 primitives + §6 chrome | Screens cannot exist without them |
| 3 | §5.1–5.9 collection/deck components | Deck building unblocks real matches |
| 4 | §4.1–4.12 core battle HUD | Playable match |
| 5 | §4.13–4.21 zones, Confluence, triggers, targeting previews | Full rules readability |
| 6 | §4.22–4.28, §5.10–5.16 | Polish, ceremony, meta screens |

---

*Related documents: architecture — `00-architecture-contract.md`; performance, platform
and asset pipeline — `05-performance-and-platform.md`; screens and layouts —
`../design/03-screens-and-navigation.md`; rules canon — `../design/00-core-rules.md`;
economy naming — `../design/07-economy-and-monetization.md`.*
