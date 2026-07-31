# Recon: Rewards — shop, banner/gacha, battle pass (Hype Wave), missions, achievements

**Score: 3/10** — 19 defects (6 critical)

## The single worst thing

The reward moment does not exist as a moment. Opening a five-card Merch Drop is a 180ms opacity cross-fade of five 150px thumbnails inside a small dialog floating in a dimmed void, over in ~1.2s with no player input. Worse, a ten-pull on the gacha banner — the most celebrated interaction in the genre — is rendered as a wrapped row of 24px-tall TEXT CHIPS (bannerScreen.ts:266-291 `revealStrip()`), below the fold, with no card art at all. In my capture the pull contained a Legendary ("Clause Thirteen, the Fine Print") and it was a text pill with a 1px gold border, the same size as the nine commons beside it. Nothing flips, nothing bursts, nothing is bigger because it is rarer, and the wallet counter does not tick. Hearthstone gives you a physical pack you grab and tear, five backs that flip on YOUR click, a rarity gem crack and a legendary screen-flash; MTGA rotates a 380px card in with a foil sweep; Gwent's keg shatters. HYPEBOUND prints a receipt.

## Defects

### 1. [CRITICAL] The pack reveal is a cross-fade, not a flip, and there is no pack. `.reveal-front` transitions `opacity 0.18s ease, transform 0.18s` from scale(0.94); `.reveal-back` just goes to opacity 0. No `perspective`, no `rotateY`, no card-back art (the back is `linear-gradient(150deg, rgba(255,255,255,.09), rgba(0,0,0,.45))` — a bare grey rounded rectangle), no burst, no light sweep, no pack object to click. `showReveal()` auto-plays all five on a 260ms timer; the player's only agency is a click that skips.

- **Where:** src/ui/theme/screens.css:1943-1961; src/ui/screens/shopScreen.ts:169-251 (see scripts/screenshots/recon/rewards/reveal-0.png .. reveal-2.png)
- **Why it fails:** AAA-BAR §3 (motion has physics, set-pieces 500-900ms, secondary motion) and §7 ("Nothing ever pops in"). Hearthstone's pack open is a 6-10s player-driven set-piece: the pack tears, five illustrated backs fan onto the table, each flip is a 3D rotateY with a paper-snap and a rarity gem that cracks. MTGA rotates each card in on a Y axis with a specular sweep. Here five thumbnails fade in.
- **Fix:** Give `.reveal-inner` `transform-style: preserve-3d; perspective: 1200px` and animate `rotateY(180deg)->0` over 420ms on `--ease-overshoot`, with `.reveal-back` at `rotateY(180deg); backface-visibility: hidden`. Render the real card back (the game ships seasonal card backs as pass rewards) into `.reveal-back` via the card renderer. Make each flip player-initiated with a 4s auto-flip fallback. Add a per-rarity light burst and a 60ms screen flash on epic/legendary landing on the same frame as `sfx.pack.rareReveal`.

### 2. [CRITICAL] A ten-pull is rendered as text pills. `revealStrip()` emits `<span class="banner-pill rarity-legendary">Clause Thirteen, the Fine Print <em>+600 Signal</em></span>` — no canvas, no card, no animation. The strip is appended at the bottom of the document (bannerScreen.ts:379), which at the shipped 1600x900 viewport is ~400px below the fold: you press ×10 Pull and, visibly, nothing happens.

- **Where:** src/ui/screens/bannerScreen.ts:266-291 and :379; src/ui/theme/screens.css:2871-2886 (see scripts/screenshots/recon/rewards/banner-pull10.png, y≈1280)
- **Why it fails:** AAA-BAR §0 (the one-sentence test) and §2 (overlay plane). Genshin/HSR/Gwent take the ten-pull full-screen: a wipe, ten cards dealt face-down, per-card flips with rarity-escalating VFX, rarest held last and largest. MTGA's booster fills the viewport. A 24px chip in a wrapped list is a changelog entry, not a reward.
- **Fix:** Reuse the same full-screen reveal overlay as the shop (one component, ten slots, 2 rows of 5) instead of a second, weaker presentation. Sort so the highest rarity flips last. Render each pulled card with `renderCardToCanvas` at 220px. Keep the text list as a collapsed summary beneath for the disclosure requirement.

