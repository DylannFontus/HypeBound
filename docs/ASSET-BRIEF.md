# HYPEBOUND — asset brief

Everything that still needs a hand-made asset, what it should look like, what to
call the file, and where to put it.

Written 30 July 2026, against 110/296 cards painted and four factions complete.

---

## 0. Read this first

### 0.1 What is wired up, and what is not

This matters more than anything else in the document. **Everything below is now
drop-in.** A file placed at the right path with the right name is used by the
game with no code change and no deploy — and a file that is missing, misspelled
or the wrong size never breaks anything, it just falls back to what the game
drew before.

That was not true when this brief was written. The wiring pass is done.

| Category | Wired? | What happens when you add a file |
|---|---|---|
| **Card art** | **Yes** | Picked up automatically. . |
| **Logo / favicon** | **Yes** |  points at real icons. Regenerate the sizes and the  from the master with 
HYPEBOUND brand icons — from a 2048x2048 master

   favicon-16.png           16px      713 bytes   browser tab
   favicon-32.png           32px     1690 bytes   browser tab, retina
   favicon-48.png           48px     3176 bytes   the .ico, and Windows
   apple-touch-icon.png    180px    26516 bytes   iOS home screen
   icon-192.png            192px    29233 bytes   Android and PWA
   icon-512.png            512px   171161 bytes   PWA splash
   favicon.ico            16/32/48px     5633 bytes   legacy, and the .exe icon later

