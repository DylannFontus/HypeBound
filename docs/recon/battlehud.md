# Recon: Battle HUD, hand bar, targeting, mulligan, action log

**Score: 4/10** — 20 defects (7 critical)

## The single worst thing

There is no HUD — there are seven unrelated translucent rectangles pinned to viewport corners with `position:absolute`, floating on top of a photograph, none of them touching the board. The mat ends at a hard rectangular edge (x=318 and x=1285 at 1600px) and everything the player actually needs — their own health, Hype, Obsession, End Turn — lives outside that edge, in the wallpaper. The proof is the bottom-left corner: `.leader-plate-player` (battle.css:203) and `.ability-bar` (battle.css:905-908) are anchored to the *identical* `bottom: var(--sp-3); left: var(--sp-4)`, so the player's own leader plate is painted over by the two ability buttons and the leader name "LIL Kilowatt" is visibly bisected — top half behind "Drop the Bass", bottom half behind "Blackout Finale", a 12px sliver of letterforms showing through the gap. That collision is present in every single capture at every viewport size. Hearthstone, MTGA and Gwent all solve this the same way: the HUD is not overlaid on the board, it *is* the board's frame — the mat, the rail, the hero plate, the mana row and the end-turn button are one continuous carved object, so nothing can ever collide and nothing floats.

## Defects

### 1. [CRITICAL] `.leader-plate-player` and `.ability-bar` are anchored to the exact same coordinates, so the player's own leader plate (name, HP orb, hand/deck/discard counts) is permanently occluded by the two ability buttons. Only a ~12px horizontal sliver of the leader name is visible, bisected between the two buttons. `.obsession-player` at `bottom:84px` lands in the same stack. Three HUD panels, one anchor.

- **Where:** src/ui/theme/battle.css:203 (`.leader-plate-player { bottom: var(--sp-3); left: var(--sp-4) }`), :258 (`.obsession-player { bottom: 84px; left: var(--sp-4) }`), :905-908 (`.ability-bar { bottom: var(--sp-3); left: var(--sp-4) }`) — visible bottom-left in board.png, late-turn.png, mid-1280.png, phone-landscape.png
- **Why it fails:** AAA-BAR §7 (craft details nobody asks for and everybody notices) and §8.2. The rival gets a portrait plate with name, HP and three counters; the player gets a sliced-in-half rectangle. In Hearthstone both heroes have an identical framed portrait with the health gem welded to it, mirrored across the board — you can read your own life total in one saccade. Here the player's life total exists only as a 22px bubble on a 60px 3D medallion in the middle of the mat, which the hovered hand card then covers.
- **Fix:** Delete the three separate bottom-left anchors. Build one `player-rail` flex container that owns the leader plate, the Obsession dial and the ability buttons in a single grouped frame, and mirror it against the rival's rail so the two players' state reads identically. Reserve its width in the hand-bar layout so cards can never reach it.

### 2. [CRITICAL] Resting hand cards are deliberately hung off the bottom of the viewport (`bottom: calc(var(--hand-card-height) * -0.14)`), so the entire lower stat row — attack and health gems — of every hand card is below the fold. With ten cards in hand you can see cost gems and card art and nothing else; you cannot plan a turn without hovering each card in sequence.

- **Where:** src/ui/theme/battle.css:13 (`--hand-card-height: 17.5vh`) and :43 (`bottom: calc(var(--hand-card-height) * -0.14)`); see late-turn.png (10 cards, all stat rows clipped) and mid-1280.png
- **Why it fails:** AAA-BAR §4 (numbers the player reads under pressure are high-contrast and legible) and §0. Hearthstone, MTGA and Gwent all keep the *whole* hand card visible at rest — Hearthstone's fan is scaled down but the attack/health gems are never cropped, because the hand is where the turn is planned. Cropping the stats is not a stylistic choice, it removes the information the hand exists to carry.
- **Fix:** Set `--hand-card-height` from available viewport height minus a reserved rail, clamp the card so its full frame including the stat row is inside the viewport, and get the compression from `scale()` plus fan overlap rather than from pushing cards off-screen. Give the hand bar its own lit rail so the bottom edge is a designed boundary rather than a crop.