### 3. [CRITICAL] The battle pass track is a 50-row HTML table of text strings. Fifty near-identical rows of "◈75 / Minor seasonal cosmetic". Not one reward is depicted — "Seasonal card back", "Seasonal leader skin", "Animated profile portrait", "Card-back tint I/II/III" are all plain text in a grey box 445px wide holding ~40px of content. The season XP bar is a 3px flat rail at 0% with no tier pips.

- **Where:** src/ui/screens/hypeWaveScreen.ts:102-135, :213-219; src/ui/theme/screens.css:2772-2811 (see scripts/screenshots/recon/rewards/pass-full.png)
- **Why it fails:** AAA-BAR §1 (nothing is flat), §2 (four depth planes — this has two), §5. Hearthstone's Rewards Track is a horizontal rail of 3D reward chests with a filling energy meter and a level-up burst; MTGA's Mastery Pass is a horizontal node track with an illustrated tile per item and split free/premium lanes; Gwent's Journey is an illustrated road with milestone portraits. All three show you the object. This shows you a spreadsheet cell.
- **Fix:** Rebuild as a horizontal scroll-snap rail of tier nodes (96px medallion + 128px reward tile), free lane above / Backstage lane below, with a continuous filled rail running through the medallions and a tick every 5th tier. Every reward gets a rendered preview (card back = the actual card back canvas; tint = a swatch on a card back; currency = 32px icon + tabular numeral). Keep a list view toggle for accessibility, not as the only view.

### 4. [CRITICAL] Two shop panels have literally zero padding: text is clipped by the panel border. `.panel` (base.css:311) sets no padding and neither `.shop-offer` nor `.shop-odds` adds any, while its sibling `.shop-headliner` sets `padding: var(--sp-5)`. The "STANDARD DROP" eyebrow has its cap-height cut off by the top border stroke; "5 cards", the body copy, "LEGENDARY GUARANTEED WITHIN" and "40 Drops" all start flush at x=0 touching the left border; "0 opened" sits on the bottom border; and in the odds panel "WHAT IS IN A DROP" collides with the "RARITY / CHANCE PER CARD" table header 18px below it.

- **Where:** src/ui/theme/base.css:311-318 (.panel, no padding); src/ui/theme/screens.css:1897 (.shop-offer) and :1915-1924 (.shop-odds) — see scripts/screenshots/recon/rewards/shop-focus.png, the clipped "STANDARD DROP" at y=0-12
- **Why it fails:** AAA-BAR §0 and §7. Text touching a container edge is the fastest possible read of "nobody looked at this". No shipped card game has type crossing a panel stroke. It also makes §1's edge treatment impossible — a panel cannot have an inner shadow relationship to content sitting at inset 0.
- **Fix:** Put `padding: var(--sp-5)` on `.panel` itself with a `.panel-flush` opt-out for the two places that genuinely bleed, and add a gap to `.shop-odds` the way `.shop-offer` has one. Then audit every `.panel` consumer for the double-padding this exposes.

### 5. [CRITICAL] Rarity drama is on the wrong element and inverted. `.reveal-slot.legendary .reveal-back { box-shadow: 0 0 26px var(--rarity-legendary) }` puts the gold glow on the FACE-DOWN card, then `.reveal-slot.shown .reveal-back { opacity: 0 }` removes it the instant the card turns. The game spoils the legendary before you flip it, then gives the revealed legendary zero treatment — no aura, no frame, no particles, no scale difference from the commons beside it.

