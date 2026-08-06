# Recon: Modes and system screens + the global motion/chrome layer (gauntlet, story, tour, doomscroll, remix/remixhub, lab, custom, settings, fairness, privacy, legal, support, cloudsave; transitions, modals, form controls, focus, scrollbars, rotate overlay)

**Score: 4/10** — 18 defects (3 critical)

## The single worst thing

There is no shared form-control layer, so half of this domain falls through to the operating system's own widgets and renders them undisguised on a neon-black screen. The Custom Lobby (scripts/screenshots/recon/systems/custom.png) shows five WHITE-background, black-text Windows `<select>` and `<input type=number>` boxes and a raw blue Windows checkbox; the Lab (lab.png) shows four more; the Settings audio rail (settings.png) is six native `<input type=range>` elements repainted with a single `accent-color` declaration — a 4px grey groove and a flat circle knob with no bevel, no specular, no fill gradient. The root cause is one line: `.input` is written into the markup of customScreen.ts but the only rule that ever mentions it is `.custom-knob .input { width: 6em; }` (screens.css:3734). Put custom.png beside MTG Arena's options panel — whose every dropdown is a carved plate with a chamfered chevron, and whose sliders are a rail with a jeweled handle — and the test in AAA-BAR §0 is answered in under a second. Nothing else in this domain says "unstyled web form" as loudly.

## Defects

### 1. [CRITICAL] Native OS form controls rendered raw: white `<select>`/`<input type=number>` boxes with black text and the Windows accent-blue checkbox on the Custom Lobby and the Lab; six native `<input type=range>` sliders on Settings repainted only with `accent-color`.

- **Where:** src/ui/theme/screens.css:3734-3735 (`.input` only ever gets a width), :1122-1129 (`.lab-field input, .lab-field select` — no `appearance:none`, so the OS chevron and the OS number spinners survive), :952 (`.setting-slider { accent-color: var(--accent) }`); src/ui/screens/customScreen.ts, labScreen.ts, settingsScreen.ts:65. Seen in custom.png, custom-720.png, lab.png, settings.png.
- **Why it fails:** AAA-BAR §1 (a solid `background:#hex` on a surface larger than an icon is banned outright — a white system select is exactly that), §5 (rest/hover/active/focus-visible/disabled/loading/error for every interactive element — a native select has none of ours), §7 (single icon grid, single stroke weight — the OS chevron is a foreign icon). MTG Arena draws every dropdown as a plate with a bevelled chevron and every slider as a rail with a chamfered handle; Hearthstone's volume sliders are carved metal with a jewelled knob. No reference game ever exposes a browser widget.
- **Fix:** Build a real control layer in base.css: `.field`, `.select`, `.checkbox`, `.switch`, `.slider`, all with `appearance:none`. Select gets a CSS-drawn chevron (border-triangle or an inline `data:` SVG — no new dependency), glass fill, `inset 0 1px 0 rgba(255,255,255,.10)` top rim + `inset 0 -1px 0 rgba(0,0,0,.45)` bottom shadow, `--radius-sm` matching the panel family. Slider gets `::-webkit-slider-runnable-track` (grooved: inset dark + 1px top highlight), `::-webkit-slider-thumb` (radial-gradient knob, 2px rim, `--glow-accent` on hover, 0.92 scale on `:active`) and the `::-moz-` twins. Checkbox becomes a drawn box with a stroked tick that animates in over 120ms. Then delete `.input`'s width-only rule and let the primitive carry it.

### 2. [CRITICAL] Panels and body copy run flush into the viewport edge at x=0, and the primary CTA pill has its left cap clipped off-screen.