### 3. [CRITICAL] Hovering any hand card scales it 1.85× from a bottom origin, and the resulting card covers the player's entire half of the board — the leader medallion, and any character the player has in play. In attack-arrow.png the hovered 'Arena Tour' completely hides the player's own 'Backup Dancer' and the leader medallion; in mid-1280.png the leader medallion is gone entirely.

- **Where:** src/ui/theme/battle.css:69-77 (`.hand-card:hover { transform: rotate(0deg) translateY(calc(var(--hand-card-height) * -0.3)) scale(1.85) }`) — see attack-arrow.png, mid-1280.png, targeting.png
- **Why it fails:** AAA-BAR §2 (depth is built) and §5. Hearthstone lifts the hovered card only ~1.25× and pushes it *forward in z with a parallax tilt*, never far enough to eat the friendly minion row; MTGA renders the enlarged card in a dedicated preview slot at the screen edge so the battlefield is never covered. Covering your own board while reading a card is a mechanical handicap, not a flourish.
- **Fix:** Cap the hover scale at ~1.25× and move the full-size read into a dedicated inspect plate anchored in the left or right gutter (the space currently wasted on backdrop photo), the way MTGA does. Push neighbouring hand cards aside and dim them so the lift reads as depth rather than occlusion.

### 4. [CRITICAL] Board characters are the full card face rendered at ~22% — a 120×150px thumbnail with the entire rules paragraph typeset at roughly 4px. Six of them in a row is a wall of illegible grey noise; the cost/attack/health gems are the only readable elements and they are 16px.

- **Where:** src/ui/battle/cardMesh.ts (board tokens reuse the full card render) and src/ui/cardRenderer/renderCard.ts — see late-turn.png (six enemy characters) and late-1280.png
- **Why it fails:** AAA-BAR §4 and §0. None of the three reference games puts card body text on the board. Hearthstone draws a minion as a *portrait* in an oval frame with two large gems and keyword icons; Gwent uses a compact row card with one huge power numeral; MTGA scales the card but shows only art + name + P/T at board size. Shrinking the whole card face is the single most recognisable indie shortcut in a card game.
- **Fix:** Add a `renderBoardToken()` variant to the card renderer: art crop, name plate, big tabular attack/health gems, keyword icons only, no body text. Keep the full face for hover/peek. Increase the token's on-screen size by ~40% now that it no longer needs to carry paragraph text.

### 5. [CRITICAL] The End Turn button is a 132px flat purple disc with a solid conic-gradient ring, floating over the backdrop photograph outside the mat's right edge. There is no bevel, no contact shadow, no ring track, and the conic gradient leaves a visible hard notch/seam at 12 o'clock. It is the most important button in the game and it reads as a `border-radius:50%` div.

- **Where:** src/ui/theme/battle.css:323-370 (`.turn-wrap`, `.timer-ring`, `.end-turn-btn`) — see clip-endturn.png at 3×, and board.png where it sits over the rooftop art
- **Why it fails:** AAA-BAR §1 (nothing is flat; banned: a drop shadow with no corresponding highlight — here it is worse, a glow with no shadow and no contact) and §2. Hearthstone's end-turn is a carved plate *set into the board frame* with a burning rope above it and three distinct lit states; Gwent's is a brass tab clipped into the right edge of the mat; MTGA's is a chamfered trapezoid docked to the phase bar. All three are physically attached to the play surface. This one is a circle on the wallpaper.
- **Fix:** Dock the button into a raised rail on the mat's right edge. Give it a real bevel (top rim highlight + bottom inner shadow), a 24px soft drop plus a 2px contact shadow, a visible unfilled ring track, rounded ring caps, and a specular sweep on the `ready` pulse. Replace the conic gradient with an SVG arc so there is no seam.

### 6. [CRITICAL] No drop-target feedback exists on the mat while dragging. `setSlotHighlight()` is defined and exposed by the board API but **never called anywhere in `src/`** — only `clearSlotHighlights()` is called. The slot ring meshes and glow sprites built at board.ts:177-230 render at opacity 0 for the entire match. Dragging a card onto an empty board shows a small ghost following the cursor and nothing else.