- **Where:** src/ui/theme/screens.css:1956-1960
- **Why it fails:** AAA-BAR §6 ("the most saturated thing on screen should be the thing that matters most") and §5. Hearthstone does the exact opposite: the back is identical for all five, and the legendary announces itself at the moment of the flip with an orange gem crack, a light bloom, a persistent gold aura and a distinct sting. Telling the player before the flip removes the only tension the mechanic has.
- **Fix:** Delete the rarity classes from `.reveal-back` entirely. Move all rarity treatment onto `.reveal-slot.shown`: a persistent per-rarity aura (radial glow + slow conic sheen), 1.08 scale for legendary, a one-shot particle burst, and hold the highest-rarity card 400ms longer than the rest.

### 6. [CRITICAL] Claiming any reward is acoustically and visually identical to pressing a navigation button. `claimMission` plays `sfx.ui.click` (the same sound as Back); pass tiers, achievements and milestones play `sfx.ui.confirm` (the same sound as buying the pass). Every claim path then calls `render()`, which does `root.innerHTML = ...` and rebuilds the whole tree — so nothing can animate across the state change, scroll position is destroyed, and there is no toast, no counter tick, no item-to-wallet flight, no burst.

- **Where:** src/ui/screens/missionsScreen.ts:266-278; src/ui/screens/achievementsScreen.ts:193-204; src/ui/screens/hypeWaveScreen.ts:316,336,342
- **Why it fails:** AAA-BAR §3 (secondary motion — "the single biggest gap between animated and alive") and §7 ("Sound and visual land on the same frame"). In Hearthstone, completing a quest flings gold into the counter which ratchets up; MTGA flies the reward icon into the wallet pill and pulses it. Here the number just is different next frame.
- **Fix:** Add `grantReward(fromEl, reward)`: a 480ms arc from the claimed row to the matching wallet pill on `--ease-arrive`, a counter that tickers over 320ms with tabular numerals, a 160ms pulse+glow on the destination pill, and a distinct `sfx.reward.claim` layered by tier. Convert the claim paths from full `render()` to targeted row patching so the animation survives.

### 7. [MAJOR] The two bonus dailies render as unstyled raw text with no panel. missionsScreen.ts:205,217 emit `<li class="mission-card">` inside `<ul class="missions-list">`, but `.mission-card` (screens.css:3718) is styled as a vertical list row (`padding: var(--sp-2) 0; border-top: 1px solid`) while `.missions-list` is a grid (`repeat(auto-fill, minmax(300px,1fr))`). Two row-styled items land in adjacent 300px grid cells, so "Daily Puzzle / 30 Clout" and "Daily Doomscroll / 50 Clout · 300 XP" sit on the raw page background with no border, no padding, no background, colliding at the column boundary, with shrink-to-fit ghost buttons while every other mission button on the screen is full-width.

- **Where:** src/ui/screens/missionsScreen.ts:204-230 vs src/ui/theme/screens.css:2163-2170 and :3717-3721 (see scripts/screenshots/recon/rewards/missions-full.png, y≈825-960)
- **Why it fails:** AAA-BAR §0 and §7 (consistency). Two of the eight missions on the screen are visibly a different, broken species. Nothing in Hearthstone's quest log renders without its scroll.
- **Fix:** Give the bonus dailies the same `.mission` card treatment and put them in the same grid, or move them into their own `.panel` with `display:flex; flex-direction:column` so `.mission-card`'s top-border row styling is in the container it was written for.

### 8. [MAJOR] Achievements have no badge art. Every achievement's entire visual identity is a point value in a 30px circle, and every state is the word "Locked" / "Unlocked" / "Claimed" in `--text-dim` at the far right — eight identical rows produce a vertical column of the word "Locked" repeated eight times. Progress bars at 0% are a 2px `rgba(255,255,255,0.09)` hairline (~1.1:1 contrast — effectively invisible). Milestone rewards ("Trophy Shelf frame", "Full Wall frame") are text chips; you cannot see the cosmetic you are working toward.