- **Where:** src/ui/theme/screens.css:3728 `.custom-body { ... padding: var(--sp-3) 0; }` and :3679 `.remix-body { ... padding: var(--sp-3) 0; }`; `.cloud-save-body` is used in src/ui/screens/cloudSaveScreen.ts but has no rule anywhere. Visible in custom.png ("Start match" pill cut at x=0), remixhub.png ("Play this week's Remix" cut at x=0, and the pink `.remix-current` accent bar sliced in half), cloudsave.png ("Keep this device's save" cut at x=0, body text starting at x=2).
- **Why it fails:** AAA-BAR §2 — a screen with no margin has no midground; the content plane and the atmosphere plane are the same plane. And a clipped button is not a depth problem, it is a broken layout that ships. Gwent, Hearthstone and Arena all inset their content columns from the frame so the world can be seen breathing around them.
- **Fix:** One `.screen-body` primitive replacing `.custom-body` / `.remix-body` / `.cloud-save-body` / `.policy-body` / `.fairness-body`: `flex:1 1 auto; overflow-y:auto; width:100%; max-width:1200px; margin-inline:auto; padding: var(--sp-5) clamp(16px,4vw,48px) var(--sp-7); display:flex; flex-direction:column; gap:var(--sp-4);` plus the `.scroll` scrollbar rules folded in. Then every screen that scrolls gets the gutter for free instead of re-deciding it.

### 3. [CRITICAL] `.panel` carries no padding, so any panel whose bespoke class was left out of a hand-maintained selector list renders with its heading, search box and tables jammed against the 1px border.