- **Where:** src/ui/battle/board.ts:20, :310-313 (defined), src/ui/battle/battleView.ts:499, :596, :760 (only `clearSlotHighlights` is ever called) — see drag-dropzone.png, ghost held at (740,600) over the player's own empty row with zero mat response
- **Why it fails:** AAA-BAR §5 (every state is designed) and §3 (secondary motion — when the main thing moves, something moves because of it). Hearthstone physically opens a gap in the minion row and lights a green glyph on the board; Gwent lights the whole target row and shows an insertion caret; MTGA snaps a translucent card outline into the battlefield. HYPEBOUND already built the slot markers and then never turned them on.
- **Fix:** Call `setSlotHighlight(side, drag.hoverSlot, true)` from `BattleView.externalDragMove` (battleView.ts:723-743) alongside the existing `makeRoomIndex` logic, and clear the previous slot. Add a ground-projected glow pool under the pointer and a rim light on the mat's near edge while a drag is live.

### 7. [CRITICAL] The Hype counter — the game's primary resource — is a ~50×50px cluster of 15×21px hexagons plus 20px text, sitting raw on the backdrop photograph in the extreme bottom-right corner with no panel, no scrim and no shadow. It renders directly over the brightest orange rooftop lights in the art. There are no empty sockets, so the player cannot see the ramp; `flex-wrap: wrap; max-width:320px` means the row will wrap to two lines at 10 crystals and shift the layout.

- **Where:** src/ui/theme/battle.css:297-318 (`.hype-wrap`, `.hype-row`, `.hype-crystal`, `.hype-count`) and src/ui/battle/hud.ts:347-362 (`renderHype` emits only `min(cap, max(shown,1))` crystals) — see clip-hype.png at 3× (152×152 device px total), board.png, late-1280.png
- **Why it fails:** AAA-BAR §4 ('Text over imagery always has a scrim, a shadow, or a plate. Never raw.') and §6 (saturation is a resource). Hearthstone's mana row is ten always-present sockets, each ~34px, seated in a carved wooden tray at the bottom-right of the hand — unmissable, and the empty sockets teach the ramp on turn one. Here on turn one you get one dot.
- **Fix:** Render all ten sockets always (empty ones as dark cut recesses), seat them in a lit tray docked to the hand rail so the crystals cast onto it, at least double the crystal size, remove `flex-wrap`, and give the count a tabular plate. Add a fill animation on gain and a drain on spend.

### 8. [MAJOR] Every HUD surface is a flat translucent fill with a uniform 1px border and nothing else. `.obsession-dial`, `.leader-plate` and `.ability-btn` hand-roll `background: var(--glass-strong); border: 1px solid var(--glass-border)` with no inset highlight and no drop shadow, while `.history-panel` uses `.panel` which *does* carry `inset 0 1px 0 rgba(255,255,255,0.07)` and a shadow. Two lighting models on one screen.

- **Where:** src/ui/theme/battle.css:183-196 (`.leader-plate`), :247-256 (`.obsession-dial`), :915-928 (`.ability-btn`) vs src/ui/theme/base.css:311-318 (`.panel`) — see clip-obs-enemy.png, clip-enemyplate.png, clip-ability.png, clip-log.png at 3×
- **Why it fails:** AAA-BAR §1, explicitly: 'Banned outright: a solid background on any surface larger than an icon. A `border: 1px solid` as the only edge treatment.' And §1's key-light rule — 'If the top edge of one panel is lit and the top edge of the next is not, the screen has two suns.' That is literally the state: the log panel is lit from the top, the obsession dial beside it is not.
- **Fix:** One raised-panel mixin used by every HUD surface: gradient with the key light from top-left, 1px `rgba(255,255,255,0.08)` top rim, 1px black bottom, 2-4% canvas noise overlay, 24px soft drop + 2px contact shadow. Retire the ad-hoc `background+border` pairs.

### 9. [MAJOR] The action log is a plain dark box of undifferentiated 12px text. All lines are the same size, weight and colour except damage lines which turn pink; turn markers are distinguished only by a leading em dash. It overflows and guillotines the top line horizontally mid-glyph (visible in late-turn.png and attack-arrow.png) because `max-height:210px` clips with no fade mask and no opaque header backing. It logs no-op events ('Restored 0 health', twice) and unattributed ones ('a character took 1', 'You leader took 3' with no source named).