- **Where:** src/ui/screens/achievementsScreen.ts:61-95 and :99-115; src/ui/theme/screens.css:2549-2587 (see scripts/screenshots/recon/rewards/ach-full.png)
- **Why it fails:** AAA-BAR §5 ("every state is designed") and §1. Xbox/PSN/Hearthstone all give each achievement an illustrated badge, greyed and desaturated when locked and full-colour with a rim light when earned — the badge is the reward for looking at the list. A repeated grey word is a database column, not a state design.
- **Fix:** Generate procedural achievement badges at runtime through the existing canvas pipeline: a hexagonal plate whose bevel, metal tint and rim come from the point tier (10/25/50), desaturated at 40% for locked, full colour with a rim light for unlocked, check plate for claimed. Replace the "Locked" text with lock iconography plus badge state (keep the word as label/aria — never colour-alone). Render the actual frame cosmetic as a 96px preview in the milestone tile.

### 9. [MAJOR] The banner has no hero. The source comment (bannerScreen.ts:23-25) states the fallback is "the featured Legendary's own procedural card" — but that fallback is not executed: the Legendary renders at 150px in a flat 7-up flex row, identical in size and framing to the two Rare spotlights, distinguished only by the caption "Legendary · rate-up 1.0%". The banner key art is a paragraph of body copy in a bordered box. The row is `display:flex; flex-wrap:wrap` so it breaks 5+2 with a ragged orphan row whose container shrink-wraps to 417px, leaving ~1180px of void beside it.

- **Where:** src/ui/screens/bannerScreen.ts:23-25 and featuredStrip; src/ui/theme/screens.css:2845-2859 (.banner-featured, .banner-card) — see scripts/screenshots/recon/rewards/banner-full.png
- **Why it fails:** AAA-BAR §2 (depth planes) and §6 (one hero accent per screen). In MTGA the set banner is full-bleed key art with the mythic at 3x; in Gwent the keg screen is a lit 3D object; in every gacha the featured unit is a 60%-of-screen splash. The featured card here is card #1 of 7 in an equal-weight strip — no hierarchy at all, so the screen has nothing to look at first.
- **Fix:** Promote the featured Legendary to a 380-420px hero card, offset left, with the banner's Current palette bled behind it as a soft radial atmosphere plane and a slow specular crawl across the face (3-8s, §3 idle-never-dead), and the blurb set as display type over a scrim to its right. Put the other six in a fixed 3x2 grid at 150px as "also spotlighted". Zero new assets — it is the renderer you already have, at a different scale.

### 10. [MAJOR] The pull buttons — the point of the banner screen — are below the fold. At 1600x900 the Encore Meter panel begins at y≈1024; ×1 Pull and ×10 Pull sit at y≈1157. The player lands on the gacha screen and cannot see how to pull. The Encore Meter rail is a flat 3px line with no pity tick at 50 and no numerals on the rail, and ×10 is styled identically to ×1 (both `.btn-primary`, same gradient, same height) so the premium action has no visual precedence. Four identical ghost buttons beneath (Exact rates / Change Target / Backstage Shop / History) compound it into button soup.

- **Where:** src/ui/screens/bannerScreen.ts:352-379; src/ui/theme/screens.css:2861-2869 (compare scripts/screenshots/recon/rewards/banner.png at 1600x900 with banner-full.png)
- **Why it fails:** AAA-BAR §9 ("Every screen still has to work at 1280x720") and §6. In Genshin and HSR the ×10 is the largest, brightest, lowest-right anchor of the screen and is never scrolled off.
- **Fix:** Pin the Encore Meter + pull actions as a sticky bottom rail (`position: sticky; bottom: 0`) with its own raised material and a top contact shadow so it reads as furniture over scrolling content. Make ×10 the hero: 1.35x height, hero gradient, keg/gem iconography; demote ×1 to secondary. Give the meter a filled gradient with a specular sweep and a hard tick at the hard-pity index. Collapse the four ghost buttons into one segmented control.