- **Where:** src/ui/theme/base.css:311-318 (`.panel` = background + border + radius + blur + shadow, no padding) and src/ui/theme/screens.css:3182-3183, where padding is granted by an explicit list: `.fairness-intro, .fairness-table, … .policy-note, .policy-doc { padding: var(--sp-5) }`. `.support-faq`, `.support-report`, `.cloud-save-lead`, `.cloud-save-card`, `.cloud-save-actions`, `.remix-current`, `.remix-quest`, `.remix-rotation`, `.remix-locked` are all absent from it. Seen in support.png (the "Frequently asked" heading sits 1px inside the panel's top-left corner; the search field spans border-to-border) and remixhub.png.
- **Why it fails:** AAA-BAR §1 and §7 — an object whose contents touch its own edge does not read as an object, it reads as a `<div>` that happened to get a border. A padding contract that lives in a list of forty screen-specific class names is guaranteed to drift the moment a sixteenth builder adds a screen; this is the shared-foundation failure the bar exists to prevent.
- **Fix:** Move padding onto the primitive: `.panel { padding: var(--sp-5) }` with `.panel-tight { padding: var(--sp-3) }` and `.panel-flush { padding: 0 }` for the deliberate exceptions (card grids, tables that bleed). Delete the 40-selector list at screens.css:3182-3183 entirely.

### 4. [MAJOR] Pill radius (999px) applied to large content cards, so lozenge-shaped panels sit inside 20px-radius panels on the same screen.

- **Where:** src/ui/theme/base.css:350 `.btn { border-radius: var(--radius-pill) }`; the two consumers that never override it are src/ui/theme/screens.css:1202-1213 `.doom-leader` (a 370×140px leader card — see doomscroll.png, the "Lumi, Starcall" and "The Blue Screen Baron" cards are giant capsules) and :472 `.difficulty-option` (six 570×62px rows — see modal.png).
- **Why it fails:** AAA-BAR §7: "Rounded corners that are consistent and use a smooth superellipse feel, not three different radii on one screen." doomscroll.png has three on one screen — 999px on the leader cards, 20px on the containing panel, ~4px on the run-seed input sitting in the same row as two 999px buttons. Gwent's game-mode tiles all share one corner treatment; the shape language is what makes the screen feel authored.
- **Fix:** Split `.btn` into shape and skin: `.btn` keeps the skin, `.btn-pill` carries `--radius-pill`, and a new `.tile` class (radius `--radius-lg`, left-aligned text, its own hover) is what `.doom-leader` and `.difficulty-option` extend. Add three radius tokens and forbid literals: `--radius-sm` for inputs/chips, `--radius` for tiles, `--radius-lg` for panels.

### 5. [MAJOR] Focus-visible is the browser default ring painted white, and its geometry does not match the control it surrounds — a 6px-radius rectangle drawn around a 999px pill.

- **Where:** src/ui/theme/base.css:157-165. The rule forces `outline: 3px solid #ffffff; outline-offset: 2px; border-radius: var(--radius-sm)` on every focusable element regardless of that element's own radius. Directly visible in focus-ring.png around "Reset all player data". The comment on line 162 says "a second ring in the accent colour" but the declaration that follows is `box-shadow: 0 0 0 Npx rgba(10,6,20,0.9)` — a black halo, not accent.
- **Why it fails:** AAA-BAR §5: "Focus-visible must be *beautiful*, not the browser default ring. It is on screen every time somebody plays with a keyboard." A pure-white hard-edged rect is literally the UA ring with a colour swap, and the radius mismatch makes it read as a rendering bug. §9 also requires focus always be visible, so this cannot be solved by removing it.
- **Fix:** `border-radius: inherit` so the ring takes the control's own shape, then make it a designed object: an inner 2px `--accent-bright` stroke, an outer 1px `rgba(0,0,0,.85)` separator so it survives on light chips, and a soft `0 0 12px rgba(217,165,255,.55)` bloom. Animate `outline-offset` 1px→2px over `--dur-instant` on focus so it lands rather than appears. Fix the lying comment or make the code match it.

### 6. [MAJOR] Screen-to-screen navigation flashes to an empty void frame — there is no crossfade in practice.

- **Where:** src/ui/shell.ts:88-103 (fade the outgoing over 200ms, append the incoming, `.screen` runs `screen-in` for `--dur-med`), src/ui/theme/screens.css:5-12. transition-0.png, sampled ~90ms into a lobby→settings navigation, is a completely uniform #05030b frame with nothing in it; transition-1.png (~150ms) is the settings screen already fully opaque and settled. So the sequence a player sees is: screen, black, screen.
- **Why it fails:** AAA-BAR §3 ("Nothing snaps… everything overlaps") and §2 (four resolvable planes). Because every screen owns its own `.ambient-bg`, the atmosphere plane dies and is reborn with each navigation instead of persisting. Hearthstone keeps the tavern behind everything and animates only the furniture on top of it; MTG Arena holds a persistent环 backdrop and slides panels across it. A black frame is the cheapest possible tell.
- **Fix:** Hoist `.ambient-bg` out of the screens and into a single persistent element behind `#app` so it never unmounts. Make the shell overlap properly: append the incoming screen and start `screen-in` on the same frame the outgoing starts `screen-out` (use `requestAnimationFrame`, not the current implicit ordering), give the incoming 280ms `cubic-bezier(0.2,0.8,0.2,1)` with an 8px rise and the outgoing 180ms `ease-in` with a 4px sink and a 0.995 scale, and stagger the incoming screen's direct children by 40ms so the panels arrive in sequence rather than as one slab.

### 7. [MAJOR] There is no texture anywhere in the entire theme. Every surface is a mathematically flat rgba fill with a 1px border.

- **Where:** `grep -rn "noise|grain|feTurbulence" src/ui/theme/` returns zero hits across all 5,474 lines. src/ui/theme/base.css:311-318 — `.panel { background: var(--glass); border: 1px solid var(--glass-border) }`. The only surface variation in the domain is `.ambient-bg::after`, a 64px grid at 2.8% opacity (base.css:287-297).
- **Why it fails:** AAA-BAR §1 names this exactly: "Texture. Film grain, noise, brushed metal, fabric weave, dust, condensation — *something* at 2–6% opacity so the surface is not mathematically smooth. Perfectly clean gradients read as CSS. Reality has dirt." It also bans "a `border: 1px solid` as the only edge treatment", which is what `.panel` ships. Gwent's parchment has fibre; Hearthstone's wood has grain; every HYPEBOUND panel in gauntlet.png, story.png, fairness.png and legal.png is smooth vinyl.
- **Fix:** Generate one tiling noise tile at build/boot time on an offscreen canvas (128×128, `Math.random()` alpha, no dependency), cache it as a `data:` URI in a CSS custom property `--tex-noise`, and add it to a `.surface` mixin as a `::after` overlay at 3% with `mix-blend-mode: overlay`. Also give `.panel` a real gradient with one key light — `linear-gradient(160deg, rgba(255,255,255,.055), rgba(255,255,255,0) 42%)` — and a matched pair of edges (1px white top rim, 1px black bottom) plus `--shadow` and a 2px contact shadow.

### 8. [MAJOR] Not one pressed state exists across the whole domain.

- **Where:** `grep -c ":active" src/ui/theme/screens.css` returns 0 across 3,811 lines. The only pressed state in the product is `.btn:active` in src/ui/theme/base.css:369-371, and it is `transform` only. Every bespoke control — `.story-card` (screens.css:1554), `.doom-leader` (:1213), `.filter-chip` (:495), `.ownership-tab` (:518), `.cd-tab` (:739), `.remix-row`, `.custom-toggle` — has at most a hover.
- **Why it fails:** AAA-BAR §5 requires rest, hover, active/pressed, focus-visible, disabled, loading and error for every interactive element, and adds that "a hover that only changes `opacity` is not a hover" — `.doom-leader:hover { border-color: var(--accent) }` is a one-property hover and story-hover.png confirms the chapter rows show almost nothing on pointer-over. In all three reference games a press moves, dims, sounds and scales the element inside 120ms; here the click has no physical confirmation at all.
- **Fix:** Define an interaction mixin every clickable class composes: `--press-scale: .985`, `--lift: -2px`. Rest → hover in 120ms `--ease-out` (lift + rim brighten + `--glow-accent` at 40%), hover → active in 80ms (scale to `--press-scale`, lift to 0, inner shadow deepens), disabled = 0.42 opacity + `--tex-noise` desaturate, loading = a shimmer sweep reusing the `sheen` keyframe. Apply it via `@extend`-style class composition, not by hand on 40 selectors.

### 9. [MAJOR] The portrait rotate overlay — a screen many phone players will see first — is a flat near-black rectangle with a system glyph and one line of Segoe UI.

- **Where:** src/ui/theme/base.css:493-519. `background: var(--bg-void)` (a solid `#05030b`), a `--fs-3xl` glyph, centred text. Captured in rotate-overlay.png at 500×900: no logo, no art, no gradient, no depth, no brand. Additionally `.rotate-icon`'s `rotate-hint` 2.4s infinite spin (base.css:513, 516-519) is the one animation in base.css with no `:root[data-reduced-motion="true"]` kill — the `.btn-play` sheen and the ambient grid both have one.
- **Why it fails:** AAA-BAR §1 (solid `#hex` on a full-screen surface is banned outright), §2 (one plane, not four), §5 (this is a designed state, not an error page) and §9 (reduced-motion is a hard constraint, not a nice-to-have). Hearthstone's equivalent is a full art plate with the logo and a rotating device illustration.
- **Fix:** Reuse the persistent `.ambient-bg` behind it, add the HYPEBOUND logo, replace the glyph with a stroked phone SVG drawn on the same icon grid as the rest of the UI, and give the rotate hint an eased 0°→90°→90°→0° cycle with a 1.2s hold rather than a linear spin. Add `:root[data-reduced-motion="true"] .rotate-icon { animation: none }` and a root-level `@media (prefers-reduced-motion: reduce)` that does the same.

### 10. [MAJOR] Nine of the thirteen routes in this domain scroll with the raw Windows/Chrome scrollbar.

- **Where:** Scrollbar styling is scoped entirely to `.scroll` (src/ui/theme/base.css:476-489). screens.css declares 32 `overflow-y: auto` containers and contains zero `scrollbar-*` or `::-webkit-scrollbar` rules. Only 12 of 39 screen files apply `class="scroll"`: gauntlet, story, lab and settings do; fairness, legal, privacy, support, custom, remix/remixhub, cloudsave, doomscroll and tour do not (`.policy-body`/`.fairness-body` at screens.css:3163-3173 sets `overflow-y:auto` with no scrollbar treatment).
- **Why it fails:** AAA-BAR §7 states it literally: "Scrollbars styled to match. A default OS scrollbar in a fantasy card game is a tear in the world." It is also inconsistent within the product — story.png and legal.png sit two clicks apart and scroll with different furniture.
- **Fix:** Move the `scrollbar-width`/`scrollbar-color`/`::-webkit-scrollbar` block out of `.scroll` and onto the `.screen-body` primitive from defect 2, so opting into the layout opts you into the chrome. Give the thumb the same rim-and-shadow edge treatment as `.panel` so it belongs to the same material family.

### 11. [MAJOR] `prefers-reduced-motion` is sampled once, at first launch only, and there is no root-level media query to back it up.

- **Where:** src/save/settings.ts:94-95 reads `matchMedia("(prefers-reduced-motion: reduce)")` inside `defaults()` and writes it to `reducedMotion` (line 111); settings.ts:248 stamps the `data-reduced-motion` attribute. Once a save exists the OS preference is never consulted again. The whole codebase contains three `@media (prefers-reduced-motion: reduce)` blocks (screens.css:675, 685, 1969), all scoped to `.cd-tilt` in the card-detail view — nothing global, nothing that touches `--dur-*`, the ambient grid drift, `lobby-pulse`, `lobby-sweep`, the `.btn-play` sheen or `rotate-hint`.
- **Why it fails:** AAA-BAR §3 ("a hard requirement, not a nice-to-have") and §9 ("Accessibility is not negotiable… reduced-motion is honoured"). A player who turns the OS setting on after their first session gets the full decorative layer and has to find a switch to fix it.
- **Fix:** Add a root-level `@media (prefers-reduced-motion: reduce)` in base.css that applies the same `--dur-*` collapse as `:root[data-reduced-motion="true"]` and kills the decorative animations, so the OS preference works before and independently of the saved setting. Add a live `matchMedia(...).addEventListener("change", …)` listener that re-stamps the attribute for anyone who has not explicitly overridden it. Keep the functional layer (screen transitions shortened to a fade, not removed) exactly as §3 specifies.

### 12. [MAJOR] Four shared primitives the brief names simply do not exist: no tooltip, no global toast, no loading state, no empty state.

- **Where:** `grep -rn "tooltip" src/ui/theme/*.css` → nothing. Toasts exist only inside the battle: src/ui/theme/battle.css:557-571, `.toast-layer` positioned relative to the hand — unreachable from any of the thirteen system routes. `grep -rn "skeleton|spinner|is-loading|\.loading"` → one code comment. `grep -rn "empty-state"` → nothing; gauntlet.png renders the empty state as the plain grey sentence "No runs yet." at body size.
- **Why it fails:** AAA-BAR §5 ("Empty states are designed too. 'You own no cards' is a moment to be charming, not a blank grid") and §7 ("Loading that is part of the world, not a spinner"). It also means fifteen parallel builders each have to invent a toast, which is exactly the divergence the bar was written to stop. Hearthstone's empty deck slots are illustrated; Arena's loading is an animated planeswalker sigil.
- **Fix:** Add to the foundation: (a) `toast(message, kind)` promoted out of battle.css into a fixed top-centre layer with entrance/exit and an `aria-live="polite"` region; (b) `.tooltip` as a CSS-only `[data-tip]` popover with a drawn tail, 400ms open delay, 0ms close, and a keyboard-reachable variant; (c) `.skeleton` shimmer blocks reusing the `sheen` keyframe plus a world-flavoured loader (a slowly filling Hype meter, not a spinner); (d) `.empty-state` with a slot for a drawn glyph, a display-size line and a single CTA. Then rewrite gauntlet's "No runs yet." and the Grand Tour's "Not yet won" as designed empties.

### 13. [MAJOR] The game's display and UI typefaces are the operating system's, so the product literally changes face per platform.

- **Where:** src/ui/theme/base.css:75-76: `--font-display: "Segoe UI Semibold", "Trebuchet MS", system-ui, sans-serif;` and `--font-ui: "Segoe UI", system-ui, -apple-system, sans-serif;`. Every heading in gauntlet.png, story.png, settings.png, fairness.png and legal.png is Segoe UI Semibold. On macOS or Linux the whole domain silently falls back to Trebuchet MS or system-ui.
- **Why it fails:** AAA-BAR §4 ("A real hierarchy: display / heading / body / label / numeric, each with its own weight, size, tracking and colour"). Settings.png has one weight axis and four sizes — the bar says explicitly that is not a hierarchy. Beyond that, the OS UI font is the single strongest signal that a thing is a web page: Hearthstone has Belwe, Gwent has Halis, Arena has Beleren. §9's £0 constraint permits this fix — SIL/OFL faces are free and self-hosted, adding no runtime dependency.
- **Fix:** Self-host two OFL faces (e.g. a condensed grotesque for display, a humanist sans for body) as woff2 in `public/assets/fonts`, declare them with `font-display: swap`, and build a real scale: display `--fs-3xl`/700/`-0.02em`, heading `--fs-xl`/600/`-0.01em`, body `--fs-md`/400/`0`, label `--fs-xs`/600/`+0.08em` uppercase, numeric `font-variant-numeric: tabular-nums` with its own weight. The `.eyebrow` at base.css:529-535 already tracks `+0.16em`, so half the intent is there — finish it.

### 14. [MAJOR] Idle is dead on every screen in this domain. Nothing breathes.

- **Where:** The only ambient motion available to these routes is `.ambient-bg::after`'s `grid-drift`, a 40s linear translate of a grid drawn at `rgba(255,255,255,0.028)` (src/ui/theme/base.css:287-303) — imperceptible at that opacity and that period. `lobby-pulse`/`lobby-sweep` (screens.css:66-98) are scoped to `.lobby-bg`/`.lobby-glow` and never reach gauntlet, story, fairness, privacy, legal, support, cloudsave, custom or remix. doomscroll.png, gauntlet.png and story.png are frozen images.
- **Why it fails:** AAA-BAR §3: "Idle is never dead. A screen with nothing happening still breathes: slow ambient drift, a gentle specular crawl, motes. 3–8 second periods, very low amplitude, never distracting." It also breaks §3's stagger rule — nothing on these screens has an entrance, they mount as one slab.
- **Fix:** Promote the lobby's two ambient layers into the persistent background from defect 6 so every route inherits a 9s pulse and a 14s sweep at reduced amplitude. Add a `stagger(container, 40)` helper that sets `--i` on each direct child and a `.stagger > * { animation-delay: calc(var(--i) * 40ms) }` rule, so the panels on gauntlet.png and story.png arrive in sequence. Both must be inside the reduced-motion kill.

### 15. [MINOR] Dates render in the browser's locale inside a hard-coded English UI — "29 juillet 2026", "mercredi 5 août, 20:00", "EFFECTIVE 30 JUILLET 2026".

- **Where:** `new Intl.DateTimeFormat(undefined, …)` at eleven sites, four of them in this domain: src/ui/screens/fairnessScreen.ts:36, privacyScreen.ts:34, legalScreen.ts:29, hypeWaveScreen.ts:52 (the Remix Queue rotation deadline). Visible in fairness.png, privacy.png, legal.png and remixhub.png.
- **Why it fails:** AAA-BAR §7's craft tier — the details nobody asks for and everybody notices. A French month inside an English sentence on the legal page is the kind of seam that tells a player nobody read this screen after building it. Arena and Gwent format dates in the UI language, not the OS language.
- **Fix:** One shared `formatDate()` in a util module pinned to `"en-GB"` (matching the rest of the copy) and imported by all eleven call sites. If localisation is ever real, that single function is the hook.

### 16. [MINOR] Developer notes and design-doc section numbers shipped as player-facing copy.

- **Where:** remixhub.png: the italic `.remix-why` lines (src/ui/theme/screens.css:3698, content from remixScreen.ts / the modifier data) read "the engine records confluence use as a per-turn boolean rather than a count, so there is no number for balanceOverrides to bend - it needs a real counter first" and "the DSL has highestCost/lowestCost and a permanent banish, so both halves are engine work rather than authoring". custom.png's "NOT IN THIS BUILD" panel cites "§17" and "§18" three times.
- **Why it fails:** AAA-BAR §0 — this is the fastest possible way for a viewer to identify the indie project, because no shipped game prints its own backlog on a mode-select screen. It also breaks §6's discipline: the eye is drawn to a paragraph that has no player value.
- **Fix:** Move the engineering rationale into the data file as a non-rendered `devNote` field, and render players a single designed "Coming soon" state on the locked rows — a dimmed tile with a lock glyph and one sentence of in-world copy. Same for the Custom Lobby's section references.

### 17. [MINOR] Composition wastes large fractions of the frame while other elements are cramped.

- **Where:** story.png: each chapter row is 940px wide, but the middle ~400px between the blurb (ends x≈800) and the "0 / 6 / START" block (starts x≈1215) is empty, and the outer 330px on each side of the viewport is bare grid. doomscroll.png: the lower 35% of the frame (y≈590→900) is pure empty backdrop. privacy.png: `.policy-table td:nth-child(3) { max-width: 46ch }` (screens.css:3204) hits the wrong column, so DETAIL wraps every four words at ~200px while WHERE gets 550px.
- **Why it fails:** AAA-BAR §6's value structure — squint at story.png and it resolves to a stack of identical mid-purple bars with holes in them; there is no light/dark mass and no focal point. §2's four planes are also missing: there is no midground furniture between the atmosphere and the rows. Gwent's mode select fills the frame with a rendered environment and puts the content column deliberately off-centre against it.
- **Fix:** Give story rows a leader portrait or faction crest in the dead middle band and a real progress meter instead of a bare fraction. Give doomscroll's setup panel a vertically centred composition with the act map or a leader render in the lower third. Change the privacy table selector to target the correct column and give it `width: 40%`.

### 18. [MINOR] The one destructive action in Settings is styled identically to the navigation buttons beside it.

- **Where:** "Reset all player data" in focus-ring.png is a plain `.btn` (src/ui/screens/settingsScreen.ts), visually indistinguishable from "Accessibility →" and "Support →" two panels below. `--danger: #ff4d6a` exists at src/ui/theme/base.css:33 and is never applied to it. There is also no `.btn-danger` class anywhere in the theme.
- **Why it fails:** AAA-BAR §5 (every state designed) and §6 ("saturation is a resource — the most saturated thing on screen should be the thing that matters most"). In Hearthstone and Arena, deletion is red-cased and gated by a typed or held confirmation. Here the highest-consequence button on the screen is the least distinguished.
- **Fix:** Add `.btn-danger` to base.css (danger-tinted gradient, danger rim, danger glow on hover) and a shared `confirmDialog()` primitive reusing the `.difficulty-backdrop` scrim — one modal component with title / body / cancel / destructive-confirm, focus-trapped, Escape-to-cancel, returning a promise. Every destructive action in the product then routes through it.

## Plan

1. Build the missing control primitives in base.css before touching any screen: `.field`/`.select`/`.checkbox`/`.switch`/`.slider`, all `appearance:none`, all with rest/hover/active/focus-visible/disabled/invalid. Then delete the `.input` width-only rule (screens.css:3734) and the `.lab-field input, .lab-field select` block (:1122) so custom.png and lab.png stop showing Windows widgets. This is the single highest-value change in the domain.
2. Fix the layout contract: add `padding: var(--sp-5)` to `.panel` in base.css, delete the 40-selector padding list at screens.css:3182-3183, and replace `.custom-body`/`.remix-body`/`.cloud-save-body`/`.policy-body`/`.fairness-body` with one `.screen-body` primitive carrying max-width, auto margins, a `clamp()` gutter and the scrollbar rules. This alone repairs custom, remixhub, cloudsave and support.
3. Split shape from skin on `.btn`: introduce `.btn-pill` and a new `.tile` class at `--radius-lg`, and move `.doom-leader` (screens.css:1202) and `.difficulty-option` (:472) onto `.tile` so the lozenge cards in doomscroll.png and modal.png become panels.
4. Rewrite `:focus-visible` in base.css:157-165 to `border-radius: inherit` with a two-tone ring and a soft accent bloom, and correct the comment that claims an accent ring while shipping a black one.
5. Make the surface material real: generate a canvas noise tile at boot, expose it as `--tex-noise`, and give `.panel` a keyed gradient, a matched rim/shadow edge pair, a 3% noise overlay and a 2px contact shadow. Nothing in the theme currently has texture.
6. Hoist `.ambient-bg` out of the per-screen DOM into one persistent layer behind `#app`, carry `lobby-pulse` and `lobby-sweep` onto it at reduced amplitude, and rework shell.ts:88-103 so the incoming and outgoing screens genuinely overlap. Verify with a fresh `--frames 8x40` burst that no frame is empty.
7. Add a `stagger()` helper plus `.stagger` CSS and apply it to the direct children of every `.screen-body`, so panels arrive in sequence instead of as one slab.
8. Add the four missing primitives — global `toast()` with an aria-live region, CSS-only `.tooltip`, `.skeleton` + a world-flavoured loader, and `.empty-state` — then convert gauntlet's "No runs yet." and the Grand Tour's "Not yet won" onto the empty-state component.
9. Add a root-level `@media (prefers-reduced-motion: reduce)` mirroring the `data-reduced-motion` token collapse, a live `matchMedia` change listener in settings.ts, and the missing kill for `.rotate-icon`.
10. Self-host two OFL faces and build the five-role type scale (display/heading/body/label/numeric) with per-role weight, size, tracking and colour; switch every numeric readout to `tabular-nums`.
11. Redesign the rotate overlay on the persistent background with the logo, a stroked phone icon on the shared icon grid and an eased rotation hint.
12. Add `.btn-danger` and a shared focus-trapped `confirmDialog()`, and route "Reset all player data" and the two cloudsave overwrite buttons through them.
13. Sweep the content seams: pin `formatDate()` to en-GB across the eleven `Intl.DateTimeFormat(undefined, …)` sites, move `.remix-why` engineering notes into a non-rendered data field, strip the §-number references from the Custom Lobby, and fix the `nth-child(3)` column width on the privacy table.
14. Recompose story rows (crest + meter in the dead middle band), the doomscroll setup (fill the lower third), and the Grand Tour grid, then re-shoot all thirteen routes at 1600×900 and 1280×720 and diff against this recon set.

## Files

- `D:/Gooner Card Game/src/ui/theme/base.css`
- `D:/Gooner Card Game/src/ui/theme/screens.css`
- `D:/Gooner Card Game/src/ui/shell.ts`
- `D:/Gooner Card Game/src/ui/screens/customScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/labScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/settingsScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/supportScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/cloudSaveScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/remixScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/doomscrollScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/storyScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/gauntletScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/grandTourScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/fairnessScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/privacyScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/legalScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/playScreen.ts`
- `D:/Gooner Card Game/src/ui/screens/hypeWaveScreen.ts`
- `D:/Gooner Card Game/src/save/settings.ts`
- `D:/Gooner Card Game/src/ui/theme/battle.css`
- `D:/Gooner Card Game/index.html`
- `D:/Gooner Card Game/src/main.ts`