- **Where:** src/ui/theme/battle.css:451-472 (`.history-panel`, `.history-list`, `.history-entry`), src/ui/battle/hud.ts:419-427 (`logEvent`) and hud.ts:581-636 (`describeEvent` — 'healed' returns a line even when `amount` is 0; 'damageDealt' names the target but never the source) — see clip-log.png at 3× and late-turn.png
- **Why it fails:** AAA-BAR §4 (real hierarchy: display/heading/body/label/numeric) and §7 (dividers fade at the ends; nothing pops in). MTG Arena's log colour-codes by player, indents by turn, inlines mana symbols, and every card name is a hover-previewable link naming the source of every damage event. Gwent's log is a stack of small card thumbnails with a verb. A flat text list with em-dashes is a debug console.
- **Fix:** Group by turn with a sticky turn header and a hairline rule that fades at both ends; give card names their own weight/colour and a hover preview; render costs as the Hype glyph; make damage numbers tabular and right-aligned. Suppress zero-magnitude events in `describeEvent`. Name the source in `damageDealt`. Add a top and bottom fade mask on `.history-list` and a styled scrollbar.

### 10. [MAJOR] The mulligan 'REPLACE' mark is a full-bleed hard-cornered magenta rectangle stamped across the middle of the card, directly over the card's name plate, destroying the name. Its square corners protrude past the card's 10px rounded frame. Selection is otherwise signalled only by `grayscale(0.7) brightness(0.6)`.

- **Where:** src/ui/theme/battle.css:671-683 (`.mulligan-mark { inset: auto 0 40% 0; background: var(--danger) }`) — see mulligan-selected.png
- **Why it fails:** AAA-BAR §1 (a solid `#hex` fill on a surface larger than an icon) and §7 (consistent corner radii). Hearthstone flips the mulliganed card physically face-down to a card back with an X and slides it back toward the deck; MTGA dims and drops the card with a return arc. A pink bar over the name is a placeholder.
- **Fix:** Replace with a physical treatment: flip the card to its back with a 320ms 3D rotate and a shadow sweep, and mark it with a stamped seal that respects the card's corner radius. Never cover the card name.

### 11. [MAJOR] The mulligan lays six cards out with `flex-wrap: wrap`, which breaks 5+1 at 1600px — one orphaned card on a second row with the Confirm button crammed 20px beneath it. The Coin equivalent ('Borrowed Clout') has no distinct framing; it is just the card that happened to wrap. There is no timer, no selection count on the Confirm button, and the 1180×745 panel is the largest flat fill on the screen.

- **Where:** src/ui/theme/battle.css:655-658 (`.mulligan-panel`, `.mulligan-cards { flex-wrap: wrap }`) — see mulligan.png and mulligan-selected.png
- **Why it fails:** AAA-BAR §0 and §5 (empty/first states are designed too). Hearthstone's mulligan is a single row of exactly three or four cards on a lit table with a visible countdown, and The Coin is presented separately with its own animation after confirm. A CSS flex wrap deciding your layout is the tell.
- **Fix:** Force a single row with `scale()`-based compression instead of wrapping; present the free extra card in its own labelled slot below the mulligan row ('You go second — you start with Borrowed Clout'); label the button 'Replace 2' / 'Keep All'; add the countdown ring. Give the panel a lit frame, texture and a contact shadow.

### 12. [MAJOR] The two Obsession dials are the same data presented two different ways in two different places: the rival's is top-centre and legible, the player's is bottom-left and buried under the ability stack. On the track itself, the Fixation and Ultimate thresholds are unexplained 3px coloured underlines on pips 3 and 7, and the danger-zone pips (>= threshold) look identical to safe pips at rest, so the meter's entire consequence is invisible until it fires.

- **Where:** src/ui/theme/battle.css:257-258 (two different anchors), :279-291 (`.obs-pip`, `.obs-pip.fix`, `.obs-pip.ult` — markers are `border-bottom` stripes) and src/ui/battle/hud.ts:285-290 — see clip-obs-enemy.png at 3× and the bottom-left of board.png
- **Why it fails:** AAA-BAR §6 (never signal by colour alone) and §4. Gwent mirrors both players' round score in identical plates on the same vertical axis; Hearthstone mirrors both mana rows. Mirrored resources must be presented identically or the player cannot compare them at a glance — which is the only reason the rival's is on screen.
- **Fix:** Mirror the two dials on the same axis inside the player/rival rails. Make the danger segment a visibly different track recess (not just a pip colour), and give the Fixation/Ultimate marks a notch in the track with a small glyph, not a coloured underline.