### 11. [MAJOR] Every reward state is signalled by opacity alone: `.pass-cell.claimed { opacity: 0.55 }`, `.pass-cell.locked { opacity: 0.42 }`, `.ach-row.claimed { opacity: 0.66 }`, `.ach-milestone.claimed { opacity: 0.62 }`, `.checkin-step.claimed { opacity: 0.5 }`, `.mission-card.is-done { opacity: 0.6 }`. Locked premium pass rewards additionally get `text-decoration: underline dotted` (`.pass-reward.deferred`), which reads as a spelling error, not a lock.

- **Where:** src/ui/theme/screens.css:2804-2809, 2538, 2559, 2907, 3720
- **Why it fails:** AAA-BAR §5 ("A hover that only changes opacity is not a hover") and §9 (contrast ratios hold). `--text-dim` at 0.42 alpha on the panel fill is far under 4.5:1 — locked pass rewards are not readable. Hearthstone locks a reward with a gold padlock plate and a darkened frame at full opacity; MTGA uses a scrim plus a lock glyph. Fading is the cheapest and least legible option and it breaks the contrast contract.
- **Fix:** Replace all six with a state token set that changes fill, border, an explicit icon and the label — never alpha. Locked: full-opacity darkened plate + padlock glyph + label. Claimable: accent rim + inner glow + a subtle 4s breathe. Claimed: desaturated (not faded) plate + check glyph. Keep every text at >=4.5:1 in all four states.

### 12. [MAJOR] Bare `toLocaleString()` / date formatting leaks the browser locale into English copy. Headless Chrome resolves to fr, so the shop and banner wallets read "5 000" with a French narrow no-break space, the banner reads "Running until 17 août 2026. Reruns: 27 juillet 2026 · 23 novembre 2026 · 22 mars 2027" and the pass reads "Runs until 14 septembre 2026" — mid-English-sentence. Wallet numerals are also not tabular: `.currency-value` has no `font-variant-numeric`, so the counter jitters when it changes width.

- **Where:** src/ui/screens/shopScreen.ts:68,71,112,269-270; bannerScreen.ts:304-306; hypeWaveScreen.ts:236-237; missionsScreen.ts:134; achievementsScreen.ts:146-155; src/ui/theme/screens.css:242
- **Why it fails:** AAA-BAR §4 ("Numbers that the player reads under pressure are tabular, high-contrast, and never move when they change width"). Currency is the number most read in this domain and it is the one that shifts. A French month inside an English sentence is a visible bug on any non-en machine.
- **Fix:** Add `src/ui/format.ts` exporting `num(n)` pinned to `en-GB` and `date(d)` pinned to `en-GB` + `timeZone: 'UTC'` (bannerScreen already documents the UTC intent at :57-60 but the wallet path bypasses it). Add `font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'` to `.currency-value`, `.pass-tier-value`, `.ach-score-value` and every progress label.

### 13. [MAJOR] Half of every screen is empty. The shop's right column ends at y≈397 of 900 because `.shop-body` uses `align-content: start` on a two-column grid, leaving 55% of the right half bare. Missions uses `repeat(auto-fill, minmax(300px, 1fr))` for a list that is always exactly three items, so auto-fill manufactures empty tracks and abandons the right ~600px. The banner leaves ~500px of dead page below the reveal strip. The pass content is a 980px column centred in 1600px.