Done. Re-run this whenever the master changes.. |
| **Wordmark** | **Yes** | Centred in the lobby header; hidden below 900px and when absent. |
| **Currency icons** | **Yes** | The glyph () stays in the markup holding its space and the picture is painted over it. No screen changed. |
| **Current icons and faction crests** | **Yes** | Drawn on every card, preferring the file and falling back to the procedural shape. |
| **Battle board backgrounds** | **Yes** | Drawn as a quad inside the 3D scene, chosen by the opponent'''s faction, falling back to  and then to the flat void. |
| **Music, ambience and sfx** | **Yes** | All 59 slots in  already name a file. Dropping one in at that path starts playing it. |
| Confluence and interface icons | Loaded, **nowhere to show them** | They pass every check and the loader has them — but the game has no Confluence panel and no mission-icon slots yet. Early, not wasted. |

**One caveat that matters:** ten audio slots are wired to filenames but no code
path plays them. They are listed in §5.1, and I would rather you skip them than
spend generations on silence.

**
> hypebound@0.1.0 verify:assets
> node scripts/verify-art.mjs


HYPEBOUND assets — 115 card image(s), 54/54 declared asset(s)

1. Every image is addressed to a card that exists
   ok: no image is named after a card that is not there

2. Full-bleed at the canonical size
   ok: 115 PNG(s) at 512x680

3. A browser decodes every one of them
   FAIL: no dev server on http://localhost:5173 — start one with `npm run dev`

6. Every file in the asset folders is one the game asks for
   ok: no file is sitting in an asset folder unclaimed

7. Every audio file is one a slot points at
   ok: 15/17 pointed slot(s) have a file; 0 file(s) on disk, all reachable

Coverage: 115/296 cards painted (38.9%). The rest use procedural art.
Complete: corporate-creators, gothic-royalty, neon-idols, viral-influencers

Closest to finished: digital-demons, 18 left
   demon-clause-thirteen          legendary  Clause Thirteen, the Fine Print
   demon-legion-of-open-tabs      epic       Legion of Open Tabs
   demon-meltdown                 epic       Meltdown
   demon-forced-reformat          epic       Forced Reformat
   demon-doomscroll-fiend         rare       Doomscroll Fiend
   demon-fan-curve-gremlin        rare       Fan-Curve Gremlin
   demon-render-farm-wraith       rare       Render Farm Wraith
   demon-eula-notary              rare       EULA Notary
   demon-small-print              rare       Small Print
   demon-rig-that-screams         rare       The Rig That Screams
   demon-terms-of-service-update  rare       Terms of Service Update
   demon-thermal-imp              common     Thermal Imp
   … and 6 more

Declared assets (docs/ASSET-BRIEF.md):
   boards                12/12  complete
   brand                  2/2  complete
   icons/confluence       9/9  complete
   icons/crest           11/11  complete
   icons/currency         4/4  complete
   icons/current          8/8  complete
   icons/ui               8/8  complete

FAIL — 1 problem(s)** checks all of it — declared-versus-present, exact
sizes, a real browser decode, that a present interface icon is actually in use,
and that no audio file sits unreachable by any slot.

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

## 5. Sound effects — 42 one-shots

`data/audio-manifest.json` declares 42 sfx slots, every one silent. Same wiring
as the music: drop a file in, point the slot at it, no code change.

### 5.1 Seven of these are unreachable — and so are three of the music tracks

Auditing the call sites for this section turned up slots that **nothing in the
game plays**. A file dropped into one of them sits there in silence, and nothing
reports it. Generate these last, or skip them until I have wired them:

| Slot | Why nothing plays it |
|---|---|
| `sfx.ui.navigate` | No screen uses it; navigation plays `sfx.ui.click`. |
| `sfx.card.burn` | Nothing burns a card in the presenter yet. |
| `sfx.card.set` | Face-down sets are not animated separately. |
| `sfx.status.expire` | The presenter announces `status.apply` but never expiry. |
| `sfx.turn.warning` | The turn rope has no audio hook. |
| `sfx.pack.open` | The Merch Drops screen plays no audio at all. |
| `sfx.pack.rareReveal` | Same screen, same reason. |

**Correction to §4.** `music.packOpening`, `ambient.menu` and `ambient.battle`
are in exactly the same position — declared, listed in this brief, and played by
nothing. The other 14 music tracks are reachable and worth making now. I should
have checked that before writing §4 rather than after.

Wiring all ten is small, and I can do it whenever you want. I would rather say
so than let you spend generations on silence.

### 5.2 Format — FLAC

**FLAC, 44.1 kHz.** Of the three formats Stable Audio will export, this is the
one that works, and the reason is specific to short sounds rather than to
quality.

**MP3 is the one to avoid here.** Every MP3 encoder prepends padding — usually
10–25 ms of silence at the head of the file. On a two-minute music track that is
invisible; on a 60 ms click it is a tenth of the sound's length arriving as
latency, and `decodeAudioData` does not reliably honour the gapless tags that
would let a player trim it. The interface would feel mushy and nothing would
look wrong.

**FLAC has no such padding.** It is lossless with exact sample counts, so the
first sample of the file is the first sample of the sound. Verified in this
project's own target browser: `canPlayType("audio/flac")` returns `probably`,
which is the strongest answer that call ever gives. Firefox and Safari 11+
decode it too.

**Opus would also work** — its pre-skip is recorded in the container and
decoders trim it correctly — but Safari's support for Opus in Ogg has been
patchy, and the file-size advantage that makes Opus attractive is worth almost
nothing for sounds this short. FLAC is the safer pick at no real cost.

Everything else stays as it was:

- **Mono for the interface group, stereo for everything else.** UI sounds should
  feel like they come from the interface, not from somewhere in the room.
- **Folder:** `public/assets/audio/sfx/<group>/<name>.flac`
- Normalise peaks to about **−3 dBFS**, then pull the interface group down
  roughly **6 dB** relative to combat. A click as loud as a spell is a click that
  makes people mute the game.
- All 42 slots in `data/audio-manifest.json` already point at these exact
  `.flac` paths, so a file dropped in plays with no code change.

*(The music tracks in §4 stay MP3 — they are minutes long, the padding is
inaudible, and 192 kbps is a third the size of lossless.)*

### 5.3 Getting one-shots out of a music model

Stable Audio 3 Medium is built for music and it shows. It is genuinely good at
the textural half of this list — whooshes, impacts, risers, elemental bursts —
and it will fight you on short dry transients, where it wants to add reverb, a
tail, and sometimes a key.

What works:

- **Ask for more than you need, then trim.** Generate 3–4 seconds and cut to the
  transient. Asking for 60 ms directly gives you 60 ms of nothing.
- **End every prompt with this.** It is the single biggest quality lever:
  *"Dry close-mic one-shot, no reverb, no echo, no music, no melody, no rhythm,
  no loop, silence after the sound."*
- **Fade the last 20 ms to zero.** Generated audio rarely ends on a true zero
  crossing, and the click that causes is worse than the sound itself.
- **Do not fight it over the eight interface sounds.** If `sfx.ui.click` will not
  come out clean in a few attempts, leave it. The game already synthesises 28
  accessibility cues in code (`data/audio-cues.json`, rendered by
  `src/audio/cues.ts`), and a synthesised tick is honestly the better tool for a
  60 ms interface sound. Those cues are a **separate** system that stays either
  way — they are not a fallback for these slots and do not fill them.

### 5.4 Interface — 8

Small, dry, synthetic. These play more often than everything else combined, so
err quiet and err short.

| Slot | File | Length | Prompt |
|---|---|---|---|
| `sfx.ui.click` | `sfx/ui/click.flac` | 60 ms | A single short dry synthetic UI click. A tight pitched tick with a glassy body and no tail, like a small hard button. |
| `sfx.ui.hover` | `sfx/ui/hover.flac` | 40 ms | A very short airy UI blip, higher and much quieter than a click. One soft sine tick with a breath of filtered noise. |
| `sfx.ui.back` | `sfx/ui/back.flac` | 90 ms | A short descending two-tone UI blip, a small downward interval, soft and rounded. |
| `sfx.ui.error` | `sfx/ui/error.flac` | 120 ms | A short dull refusal buzz. A low detuned double-tick, flat and blunt — discouraging without being harsh or alarming. |
| `sfx.ui.navigate` ⚠ | `sfx/ui/navigate.flac` | 90 ms | A short lateral swish, a tiny filtered noise sweep resolving into a soft tick. |
| `sfx.ui.toggle` | `sfx/ui/toggle.flac` | 80 ms | A small mechanical switch. A crisp two-part snap — on, then settle. |
| `sfx.ui.confirm` | `sfx/ui/confirm.flac` | 220 ms | A short bright rising two-note chime, clean and affirmative, with a small bell timbre. |
| `sfx.ui.reward` | `sfx/ui/reward.flac` | 700 ms | A sparkling ascending arpeggio of small bell tones with a light shimmering decay. Generous and pleased. |

### 5.5 Cards — 11

| Slot | File | Length | Prompt |
|---|---|---|---|
| `sfx.card.draw` | `sfx/card/draw.flac` | 250 ms | A single playing card sliding off the top of a deck. A short paper friction sweep ending in a soft snap. |
| `sfx.card.burn` ⚠ | `sfx/card/burn.flac` | 500 ms | A card catching fire. A quick paper crumple with a small flame whoosh and a brief ember crackle. |
| `sfx.card.set` ⚠ | `sfx/card/set.flac` | 180 ms | A card placed face-down on a table. A soft muted slap on felt, close and dry. |

**Playing a card, by Current.** Eight sounds, one per element, each the moment of
commitment. They should be siblings: same length, same weight, different
material.

| Slot | File | Length | Prompt |
|---|---|---|---|
| `sfx.card.play.cinder` | `sfx/card/play-cinder.flac` | 600 ms | A burst of flame igniting. A fast whoosh opening into a crackling ember tail. |
| `sfx.card.play.tide` | `sfx/card/play-tide.flac` | 650 ms | A wave breaking. A rush of water into a splash, with a draining pull behind it. |
| `sfx.card.play.root` | `sfx/card/play-root.flac` | 600 ms | Wood and earth. A deep creaking growth, soil shifting, and a vine snapping taut. |
| `sfx.card.play.gale` | `sfx/card/play-gale.flac` | 550 ms | A sharp gust of wind passing quickly. A filtered air whoosh with a thin whistle at its peak. |
| `sfx.card.play.pulse` | `sfx/card/play-pulse.flac` | 500 ms | An electric discharge. A crackling arc with a bright zap and a short buzzing tail. |
| `sfx.card.play.halo` | `sfx/card/play-halo.flac` | 700 ms | A shaft of light opening. A bright swelling shimmer with a soft wordless choral bloom. |
| `sfx.card.play.veil` | `sfx/card/play-veil.flac` | 650 ms | Shadow gathering. A low reversed whisper swelling into a muffled thud that eats the air. |
| `sfx.card.play.prism` | `sfx/card/play-prism.flac` | 600 ms | Crystal refraction. A glass chime splitting into several pitched shards that scatter apart. |

### 5.6 Combat — 3

| Slot | File | Length | Prompt |
|---|---|---|---|
| `sfx.combat.attack` | `sfx/combat/attack.flac` | 300 ms | A committed swing. A fast whoosh with a metallic edge and no impact at the end — the hit is a separate sound. |
| `sfx.combat.impact` | `sfx/combat/impact.flac` | 350 ms | A heavy landed hit. A thick percussive thud with a crunchy transient and a tight low body. |
| `sfx.combat.defeat` | `sfx/combat/defeat.flac` | 800 ms | A character breaking apart. A crumbling collapse falling away into a low descending thud. |

### 5.7 Statuses — 2

| Slot | File | Length | Prompt |
|---|---|---|---|
| `sfx.status.apply` | `sfx/status/apply.flac` | 300 ms | A condition latching on. A short metallic clasp with a small magical shimmer over it. |
| `sfx.status.expire` ⚠ | `sfx/status/expire.flac` | 400 ms | A condition lifting. A soft reversed shimmer releasing and fading away. |

### 5.8 Confluences — 9

The biggest sounds in the game: two Currents combining. Longer and wider than
anything else here, and each should audibly contain **both** of its parents.

| Slot | File | Length | Prompt |
|---|---|---|---|
| `sfx.confluence.steamveil` | `sfx/confluence/steamveil.flac` | 1.2 s | Fire meeting water. A violent hiss of steam erupting, then softening into a broad concealing veil of vapour. |
| `sfx.confluence.bloom` | `sfx/confluence/bloom.flac` | 1.1 s | Water and growth. A wet surge blossoming open into rising bell chimes and unfurling leaves. |
| `sfx.confluence.sandstorm` | `sfx/confluence/sandstorm.flac` | 1.3 s | Earth and wind. A driving abrasive roar of grit and torn leaves sweeping past. Harsh and dry. |
| `sfx.confluence.tempest` | `sfx/confluence/tempest.flac` | 1.2 s | Wind and lightning. A rising gust cracked open by a sharp thunderclap, with a rolling tail. |
| `sfx.confluence.starflare` | `sfx/confluence/starflare.flac` | 1.2 s | Energy and fire. A charging electrical whine collapsing inward, then a bright explosive flare outward. |
| `sfx.confluence.blackflame` | `sfx/confluence/blackflame.flac` | 1.2 s | Fire and shadow. An inverted whoosh — a flame that pulls sound inward and swallows it rather than roaring. |
| `sfx.confluence.sanctuary` | `sfx/confluence/sanctuary.flac` | 1.3 s | Growth and light. A warm ascending pad closing into a protective bell, like a dome sealing over. |
| `sfx.confluence.eclipse` | `sfx/confluence/eclipse.flac` | 1.4 s | Light and shadow. A bright ringing tone collapsing into a hollow drone as everything is smothered. |
| `sfx.confluence.refraction` | `sfx/confluence/refraction.flac` | 1.1 s | A prism splitting a beam. One pure tone fanning out into many pitches at once, glassy and bright. |

### 5.9 Match flow — 7

| Slot | File | Length | Prompt |
|---|---|---|---|
| `sfx.resonance` | `sfx/match/resonance.flac` | 800 ms | Two forces aligning. A pure ringing tone with a slow beating harmonic swell as they lock together. |
| `sfx.obsession.gain` | `sfx/match/obsession-gain.flac` | 250 ms | A meter ticking upward. A short bright pitched pip with a small pressure swell behind it. |
| `sfx.obsession.full` | `sfx/match/obsession-full.flac` | 1.2 s | A meter reaching maximum. A rising charge resolving into a resonant bell with a low boom underneath. |
| `sfx.turn.start` | `sfx/match/turn-start.flac` | 500 ms | Your turn beginning. A clean two-note rising chime over a soft low impact. Attentive, not celebratory. |
| `sfx.turn.warning` ⚠ | `sfx/match/turn-warning.flac` | 1.5 s | Time running out. An urgent repeating tick, tightening and rising in tension. Seamless loop. |
| `sfx.victory` | `sfx/match/victory.flac` | 1.5 s | A triumphant sting. Bright brass and a bell hit together, with a shimmering decay. |
| `sfx.defeat` | `sfx/match/defeat.flac` | 1.5 s | A deflating sting. A descending detuned tone falling into a dull thud. Disappointed, not tragic. |

### 5.10 Packs — 2

| Slot | File | Length | Prompt |
|---|---|---|---|
| `sfx.pack.open` ⚠ | `sfx/pack/open.flac` | 700 ms | Foil tearing open. A crisp plastic rip releasing into a bright sparkle. |
| `sfx.pack.rareReveal` ⚠ | `sfx/pack/rare-reveal.flac` | 1.8 s | Something rare revealing itself. A rising charge into a radiant bell chime with a long shimmering tail. A reward, not a jumpscare. |

---

## 6. What is wired, and what is not

Updated 30 July 2026, after a wiring pass. Everything in the first list works
today — drop a file in the right place with the right name and the game uses it
with no code change and no deploy.

**Done, and drop-in from here:**

1. **Card art** — always was. `public/assets/art/<card-id>.png`.
2. **The logo.** `index.html` points at real icons. Regenerate every size from
   the master with `node scripts/make-brand-icons.mjs`, which also builds the
   `.ico` that will become the `.exe` icon.
3. **The wordmark**, centred in the lobby header, hidden below 900px and hidden
   entirely when the file is absent.
4. **Currency icons.** The glyph stays in the markup holding its space and the
   picture is painted over it; no screen changed, and with no file the glyph is
   simply what you see.
5. **Currents and faction crests on cards.** Painted if present, the procedural
   drawing if not. Warmed at boot so they are decoded before any card renders.
6. **Board backdrops**, chosen by the opponent's faction, falling back to
   `default` and then to the flat void.
7. **Music and sfx**, through `data/audio-manifest.json`. All 17 music slots and
   all 42 sfx slots point at their filenames already, so a file appearing at that
   path starts playing. A slot pointing at a file that does not exist logs one
   line and stays silent — that is the designed behaviour, not a warning to fix.
8. **`npm run verify:assets`** covers all of it: declared-versus-present, exact
   sizes, a browser decode of every image, a check that a present interface icon
   is genuinely in use, and a check that no audio file sits in the folder
   unreachable by any slot.

**Still on me:**

1. **Ten unreachable slots** — the seven sfx in §5.1 plus `music.packOpening`,
   `ambient.menu` and `ambient.battle`. Declared and wired to filenames, but no
   code path plays them. Small work; say the word.
2. **Confluence and interface icons have nowhere to appear.** All 17 exist, pass
   every check, and are loaded — but the game has no Confluence panel and no
   mission-icon slots to put them in. They are not wasted, they are early.
3. **A Merch Drops opening sequence.** Three of the unreachable slots
   (`sfx.pack.open`, `sfx.pack.rareReveal`, `music.packOpening`) all wait on the
   same thing: that screen currently plays no audio at all.

---

## 7. Summary of counts

| Category | Count | Format | Folder |
|---|---|---|---|
| Logo master + wordmark | 2 | 2048² / 3072×1024 PNG | `public/assets/brand/` |
| Currency icons | 4 | 512² PNG | `public/assets/icons/currency/` |
| Current icons | 8 | 512² PNG | `public/assets/icons/current/` |
| Faction crests | 11 | 512² PNG | `public/assets/icons/crest/` |
| Confluence icons | 9 | 512² PNG | `public/assets/icons/confluence/` |
| Interface icons | 8 | 512² PNG | `public/assets/icons/ui/` |
| Board backgrounds | 12 | 3840×2160 PNG → WebP | `public/assets/boards/` |
| Music and ambience | 17 | MP3 192 kbps | `public/assets/audio/music/`, `/ambient/` |
| Sound effects | 42 | FLAC 44.1 kHz | `public/assets/audio/sfx/` |
| **Total** | **113** | | |

**Arrived so far: 42 of 113** — the two brand assets and all 40 icons. Still to
make: 12 boards, 17 music tracks, 42 sound effects.

Remaining card art, for reference: **181 of 296** unpainted. Complete: Neon
Idols, Gothic Royalty, Viral Influencers, Corporate Creators. Outstanding —
Meme Collective (33), Touch-Grass Order (33), Algorithm Syndicate (32),
Afterparty Crew (23), Cosplay Champions (23), Neutral (19), Digital Demons (18
of 23 left).