### 13. [MAJOR] The leader plate uses literal emoji and mixed glyph sources as icons: ✋ renders as a full-colour yellow hand emoji, ▤ as a box-drawing character, ✖ as a text glyph — three different sources, three optical sizes, and one of them full-colour inside a monochrome neon HUD. The 'portrait' is a flat coloured disc with a number, not the leader's art, and the health fill is red at 30/30.

- **Where:** src/ui/battle/hud.ts:253-256 (`✋ ${handCount}`, `▤ ${deckCount}`, `✖ ${discardCount}`, `⧉`) and src/ui/theme/battle.css:206-236 (`.leader-orb`, `.leader-orb-fill` — fixed `linear-gradient(180deg, #ff5f7a, #b31432)` regardless of ratio) — see clip-enemyplate.png at 3×
- **Why it fails:** AAA-BAR §7: 'Icons on a single grid, single stroke weight, single optical size.' A yellow OS emoji in a neon-noir HUD is the fastest possible tell. And §6: a red orb at full health is a colour lie — the player learns to ignore it, so it cannot warn them at 8 HP (which is exactly what late-turn.png shows: the player at 8 HP with no alarm anywhere on screen).
- **Fix:** Replace all four with the project's own SVG icon set on one grid at one stroke weight. Put the leader's actual portrait art in the orb behind the health fill. Ramp the fill colour with the ratio and add a low-health state: cracked rim, desaturated portrait, slow pulse, and an inset red vignette on the HUD frame below ~30%.

### 14. [MAJOR] The 'End your turn?' confirmation blacks out the entire board with an `rgba(3,2,8,0.78)` + blur(12px) scrim for a routine, reversible action, and does so with a generic left-aligned web dialog whose title alignment contradicts the centred mulligan panel two screens earlier.

- **Where:** src/ui/theme/battle.css:644-653 (`.battle-overlay`) and :685-694 (`.confirm-panel`) — see the first late-turn.png capture
- **Why it fails:** AAA-BAR §2 (overlay is a depth plane, not a light switch) and §7 (consistency). MTGA surfaces the same warning as a small chip beside the pass button and never covers the battlefield; Hearthstone never blocks at all. Blacking out the board to ask a yes/no question is a web pattern, not a game pattern.
- **Fix:** Demote to a non-blocking chip anchored to the End Turn rail ('1 Hype and 3 cards unspent — end anyway?') with the End Turn button itself as the confirm. If a modal is kept, use a 30-40% scrim with a radial falloff so the board stays readable, and align its grammar with the mulligan panel.

### 15. [MAJOR] The whole HUD fails at phone-landscape. At 844×390 the End Turn ring is clipped off the right edge of the viewport, the action log overlaps it, the 'HYPE' label runs off the right edge, the 'RIVAL · OBSESSION' label wraps to two lines and breaks the panel's baseline, two hand cards sit entirely behind the ability buttons, and the bottom-left stack occupies 135px of a 390px-tall screen.

- **Where:** src/ui/theme/battle.css:323-328 (`.turn-wrap` right-anchored with no small-viewport rule), :297-302 (`.hype-wrap`), :762-765 (the only responsive block, gated on `max-height:620px`, does not reposition `.turn-wrap` or `.hype-wrap`) — see phone-landscape.png
- **Why it fails:** AAA-BAR §9: 'Every screen still has to work at 1280×720 and on a phone in landscape.' This is a hard constraint, not an aesthetic one. Hearthstone Mobile and MTGA Mobile both reflow to a compressed rail layout; nothing is ever clipped by the viewport.
- **Fix:** Once the HUD is a single frame rather than corner-pinned absolutes, define two layouts: wide (side rails) and short (the rails collapse into the top and bottom bars, End Turn becomes a docked tab). Assert no element's bounding rect exceeds the viewport in the existing verify-mobile.mjs.

### 16. [MINOR] The Location zones render as two bare wireframe rectangles floating at the far right of each row — a 35%-opacity plane plus a 4-segment `RingGeometry`, with no label, no icon, no fill and no relationship to anything else on the mat. In every screenshot they read as an unfinished debug outline.