- **Where:** src/ui/theme/screens.css:1887-1895 (.shop-body), :2163-2170 (.missions-list), :2726 (.pass-body)
- **Why it fails:** AAA-BAR §2 and §6 (value structure — squint and the screen should resolve into masses; here it resolves into one small mass and a lot of nothing). Hearthstone's shop fills the frame with pack art at scale; MTGA's store is a full-width tiled storefront. Empty background is the clearest signal that layout was left to default flow.
- **Fix:** Shop: make the Standard Drop panel the hero of the right column — a large rendered pack object with an idle float and specular crawl filling the column, odds table as a right-rail accordion. Missions: `auto-fit` instead of `auto-fill` plus a `max-width` so three cards stretch and centre. Banner: the sticky pull rail removes the dead bottom. Pass: the horizontal track fills the width by construction.

### 14. [MAJOR] Not one surface in the domain is anything but a flat translucent fill. `.panel` is `background: var(--glass); border: 1px solid var(--glass-border)` with one inset top highlight and a uniform drop — no gradient with a key light, no bottom dark edge, no texture. The only texture on any of these five screens is `.ambient-bg::after`, a 64px CSS grid. `.btn-primary` is `linear-gradient(135deg, accent, accent-hot)` with no rim highlight and no contact shadow, stretched to 1100x56 on the shop (a 20:1 bar, not an object).

- **Where:** src/ui/theme/base.css:311-318 (.panel), :378-387 (.btn-primary), :270-303 (.ambient-bg) — applied throughout all five reward screens
- **Why it fails:** AAA-BAR §1 in full: "Banned outright: a solid background on any surface larger than an icon. A border 1px solid as the only edge treatment." Every panel on all five screens is exactly that. Gwent's panels are stamped leather with a metal bead and a visible weave; Hearthstone's are carved wood with a bevel readable at 25% zoom. These are CSS rectangles.
- **Fix:** Build the shared raised-panel material and a runtime canvas grain generator and apply both to `.panel` once: top rim `inset 0 1px 0 rgba(255,255,255,0.09)`, bottom `inset 0 -1px 0 rgba(0,0,0,0.5)`, a 24px soft drop plus a 2px tight contact shadow, a 3% grain overlay. Rebuild `.btn-primary` as a vertical two-stop gradient (light from top) with a white top rim, a dark bottom lip and a coloured contact glow, and cap CTA width at ~420px.

### 15. [MAJOR] The focus ring does not follow the control's shape. `:focus-visible` sets `border-radius: var(--radius-sm)` on the outline but `.btn` is `border-radius: var(--radius-pill)`, so focusing the shop's Open-a-Drop button draws a near-square white 3px box whose corners project past the pink pill. It is a plain white rectangle with no offset plate.

- **Where:** src/ui/theme/base.css:157-166 and :235-239 vs :348 (.btn radius) — see scripts/screenshots/recon/rewards/shop-focus.png
- **Why it fails:** AAA-BAR §5 — "Focus-visible must be beautiful, not the browser default ring. It is on screen every time somebody plays with a keyboard." This is worse than the browser default because it visibly mismatches the shape it surrounds.
- **Fix:** Drop the `border-radius` override from the `:focus-visible` rules and let the outline inherit each control's own radius (Chromium follows border-radius for `outline` since 94). Make it a two-layer treatment: a 2px accent-tinted inner ring at the element radius plus a 4px dark halo, with a 120ms scale so focus lands with the same weight as hover.

### 16. [MAJOR] Six independently invented progress bars, all flat, all 2-5px, all invisible at 0%. `.shop-counter-bar` (4px), `.mission-bar` (5px), `.mastery-bar` (borrowed by the banner's Encore Meter), the pass season bar, `.ach` row bars (2px) and the milestone bars each have their own height, radius, track colour and fill colour, and none has a gradient, specular sweep, tick marks or numerals on the rail. At 0% the shop pity bar reads as a stray hairline divider butted against the panel's bottom border.

