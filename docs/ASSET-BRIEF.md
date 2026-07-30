# HYPEBOUND — asset brief

Everything that still needs a hand-made asset, what it should look like, what to
call the file, and where to put it.

Written 30 July 2026, against 110/296 cards painted and four factions complete.

---

## 0. Read this first

### 0.1 What is wired up, and what is not

This matters more than anything else in the document. **Two of these categories
work the moment you drop a file in. The rest need code that does not exist yet.**
If you generate 60 icons today, most of them will sit in a folder doing nothing
until I write the loaders.

| Category | Wired? | What happens when you add a file |
|---|---|---|
| **Card art** | **Yes** | Picked up automatically. `public/assets/art/<card-id>.png`, and `npm run verify:art` checks it. |
| **Music and ambience** | **Yes** | Drop the file in `public/assets/audio/`, point the slot at it in `data/audio-manifest.json`. No code change — the manifest is designed for exactly this. |
| Logo / favicon | No | The tab icon is an inline SVG in `index.html`. Replacing it is a small edit I need to make. |
| Currency icons | No | Currently Unicode glyphs — `◈` Clout, `✦` Shards, `✧` Glimmer, `◊` Backstage Tokens — inside `<span class="currency-icon">`. Swapping to images needs a CSS/markup change. |
| Current icons | No | Drawn procedurally in `src/ui/cardRenderer/icons.ts`, straight onto the card canvas. |
| Faction crests | No | Also procedural — a ringed monogram, distinguished by petal count. |
| Confluence icons | No | Procedural. |
| **Battle board backgrounds** | No | The 3D scene renders on a flat clear colour (`#05030b`) with exponential fog. There is no backdrop layer at all yet. |

**Suggested order, so nothing waits on me:** the logo and the music first — the
music is genuinely zero-code, and the logo is a ten-minute edit. Then boards,
then icons. Tell me when you start on boards and I will have the backdrop layer
ready before the files land.

### 0.2 The house style

Paste this **before every image prompt** in this document. It is what keeps 60
separately-generated assets looking like one game.