- **Where:** src/ui/battle/board.ts:281-307 (location plinths) — the two thin outlined rects at (1190-1250, 120-200) and (1190-1250, 635-720) in board.png
- **Why it fails:** AAA-BAR §5 (empty states are designed too) and §0. Hearthstone's weapon and hero-power slots are carved sockets with a visible glyph even when empty; Gwent's row and leader slots are engraved. A stroked rectangle with nothing in it is indistinguishable from a bug — which is exactly how I read it before finding the source.
- **Fix:** Give the empty Location slot a carved recess: inner shadow, a faint engraved venue glyph, and a slow specular crawl. Label it once on first play. Align it to the row grid so it does not float detached from the character row.

### 17. [MINOR] The three top-right control buttons (☺ ⚙ ⚑) are text glyphs at three different optical weights on three separate flat circles, ungrouped, floating on the sky directly above the action log with no shared frame.

- **Where:** src/ui/battle/hud.ts:163-186 and src/ui/theme/battle.css:514-515 (`.battle-controls`) — top-right of board.png
- **Why it fails:** AAA-BAR §7 (single icon grid, single stroke weight) and §1. In all three reference games the settings/concede/emote controls live in a single docked chrome cluster, not three loose discs.
- **Fix:** One grouped control rail sharing the raised-panel mixin, with project SVG icons on one grid, and a designed hover/focus-visible state.

### 18. [MINOR] The mat/rows divider is a hard-ended 2px lavender line butting into nothing at both ends, and the mat itself terminates in a hard rectangular edge against a fully sharp, fully saturated backdrop photograph. The brightest, most saturated pixels on screen are the orange rooftop lights in the periphery, not the cards.

- **Where:** src/ui/battle/scene.ts / src/ui/battle/board.ts (mat + centre rail) — visible in every full board capture
- **Why it fails:** AAA-BAR §2 ('the battle backdrop art is beautiful and is currently ~80% covered by an opaque mat with a hard rectangular edge… bleed it, light it') §6 ('the background competes with the buttons') and §7 ('dividers that fade at the ends rather than butting hard into a panel edge').
- **Fix:** Fade the divider to zero alpha over its outer 15% at each end. Feather and bleed the mat edge into the environment with a soft alpha ramp and a ground-shadow gradient, and darken/desaturate the backdrop outside the mat by ~35% with a radial falloff toward the play area.

### 19. [MINOR] The drag ghost is *smaller* than the hovered hand card (rendered at 200px vs a 1.85× hover scale), carries the same green outline as the resting `playable` state, and casts no shadow onto the mat — so picking a card up makes it shrink and produces no state change.

- **Where:** src/ui/battle/handBar.ts:227-241 (`renderCardToCanvas(card, 200)`), src/ui/theme/battle.css:112-128 (`.hand-drag-ghost` — `outline: 2px solid rgba(125,255,176,0.9)`, identical to `.hand-card.playable` at :79-83) — see targeting.png and drag-dropzone.png
- **Why it fails:** AAA-BAR §5 (rest/hover/active must all be distinct) and §3 (secondary motion). Hearthstone's picked-up card lifts, tilts toward the cursor with inertia, and drags a ground shadow that separates as it rises. Here it is the same card, smaller, with the same outline.
- **Fix:** Match or exceed the hover scale on pickup, swap the outline for a distinct 'carried' treatment (rim glow + rotation lag toward pointer velocity), and add a projected ground shadow whose blur and offset track the card's virtual height.

### 20. [MINOR] The rival's hand is invisible — represented only by a `✋ 4` chip in the leader plate. There are no card backs at the top of the board.

- **Where:** src/ui/battle/hud.ts:253 (hand count as a text chip); nothing renders opponent hand cards in src/ui/battle/scene.ts or boardModel.ts
- **Why it fails:** AAA-BAR §0 and §2. Hearthstone, MTGA and Gwent all render the opponent's hand as physical fanned card backs that grow and shrink — it is the primary source of on-board tension and it is free depth in the top plane. A number in a corner carries none of it.
- **Fix:** Render the rival's hand as a fanned row of card backs at the top of the mat, with a draw animation from the deck and a play animation out of the fan, so the count is felt rather than read.

## Plan