- **Where:** src/ui/theme/screens.css:1906-1913, 2189-2190, 2861-2869, and the `bar()` helper in src/ui/screens/achievementsScreen.ts
- **Why it fails:** AAA-BAR §7 (one system, consistent radii) and §1. The pity counter and the Encore Meter are the two most emotionally loaded numbers in the economy and they render thinner than the panel border beside them. Hearthstone's rewards-track bar is a lit energy channel with a moving highlight and a numeral riding on it.
- **Fix:** One `ProgressRail` primitive: 10px track with an inner shadow, gradient fill lit from the top, a 3s specular sweep on the filled portion, optional tick marks, and a tabular numeral plate. Replace all six call sites. Give the pity and Encore rails a distinct guarantee tick so the pity promise is visible, not only written.

### 17. [MINOR] Reward icons fall back to bare glyph characters that render as unreadable smudges. `<span class="ui-icon ui-icon-merch-drop-open">◈</span>` in the reveal eyebrow, the Daily / Weekly section-header icons on missions, and the `✦`/`✧` currency fallbacks all render at 12-14px as an ambiguous coloured mark. In the reveal capture the header reads as "▪ DROP OPENED".

- **Where:** src/ui/screens/shopScreen.ts:178; src/ui/theme/screens.css:225-232, 242-244, 261-284 (the `html.has-icon-*` fallback scheme) — see reveal-0.png y≈267 and missions-full.png y≈584, y≈1045
- **Why it fails:** AAA-BAR §7 — "Icons on a single grid, single stroke weight, single optical size." Three sources (font glyph, background-image, Unicode mark) at three optical weights on one screen. A Unicode lozenge standing in for a currency is exactly the tell the bar is written to catch.
- **Fix:** Generate the missing icons procedurally into the same canvas/data-URI pipeline `installIconStyles()` already feeds, on one 24px grid at one stroke weight, so the `has-icon-*` class is always present and the text fallback never paints. If an icon is absent, render nothing and keep the label.

### 18. [MINOR] `paint()` in the reveal rewrites `overlay.innerHTML` on every one of the five steps, so all previously-revealed card canvases are re-rendered from scratch each tick (the `slot.childElementCount > 0` guard at shopScreen.ts:216 can never be true after an innerHTML replace) — 15 `renderCardToCanvas` passes for a 5-card pack. `overlay.addEventListener("click", …)` is also re-registered inside `paint()` (:225) on a node that is never replaced, so five click handlers accumulate.

- **Where:** src/ui/screens/shopScreen.ts:174-233 (esp. 176, 213-218, 225)
- **Why it fails:** AAA-BAR §9 ("Performance floors hold. A beautiful effect that drops frames is a bug") and §3 — it also structurally prevents per-card animation, because every already-revealed card's DOM is destroyed and recreated every 260ms, restarting any entrance transition.
- **Fix:** Build the five slots once, cache the canvas per slot, and on each step only toggle `.shown` on the next slot. Attach the overlay click handler once, outside `paint()`.

### 19. [MINOR] The Stream Check-In row shows ten rewards with no reward art and four different value formats in one row: icon+number (`◈50`, `◈100`, `◈150`), word+number (`20 Signal`, `30 Signal`), bare count (`2 reroll tokens`, `1 Merch Drop`) and a two-line wrap (`This month's card back`), inside ten identical flat boxes with the current step marked only by a border colour.

- **Where:** src/ui/screens/missionsScreen.ts (checkin steps) and src/ui/theme/screens.css:2889-2911 — see scripts/screenshots/recon/rewards/missions.png y≈378-430
- **Why it fails:** AAA-BAR §4 (a real hierarchy) and §5. Every daily check-in in the genre — Genshin, Fortnite, HSR — renders the item icon in each node with the quantity as an overlaid tabular numeral and marks today with a lit plate, not a hairline. Four formatting conventions in one ten-cell row is the same defect as four type sizes standing in for a hierarchy.
- **Fix:** One `RewardTile` component rendering icon + tabular quantity for all ten. Give today's node a lit plate, a scale bump and a slow breathe; give claimed nodes a check plate at full opacity.

## Plan