> **HYPEBOUND house style.** A neon-noir internet-culture card game. Dark
> ultraviolet-to-black backgrounds (#05030b to #120c20), lit by saturated neon
> in magenta (#ff5fa2), violet (#b56cff), cyan (#52c8ff) and gold (#ffcc66).
> Think late-night streaming studio meets occult ritual: glossy black surfaces,
> rim light, volumetric haze, subtle chromatic aberration and scanline grain.
> Stylised and graphic, not photoreal. Confident and slightly satirical, never
> cute, never gritty-realistic. No text, no letters, no numbers, no watermarks,
> no UI chrome, no borders or frames unless asked for.

### 0.3 Rules that apply to every file

- **PNG, and mind the alpha.** Icons and the logo must be on a genuinely
  transparent background — ask for it explicitly, then check in an image viewer
  that the checkerboard is really there. A dark-grey square that looks
  transparent on a dark page is the single most common failure here, and it only
  shows up later on a light surface.
- **No baked drop shadows or outer glow** on icons. The UI applies its own, and
  two glows look like a mistake. Inner glow and emission are fine.
- **Square canvas for icons**, subject centred, with roughly 8% breathing room
  so nothing touches the edge.
- **Nothing readable.** Generators put mangled pseudo-text on everything. Every
  prompt below ends by forbidding it; keep that clause.
- **Name files exactly as written here.** Lower-case, hyphens, no spaces. The
  card-art loader is filename-driven and the others will be too, so a typo is a
  file the game never asks for and never complains about.
- Colours are given as hex because they are the real tokens from
  `src/ui/theme/base.css`. Include them in the prompt.

---

## 1. The logo — HB

One mark, used as the in-game logo, the browser tab icon, and later the desktop
app icon. It has to survive being 16 pixels wide, which is the whole design
constraint.

### 1.1 The master

**File:** `public/assets/brand/hb-mark-master.png` · **2048 × 2048** ·
transparent

> [house style] A bold monogram logo mark: the letters **H** and **B** fused
> into one geometric emblem, contained in a rounded-square badge with softly
> chamfered corners. The monogram is cut *out* of the badge so the dark
> background shows through the letterforms. The badge face is a smooth diagonal
> gradient from violet #c084fc to hot pink #f472b6, with a thin brighter rim
> light along the top-left edge and a faint magenta bloom around the outside.
> The badge sits on a near-black #140a22 base. Heavy, condensed, confident
> letterforms with strong geometry — readable as a silhouette at very small
> sizes. Flat vector-like rendering, crisp edges, no bevel, no gloss highlight,
> no 3D extrusion. Centred, square composition, generous margin. Transparent
> background outside the badge. No extra text, no tagline, no numbers, no
> watermark.

**Judge it at 32 pixels.** Shrink it before accepting. If the H and B smear into
one blob, ask for thicker counters and more space between strokes. Everything
else about the mark matters less than this.

### 1.2 The wordmark (optional, for the main menu)

**File:** `public/assets/brand/hb-wordmark.png` · **3072 × 1024** · transparent

> [house style] The word **HYPEBOUND** as a logotype: heavy condensed geometric
> sans-serif, all capitals, tight letter spacing, slight forward italic lean.
> The letters are filled with a vertical gradient from white-hot #ffe9ff at the
> top through violet #b56cff to deep magenta #ff2f88 at the base, with a thin
> cyan #52c8ff rim light along the underside of each letter and a soft magenta
> bloom behind the whole word. Faint horizontal scanlines across the letterforms
> and a subtle chromatic split on the outer edges. Horizontal composition,
> centred, transparent background. Spell it exactly: H-Y-P-E-B-O-U-N-D. No other
> text, no tagline, no border.

Wordmarks are the one place a generator's text handling has to work. Expect to
regenerate this several times, and check the spelling letter by letter — a
plausible-looking `HYPEBOVND` is the classic outcome.

### 1.3 What I need from the master

Once `hb-mark-master.png` exists I will produce and wire these. **You do not
need to generate them separately** — they are downscales, and I would rather do
them from one source than have six near-identical generations.

| File | Size | Used for |
|---|---|---|
| `public/favicon-16.png` | 16 × 16 | browser tab |
| `public/favicon-32.png` | 32 × 32 | browser tab, retina |
| `public/apple-touch-icon.png` | 180 × 180 | iOS home screen |
| `public/icon-192.png` | 192 × 192 | Android / PWA |
| `public/icon-512.png` | 512 × 512 | PWA splash |
| `public/favicon.ico` | 16/32/48 bundle | legacy, and the `.exe` icon later |

The desktop `.exe` icon comes from the same `.ico`, so nothing extra is needed
when we get to packaging.

---

## 2. Icons

**32 icons.** All **512 × 512 PNG, transparent**, subject centred.

These are the ones that most need a human eye: the game currently draws them as
geometric shapes in code, which is fine and consistent but reads as programmer
art next to real card paintings.

### 2.1 Currencies — 4

Four, and they need to be **instantly distinguishable at 24 pixels in a row next
to each other**, because that is exactly where they appear. Different silhouette
first, different colour second — colour alone fails for a colour-blind player,
and the game has a colour-blind mode.

**Folder:** `public/assets/icons/currency/`

| File | Currency | Prompt (after the house style) |
|---|---|---|
| `clout.png` | Clout — the soft currency, earned by playing | A faceted diamond-shaped gem standing on one point, cut like a brilliant with visible internal facets, glowing hot magenta #ff5fa2 with a white-hot core and a soft pink emission. Sharp angular silhouette. Floating, no base, no shadow. |
| `shards.png` | Shards — crafting material from dismantling | Three irregular broken glass slivers of different sizes, clustered and floating apart slightly as if frozen mid-shatter, translucent violet-white #d9a5ff with bright refractive edges and faint rainbow dispersion. Jagged, asymmetric silhouette — deliberately unlike a cut gem. |
| `glimmer.png` | Glimmer — premium, earned and never bought | A four-pointed star-spark with long thin vertical and horizontal rays and a small bright core, gold #ffcc66 fading to warm white, with a delicate ring of tiny orbiting motes. Elegant and thin — a spark, not a gem, not a coin. |
| `backstage-token.png` | Backstage Token — banner pulls | A hexagonal metal token seen face-on, dark gunmetal with a polished cyan #52c8ff inlay tracing a circuit-like pattern across its face, and a chipped worn edge. Solid, heavy, machined — a physical object, unlike the other three. |

> Add to each: *Centred on a transparent background, no drop shadow, no text, no
> numbers, no border, no container or badge behind the object.*

### 2.2 Currents — 8

The game's elements. Two of them appear on every card frame, so they are the
most-seen icons in the whole product. They must work **monochrome** as well as
in colour — they get tinted by the frame.

**Folder:** `public/assets/icons/current/`

| File | Current | Colour | Prompt |
|---|---|---|---|
| `cinder.png` | Cinder | `#ff6b2c` | A single stylised ember-flame curling upward, with three drifting sparks rising off its tip. Sharp tapering point, hollow centre. |
| `tide.png` | Tide | `#2f93ff` | A water droplet riding the crest of a curling wave, the wave forming a spiral beneath it. Smooth, continuous line. |
| `root.png` | Root | `#56c264` | A thick taproot descending and branching into three fibrous ends, with one small leaf shoot rising from the crown. Organic, asymmetric. |
| `gale.png` | Gale | `#4fe3d0` | Three swept wind-lines curving around an empty centre, like a gust made visible, the longest line hooking into a spiral. Light, open, mostly negative space. |
| `pulse.png` | Pulse | `#a855f7` | A heartbeat waveform spike crossing a circle, the peak breaking out past the circle's edge. Electric, angular. |
| `halo.png` | Halo | `#ffd86b` | A perfect thin ring seen at a slight tilt, with a soft radiant burst behind it and small light motes along its lower arc. Serene, symmetrical. |
| `veil.png` | Veil | `#8b5cf6` | A draped curtain of shadow parting slightly at the centre, with a single eye-like void behind the gap. Soft-edged, dissolving into smoke at the bottom. |
| `prism.png` | Prism | `#ff8fd8` | A triangular prism splitting a single white beam into a fan of coloured rays. Geometric and hard-edged against the softness of the others. |

> Add to each: *A single flat emblem in [colour] with a brighter inner core and
> a faint outer emission of the same hue. Bold simple silhouette that stays
> readable at 24 pixels. Icon design, not an illustration — no scene, no
> background, no ground plane. Centred on a transparent background. No text, no
> border, no containing circle or badge.*

**Check:** desaturate all eight and lay them side by side. If any two are
confusable in grey, the silhouettes need more work. Gale and Tide are the likely
offenders.

### 2.3 Faction crests — 11

These appear on card backs, profile frames and faction pages, so they should
feel like heraldry — an emblem an obsessive fan would put on a jacket.

**Folder:** `public/assets/icons/crest/`

Each takes the house style plus: *A heraldic emblem badge, bilaterally
symmetrical, enclosed in a distinctive outer ring or frame. Bold graphic shapes,
strong silhouette, readable at 32 pixels. Primary colour [hex], on a transparent
background. Metallic dark-chrome linework. No text, no letters, no numbers, no
scroll or banner ribbon.*

| File | Faction | Colour | Subject | Their tagline, for tone |
|---|---|---|---|---|
| `neon-idols.png` | Neon Idols | `#ff5fa2` | A stylised microphone crossed with a radiant star, inside a ring of stage-light bulbs. | *"The show ends when we say it ends."* |
| `gothic-royalty.png` | Gothic Royalty | `#8b3a62` | A pointed crown resting on a closed coffin lid, framed by a wrought-iron oval of thorned roses. | *"Our fandom never dies. Neither do we."* |
| `viral-influencers.png` | Viral Influencers | `#ff8a3d` | An upward-trending arrow bursting through a share-node triangle, ringed by radiating broadcast waves. | *"Like, share, and surrender."* |
| `corporate-creators.png` | Corporate Creators | `#4d8fd6` | A monolithic skyscraper silhouette behind a balanced pair of scales holding a play button, in a rigid square frame with chamfered corners. | *"This victory is brought to you by us."* |
| `digital-demons.png` | Digital Demons | `#d92b4b` | A horned skull built from glitched pixel blocks, half its face dissolving into scan-line corruption, in a cracked ring. | *"Terms and conditions apply. Forever."* |
| `cosplay-champions.png` | Cosplay Champions | `#c77dff` | A theatrical mask split down the middle into two different faces, crossed with a needle and a foam-craft blade, in a ring of stitching. | *"The costume makes the legend."* |
| `afterparty-crew.png` | Afterparty Crew | `#ffb347` | A crescent moon cradling a tipped cocktail glass, with a scatter of confetti, ringed by a loop of string lights. | *"Nothing good happens after 3 A.M. Except us."* |
| `touch-grass-order.png` | Touch-Grass Order | `#6cbf5a` | An open palm pressed down onto a tuft of grass, inside a ring of woven laurel, with a small sun rising behind. | *"Log off. We insist."* |
| `algorithm-syndicate.png` | Algorithm Syndicate | `#35d0d8` | An all-seeing eye whose iris is a spiral of branching decision-tree nodes, in a hexagonal circuit frame. | *"You were always going to pick this card."* |
| `meme-collective.png` | Meme Collective | `#f2d541` | A grinning theatrical mask made of stacked, slightly misaligned duplicate outlines — the same face repeated seven times — in a rough hand-drawn ring. | *"It's funnier the seventh time."* |
| `neutral.png` | Neutral | `#8f8aa8` | A simple faceted octagon containing a small empty circle, in a plain unadorned ring. Deliberately the least ornamented of the eleven. | *"Just here for the drama."* |

### 2.4 Confluence icons — 9

Fired when two Currents combine. They should read as **events**, not objects —
more energetic and less static than the Current icons, and visibly built from
their two parent colours.

**Folder:** `public/assets/icons/confluence/`

| File | Name | Currents | Prompt subject |
|---|---|---|---|
| `steamveil.png` | Steamveil | Cinder + Tide | Billowing steam curling into a concealing shroud, orange #ff6b2c heat bleeding into blue #2f93ff vapour. |
| `bloom.png` | Bloom | Tide + Root | A flower bursting open mid-frame with a splash of water at its base, blue #2f93ff to green #56c264. |
| `sandstorm.png` | Sandstorm | Root + Gale | A swirling wall of grit and torn leaves driven sideways, green #56c264 into teal #4fe3d0. |
| `tempest.png` | Tempest | Gale + Pulse | A lightning bolt forking inside a spiral of wind, teal #4fe3d0 into violet #a855f7. |
| `starflare.png` | Starflare | Pulse + Cinder | A star collapsing then erupting in a lance of light, violet #a855f7 into orange #ff6b2c. |
| `blackflame.png` | Blackflame | Cinder + Veil | A flame burning in inverted darkness, its light consuming rather than emitting, orange #ff6b2c into deep violet #8b5cf6. |
| `sanctuary.png` | Sanctuary | Root + Halo | A domed shield of interlaced branches under a radiant ring, green #56c264 into gold #ffd86b. |
| `eclipse.png` | Eclipse | Halo + Veil | A gold #ffd86b corona around a total black disc, with the corona fraying into violet #8b5cf6 shadow. |
| `refraction.png` | Refraction | Prism + any | A single beam striking a prism and exploding into eight divergent coloured rays, one for each Current. |

> Add to each: *A dynamic energy emblem captured mid-burst, radial composition,
> glowing and semi-transparent at the edges, dissolving into particles.
> Transparent background, centred, no text, no border, no containing badge.*

### 2.5 System and UI icons — 8

Small, functional, and they must not compete with the card art.

**Folder:** `public/assets/icons/ui/`

| File | Subject |
|---|---|
| `merch-drop.png` | A sealed foil card pack, standing upright, edge catching violet rim light, faintly bulging as though about to burst. |
| `merch-drop-open.png` | The same pack torn open at the top with light and three card corners erupting out of it. |
| `mastery.png` | A laurel-wreathed chevron rank insignia with a small gem at its apex. |
| `hype-wave.png` | A stylised rising wave-form built from stacked horizontal bars increasing in height, cresting into a spark. |
| `mission-daily.png` | A checklist tablet with a single glowing completed tick and a small sun in the corner. |
| `mission-weekly.png` | The same tablet with three ticks and a crescent moon in the corner. |
| `achievement.png` | A trophy cup whose bowl is a faceted gem, on a low plinth. |
| `streak.png` | A flame formed from a spiralling ribbon numeral-less loop, suggesting continuity rather than fire. |

---

## 3. Battle board backgrounds — 12

This is the biggest visual upgrade available to the game. Right now the 3D board
floats on a flat near-black void with fog. A real backdrop behind it is the
difference between "a prototype" and "a place".

### 3.1 Size, and why

**3840 × 2160 (4K, 16:9) PNG.** Not negotiable downward — here is the reasoning:

- The game is a browser app that runs full-screen on desktop monitors, so it has
  to survive a 2560-wide and a 3840-wide display without softening.
- It sits **behind** a 3D scene that already applies exponential fog, so the
  backdrop is partly veiled in play. That is why it can be a painting rather
  than a photoreal render — but it is *not* a reason to author it small, because
  the top of the frame stays clear.
- Export a WebP alongside at quality 82. A 4K PNG is 8–15 MB and that is too
  much to ship over the network; the WebP will land near 400–700 KB and be
  indistinguishable behind fog. **Keep the PNG as the master**, ship the WebP.

**Composition safe zone.** The game supports landscape phones (about 19.5:9) as
well as 16:9, and it covers-and-crops, so **the left and right 12% may be cut
off**. Keep anything you actually want seen inside the middle 76%. Nothing
important in the corners.

**Where the board sits.** The camera looks down at the play surface from above
and slightly behind. The **bottom 45% of the frame will be almost entirely
hidden** behind the board and the player's hand. Put your detail in the **upper
half** — that is the part that reads as the location. A horizon around 55–60%
down the frame works well.

**Folder:** `public/assets/boards/`

### 3.2 The common brief

> [house style] A wide cinematic environment backdrop for a card game battle
> arena, viewed from slightly above eye level looking out at the space. Empty
> foreground — no characters, no people, no creatures, no furniture in the lower
> half, because a game board sits there. The horizon sits around 58% down the
> frame. Deep atmospheric haze and volumetric light, strong depth layering
> between foreground silhouettes, midground structure and a glowing distance.
> The lower third fades to near-black #05030b so it can blend into the board.
> Slightly desaturated overall so bright interface elements stay legible on top.
> Painterly and stylised, not photoreal. 16:9 ultra-wide composition. No text,
> no signage, no logos, no letters, no numbers, no user interface, no
> characters, no watermark.

### 3.3 The twelve

| File | Board | Add to the common brief |
|---|---|---|
| `default.png` | **The Feed** — the neutral arena | An infinite dark void hung with hundreds of floating translucent rectangular screens at varying depths and angles, each glowing a soft blank violet, drifting slowly. Faint grid floor dissolving into fog. Cool violet #b56cff and cyan #52c8ff. The most restrained of the twelve — it is the fallback and must never distract. |
| `neon-idols.png` | **The Main Stage** | A vast concert stage seen from the performer's side looking out at an ocean of raised glowsticks in the dark, banks of moving spotlights slicing overhead through haze, mirrored floor. Hot pink #ff5fa2 and white. Euphoric, blinding, enormous. |
| `gothic-royalty.png` | **The Eternal Crypt** | A cathedral-scale mausoleum of black marble, ribbed vaults vanishing upward, hundreds of candles on iron stands, stained glass throwing wine-red light, drifting dust. Deep plum #8b3a62 and cold silver. Reverent and airless. |
| `viral-influencers.png` | **Trending Now** | A canyon of vertical phone-screen billboards stacked into skyscrapers, all scrolling upward, ring lights blazing at every level, confetti of notification hearts falling through the air. Orange #ff8a3d and hot white. Overwhelming, too bright, exhausting. |
| `corporate-creators.png` | **The Boardroom Floor** | A glass-walled executive floor at night, high above a city, a vast polished conference table receding, floor-to-ceiling windows with a cold blue skyline beyond, one recessed light strip along each wall. Corporate blue #4d8fd6 and grey. Immaculate, silent, expensive. |
| `digital-demons.png` | **The Corrupted Kernel** | A cathedral interior built out of failing computer hardware — server racks as pillars, cabling as vaulting — the whole scene tearing into datamosh artefacts and scan-line glitches toward the edges, a red error-glow bleeding from the depths. Blood red #d92b4b and black. Wrong, and getting worse. |
| `cosplay-champions.png` | **The Convention Hall** | An enormous convention centre floor at golden hour, banners hanging from a distant girder ceiling, rows of empty craft tables receding into haze, a runway stage lit in the middle distance. Violet #c77dff and warm amber. Busy, joyful, slightly chaotic. |
| `afterparty-crew.png` | **3 A.M.** | A rooftop after a party, string lights sagging between poles, tipped furniture silhouettes at the edges, a city glittering below, the first grey of dawn just touching the horizon behind neon signage. Warm amber #ffb347 against cold blue dawn. Intimate and worn out. |
| `touch-grass-order.png` | **The Clearing** | A sunlit forest clearing seen through a break in the canopy, god-rays through leaves, a still pond, moss-covered standing stones in a rough circle, motes of pollen in the air. Green #6cbf5a and warm gold. Calm — deliberately the only peaceful board of the twelve. |
| `algorithm-syndicate.png` | **The Recommendation Engine** | The inside of a vast machine intelligence: concentric rings of glowing decision-tree nodes receding into infinite depth, thin data-threads connecting them, everything rotating slowly around a single unlit centre. Cyan #35d0d8 and black. Cold, mathematical, watching. |
| `meme-collective.png` | **The Repost Pit** | A dim basement arcade where every surface is plastered in layers of overlapping flyers and stickers, CRT monitors stacked into walls all showing the same flickering image slightly out of sync, a single swinging bare bulb. Acid yellow #f2d541 and grime. Cheap, warm, funny. |
| `boss.png` | **The Signal** | A featureless black void with one colossal structure at the centre distance — a monolithic broadcast tower or antenna — pouring a vertical column of white light upward, the air around it distorted into interference rings. Near-monochrome, white on black, one thread of magenta #ff5fa2. Should feel like a different game to the other eleven. |

---

## 4. Music and ambience — 17 tracks

**This is the section that works with zero code from me.** The manifest at
`data/audio-manifest.json` already declares all 17 of these slots, every one
currently silent. Drop a file in and point the slot at it.

### 4.1 Format and delivery

- **MP3, 192 kbps, 44.1 kHz, stereo.** MP3 rather than OGG purely for universal
  browser decoding — the game decodes through the Web Audio API, and MP3 is the
  one format that never needs a fallback.
- **Folder:** `public/assets/audio/music/` and `public/assets/audio/ambient/`
- **Wiring:** in `data/audio-manifest.json`, change the slot from `null` to the
  path relative to `assets/audio`, e.g. `"music.menu": "music/menu.mp3"`. I can
  do this pass in one go once files exist — just tell me.
- **Everything loops.** Ask Stable Audio for a seamless loop and check the
  join by playing it twice in a row. Battle music that clicks every 90 seconds
  is worse than silence.
- Suggested lengths are in the table. Longer is better for battle themes —
  matches average **7.6 turns** and run 2–4 minutes, so a 90-second loop will be
  heard twice.

### 4.2 The prompt shape Stable Audio wants

Stable Audio responds to **genre, instrumentation, BPM, mood, production** in
roughly that order, and it does better with concrete instrument names than with
adjectives. Every prompt below is written that way. Add the duration in the
tool's own field rather than in the text.

Useful suffix for all of them: *seamless loop, no vocals, no speech, clean
mix, no sudden ending.*

### 4.3 The tracks

| Slot | File | Length | Prompt |
|---|---|---|---|
| `music.menu` | `music/menu.mp3` | 2:30 | Downtempo synthwave, 90 BPM. Warm analogue pad swells, slow arpeggiated bass, sparse gated electric piano, brushed electronic percussion entering after 30 seconds. Nocturnal, patient, a little melancholy — the feeling of a city seen from a window at 2 a.m. Wide reverb, tape saturation. |
| `music.battle.default` | `music/battle-default.mp3` | 2:00 | Mid-tempo electronic battle theme, 110 BPM. Pulsing sawtooth bassline, tight punchy drum machine, staccato synth stabs on the offbeat, a simple four-note motif repeating. Tense but neutral — driving without being aggressive. Restrained; it plays more than any other track. |
| `music.battle.neon-idols` | `music/battle-neon-idols.mp3` | 2:00 | Euphoric J-pop-inflected electro, 128 BPM. Bright supersaw lead, sidechained four-on-the-floor kick, glittering bell arpeggios, huge stadium clap on the backbeat, a soaring rising motif. Triumphant and relentlessly upbeat. Loud, glossy, maximalist. |
| `music.battle.gothic-royalty` | `music/battle-gothic-royalty.mp3` | 2:00 | Gothic symphonic electronica, 88 BPM. Pipe organ and low cello ostinato, distant choral pad without words, tolling bell, slow tribal drum. Solemn, funereal, grand. Cathedral reverb, deep low end. |
| `music.battle.viral-influencers` | `music/battle-viral-influencers.mp3` | 2:00 | Hyperpop-adjacent electronic, 145 BPM. Pitch-bent detuned lead, rapid trap hi-hat rolls, distorted 808 bass, chopped stutter edits and abrupt filter sweeps. Frantic, overstimulating, slightly obnoxious on purpose. Bright and clipped. |
| `music.battle.corporate-creators` | `music/battle-corporate-creators.mp3` | 2:00 | Cold corporate minimal techno, 120 BPM. Clean sine bass, precise closed hi-hats, sterile marimba-like plucks in a repeating sequence, a single sustained string pad. Efficient, inhuman, unhurried. Very clean mix, almost clinical. |
| `music.battle.digital-demons` | `music/battle-digital-demons.mp3` | 2:00 | Industrial glitch metal electronica, 140 BPM. Distorted bass growl, breakcore drum edits, granular stutter artefacts, detuned dissonant lead, bursts of white noise. Menacing and unstable, like a system failing. Heavily processed, aggressive. |
| `music.battle.cosplay-champions` | `music/battle-cosplay-champions.mp3` | 2:00 | Heroic orchestral-electronic hybrid, 124 BPM. Bold brass fanfare motif, driving taiko and snare, plucked strings, bright synth counter-melody. Adventurous, warm, celebratory. Cinematic and full. |
| `music.battle.afterparty-crew` | `music/battle-afterparty-crew.mp3` | 2:00 | Deep house at 118 BPM, late-night. Rolling sub bass, filtered disco guitar loop, soft Rhodes chords, shuffling brushed hats, distant crowd-noise texture low in the mix. Woozy, warm, tired but still going. Hazy and reverb-soaked. |
| `music.battle.touch-grass-order` | `music/battle-touch-grass-order.mp3` | 2:00 | Organic folktronica, 100 BPM. Acoustic guitar fingerpicking, hand percussion, wooden flute, soft analogue pad, field-recording birdsong texture. Gentle, grounded, unhurried — the calmest battle theme. Natural and open. |
| `music.battle.algorithm-syndicate` | `music/battle-algorithm-syndicate.mp3` | 2:00 | Cerebral IDM, 112 BPM. Intricate skittering programmed percussion, cold FM bell tones, a slowly evolving modular sequence, deep sub pulse. Calculating and precise, quietly threatening. Crisp, digital, spacious. |
| `music.battle.meme-collective` | `music/battle-meme-collective.mp3` | 2:00 | Chiptune-funk hybrid, 132 BPM. Square-wave lead, slap bass, cheap drum machine, a comically catchy repeating hook that returns slightly wrong each time. Playful, scrappy, deliberately lo-fi. Bitcrushed and bright. |
| `music.victory` | `music/victory.mp3` | 0:12 | Short triumphant electronic sting. Rising supersaw fanfare into a bright major chord, shimmering bell tail, single impact hit. Celebratory, clean resolution. One-shot, ends fully. |
| `music.defeat` | `music/defeat.mp3` | 0:12 | Short deflating electronic sting. Descending detuned pad, a low soft thud, one lingering minor chord decaying into silence. Disappointed, not tragic. One-shot, ends fully. |
| `music.packOpening` | `music/pack-opening.mp3` | 0:20 | Anticipatory electronic build. Rising filtered noise sweep, accelerating ticking pulse, shimmering arpeggio climbing, ending on a bright sustained chord with a sparkle tail. Excited, expectant. One-shot. |
| `ambient.menu` | `ambient/menu.mp3` | 3:00 | Ambient texture bed, no beat. Slow-moving analogue drones, distant filtered city hum, occasional soft synthetic chimes. Barely-there, atmospheric, non-melodic. Very quiet dynamics, sits under music. |
| `ambient.battle` | `ambient/battle.mp3` | 3:00 | Ambient tension bed, no beat. Low sustained drone, faint electrical crackle, distant indistinct crowd murmur, occasional metallic resonance. Non-melodic, unobtrusive. Sits under the battle music without competing. |

**Note on the two ambience beds:** these play *underneath* the music on a
separate channel. Keep them nearly featureless — anything with a melody or a
pulse will fight the track on top of it.

---

## 5. What I build once the files exist

For honesty, and so you know what is waiting on me rather than on you:

1. **Logo** — swap the inline SVG in `index.html` for real icon links; generate
   the six downscales and the `.ico` from your master; add the wordmark to the
   main menu. *Small.*
2. **Audio** — point the 17 manifest slots at the files. *Trivial; the system
   was built for it.*
3. **Icon loader** — a shared loader in the style of `artLoader.ts`, plus
   swapping the four currency glyphs for images and switching the card renderer
   from procedural currents and crests to loaded ones, keeping the procedural
   versions as the fallback so a missing file degrades instead of breaking.
   *Medium — the card renderer is the delicate part.*
4. **Board backdrops** — a backdrop layer behind the 3D scene, board selection
   by the opponent's faction, and preloading so it does not pop in mid-match.
   *Medium.*
5. **`verify:art` extension** — teach it about icons, boards and audio, so the
   same "does it bind, is it the right size, does a browser decode it" check
   covers these too. Right now it only knows about card art, and a mis-sized
   board would ship silently. *Small, and worth doing first.*

---

## 6. Summary of counts

| Category | Count | Size | Folder |
|---|---|---|---|
| Logo master + wordmark | 2 | 2048² / 3072×1024 | `public/assets/brand/` |
| Currency icons | 4 | 512² | `public/assets/icons/currency/` |
| Current icons | 8 | 512² | `public/assets/icons/current/` |
| Faction crests | 11 | 512² | `public/assets/icons/crest/` |
| Confluence icons | 9 | 512² | `public/assets/icons/confluence/` |
| UI icons | 8 | 512² | `public/assets/icons/ui/` |
| Board backgrounds | 12 | 3840×2160 | `public/assets/boards/` |
| Music and ambience | 17 | MP3 192 kbps | `public/assets/audio/music/`, `/ambient/` |
| **Total** | **71** | | |

Remaining card art, for reference: **186 of 296** unpainted, six factions
outstanding — Neutral (19), Meme Collective (33), Touch-Grass Order (33),
Algorithm Syndicate (32), Afterparty Crew (23), Cosplay Champions (23), Digital
Demons (18 of 23 left).