1. FOUNDATION FIRST — do not start any item below until the shared primitives exist: the raised-panel material mixin, the motion tokens, the icon set and the noise generator (see sharedNeeds). Every defect here is downstream of not having them.
2. Fix the bottom-left collision by replacing the three independent absolute anchors (battle.css:203, :258, :905) with a single `player-rail` grouped container, and build its mirror as `rival-rail`. This alone removes the worst pixel on the screen and makes the player's own health readable.
3. Build the HUD frame: dock the two rails, the hand rail and the End Turn tab into one continuous carved chrome that reads as the board's furniture. Nothing may remain pinned to a viewport corner. Feather the mat edge into the backdrop and darken/desaturate the periphery by ~35% so the frame is the brightest structure on screen.
4. Rebuild the hand bar: size `--hand-card-height` from the reserved rail so every card's stat row is fully inside the viewport, get compression from scale + fan overlap instead of off-screen crop, cap hover at ~1.25×, and move the full-size read into a gutter inspect plate so the hover can never cover the player's board.
5. Add `renderBoardToken()` — art crop, name plate, large tabular attack/health gems, keyword icons, no body text — and enlarge board tokens ~40%. This is the change that most raises the screenshot's first impression after the frame.
6. Turn on the drop-target feedback that already exists: call `setSlotHighlight()` from `BattleView.externalDragMove` (battleView.ts:723-743), add a pointer glow pool and a mat rim light during drag, and differentiate the carried-card state from the resting playable state.
7. Rebuild End Turn as a docked plate: SVG arc timer with a visible track and rounded caps (kills the conic seam), real bevel, contact shadow, designed rest/hover/pressed/disabled/rope states, specular sweep on ready. Demote the end-turn confirmation to a non-blocking chip on the same rail.
8. Rebuild the Hype tray: ten permanent sockets seated in a lit tray docked to the hand rail, double crystal size, no flex-wrap, tabular count on a plate, fill/drain animations.
9. Rebuild the action log: turn grouping with sticky headers, fading hairline rules, card names as their own type role with hover preview, tabular right-aligned numbers, top/bottom fade masks, styled scrollbar. Suppress zero-magnitude events and name the damage source in `describeEvent` (hud.ts:581-636).
10. Rebuild the mulligan: single non-wrapping row, physical card-back flip for replace (delete `.mulligan-mark`), the free extra card in its own labelled slot, count on the confirm button, countdown ring, lit panel with texture and contact shadow.
11. Mirror and rebuild the Obsession dials on one axis; make the danger segment a track recess and the Fixation/Ultimate marks notched glyphs, not coloured underlines.
12. Replace every emoji and box-drawing glyph in hud.ts with the project SVG icon set; put leader portrait art in the health orb, ramp the fill colour with the ratio, and add a designed low-health state (rim crack, desaturation, HUD vignette).
13. Carve the Location slots into designed empty recesses; render the rival's hand as fanned card backs; group the top-right controls into one docked cluster.
14. Add the short-viewport layout (rails collapse into top/bottom bars, End Turn docks as a tab) and extend verify-mobile.mjs to assert no HUD element's bounding rect exceeds the viewport at 1280×720 and 844×390.
15. Verification pass: re-shoot mulligan, mid-game, full-hand, drag, 1280×720 and 844×390; confirm 60fps high / 30fps low, `prefers-reduced-motion` kills only decorative layers, contrast holds on the Hype and Obsession numerals, and focus-visible is designed on every rail control.

## Files

- `D:/Gooner Card Game/src/ui/theme/battle.css`
- `D:/Gooner Card Game/src/ui/theme/base.css`
- `D:/Gooner Card Game/src/ui/battle/hud.ts`
- `D:/Gooner Card Game/src/ui/battle/handBar.ts`
- `D:/Gooner Card Game/src/ui/battle/battleView.ts`
- `D:/Gooner Card Game/src/ui/battle/board.ts`
- `D:/Gooner Card Game/src/ui/battle/targeting.ts`
- `D:/Gooner Card Game/src/ui/battle/cardMesh.ts`
- `D:/Gooner Card Game/src/ui/battle/scene.ts`
- `D:/Gooner Card Game/src/ui/battle/boardModel.ts`
- `D:/Gooner Card Game/src/ui/cardRenderer/renderCard.ts`
- `D:/Gooner Card Game/src/ui/art/iconAssets.ts`
- `D:/Gooner Card Game/scripts/verify-mobile.mjs`
- `D:/Gooner Card Game/scripts/verify-ui.mjs`