1. Ship the shared foundation first, before any screen work: the raised-panel material (padding included, so the zero-padding class of bug becomes impossible), the canvas grain generator, the motion token set + stagger(), the rarity token module, the ProgressRail and RewardTile primitives, and the locale-pinned number/date formatter. Everything below consumes these; building them second guarantees fifteen bevels.
2. Fix the two shipping-blocker layout bugs immediately — one line each: add padding to `.panel` (base.css:311) so shop text stops being clipped by its own border, and fix the `.mission-card` inside `.missions-list` grid mismatch so the two bonus dailies stop rendering as raw unpanelled text.
3. Rebuild the pack reveal as a real set-piece: full-viewport overlay, a pack object with an idle float that the player clicks to tear, five real card backs fanned out, per-card 3D rotateY flips on player click (auto-flip fallback at 4s), rarity aura + burst + screen flash on the revealed face, highest rarity held last and largest. Cap at 900ms/card, 1200ms for the legendary. Cache the canvases and build the DOM once.
4. Point the banner's ten-pull at that same reveal component instead of `revealStrip()`, with ten slots in 2x5 and the text strip demoted to a collapsed summary. Highest-value single change in the domain, and one call site once the component exists.
5. Rebuild the Hype Wave track as a horizontal scroll-snap rail: tier medallions on a continuous ProgressRail, free lane above / Backstage lane below, every reward rendered as a RewardTile preview rather than named in text. Keep an accessible list view behind a toggle.
6. Give the banner a hero: featured Legendary at ~400px with the Current palette bled behind it as an atmosphere plane and a slow specular crawl; the other six drop to a fixed 3x2 grid. Pin the Encore Meter + ×10 pull as a sticky bottom rail so the pull action is never off-screen at 1280x720.
7. Generate procedural achievement badges through the existing canvas pipeline (tiered plate, desaturated when locked, rim-lit when earned, check plate when claimed) and replace the numeric circle. Render milestone cosmetics as real 96px previews.
8. Replace every opacity-only state (six call sites) with the four-state reward token set — fill, border, icon and label change, alpha does not — and re-check contrast at 4.5:1 in all four.
9. Add the `grantReward()` celebration: arc-to-wallet, ticker counter, destination pulse, and a distinct tiered `sfx.reward.claim` landing on the same frame. Convert the claim handlers in missions / achievements / hypeWave from full `innerHTML` re-render to targeted row patching so the animation survives the state change.
10. Kill the dead space: `auto-fit` on the missions grid, a hero-scale Standard Drop pack in the shop's right column, a full-width pass track. Then squint-test each screen for §6 value structure.
11. Fix the shape-mismatched focus ring, replace the six bespoke progress bars with ProgressRail, route all currency/date formatting through the pinned formatter with tabular numerals, and generate the missing `ui-icon` assets so no Unicode glyph ever paints as an icon.
12. Re-shoot all five routes at 1600x900 and 1280x720 plus a --frames burst of the reveal and the ten-pull, and put them beside a Hearthstone pack-open and an MTGA Mastery Pass screenshot before calling any of it done.

## Files

- `src/ui/screens/shopScreen.ts`
- `src/ui/screens/bannerScreen.ts`
- `src/ui/screens/hypeWaveScreen.ts`
- `src/ui/screens/missionsScreen.ts`
- `src/ui/screens/achievementsScreen.ts`
- `src/ui/theme/base.css`
- `src/ui/theme/screens.css`
- `src/ui/cardRenderer/renderCard.ts`
- `src/ui/cardRenderer/palette.ts`
- `src/ui/art/iconAssets.ts`
- `src/save/settings.ts`
- `src/audio/audio.ts`
- `scripts/verify-shop.mjs`
- `scripts/verify-banner.mjs`
- `scripts/verify-pass.mjs`
- `scripts/verify-missions.mjs`
- `scripts/verify-achievements.mjs`
- `scripts/verify-a11y.mjs`
