# Audio Requirements

> Implementation: [`src/audio/audio.ts`](../../src/audio/audio.ts).
> Slot map: [`data/audio-manifest.json`](../../data/audio-manifest.json).
>
> **The game runs correctly and silently with zero audio files present.** Every
> slot defaults to `null`, which is a no-op. Adding audio never requires a code
> change — drop the file in `public/assets/audio/` and point the slot at it.

---

## 1. How the system works

Sounds are addressed by **slot name**, never by file path. Code calls
`audio.play("sfx.card.play.cinder")`; the manifest decides what — if anything —
that plays.

```jsonc
// data/audio-manifest.json
"slots": {
  "music.battle.neon-idols": "music/neon-idols-battle.ogg",
  "sfx.card.play.cinder":    null      // silent until you add a file
}
```

A missing file logs one informational line and is then treated as silent
permanently. It never throws, never retries, never blocks a frame.

### Channel routing

The channel is inferred from the slot prefix:

| Prefix | Channel |
|---|---|
| `music.*` | music |
| `voice.*` | voice |
| `ambient.*` | ambient |
| `sfx.ui.*` | interface |
| everything else | battle effects |

Each channel has an independent volume slider plus a master, all persisted in
settings and applied live via `audio.applyVolumes()`.

---

## 2. Slot inventory

### Music
`music.menu` · `music.battle.default` · `music.battle.<faction>` (one per faction) ·
`music.victory` · `music.defeat` · `music.packOpening`

Battle music is selected from the player's leader faction, falling back to
`music.battle.default`.

**Dynamic intensity (designed):** append `.calm` and `.intense` to any battle
slot to supply layers. The intended driver is a 0–1 intensity value derived from
lowest leader health, total board attack, and turn number, crossfading between
layers. *Layer playback is not yet implemented — single-track playback is.*

### Ambient
`ambient.menu` · `ambient.battle` — long, quiet, seamless loops sitting under
the music bed.

### Interface
`sfx.ui.click` · `.hover` · `.back` · `.error` · `.navigate` · `.toggle`

### Cards and combat
`sfx.card.draw` · `.burn` · `.set` ·
`sfx.card.play.<current>` (all 8 Currents) ·
`sfx.combat.attack` · `.impact` · `.defeat` ·
`sfx.status.apply` · `.expire`

### Systems
`sfx.confluence.<id>` (all 9) · `sfx.resonance` ·
`sfx.obsession.gain` · `sfx.obsession.full` ·
`sfx.turn.start` · `sfx.turn.warning` ·
`sfx.victory` · `sfx.defeat` ·
`sfx.pack.open` · `sfx.pack.rareReveal`

### Leader voice lines (slot pattern)

Add per leader as `voice.<leaderCardId>.<line>` where line is one of
`intro` · `play` · `attack` · `hurt` · `win` · `lose`:

```jsonc
"voice.idols-lumi-starcall.intro": "voice/lumi/intro.ogg",
"voice.idols-lumi-starcall.win":   "voice/lumi/win.ogg",
```

Voice lines are subtitled when Settings → Accessibility → Subtitles is on.

---

## 3. Per-Current sound design

Each Current gets a recognisable sonic signature so a player can identify what
was played without looking.

| Current | Character | Reference texture |
|---|---|---|
| **Cinder** | Bright transient, fast decay | Ignition whoosh, crackle, stage pyro |
| **Tide** | Soft attack, long wet tail | Water swell, reverse reverb, filtered sweep |
| **Root** | Low, weighty, damped | Stone impact, deep wooden thud, sub |
| **Gale** | Airy, quick, pitch-rising | Whoosh, cloth snap, wind chime |
| **Pulse** | Sharp, electric, rhythmic | Arc snap, digital glitch, synth stab |
| **Halo** | Warm, harmonically rich, blooming | Choral swell, bell, shimmer riser |
| **Veil** | Reversed, detuned, unsettling | Reverse cymbal, sub drone, whisper |
| **Prism** | Layered spectrum, shifting | Crystal chime, harmonic sweep |

---

## 4. Streamer-safe mode

Some music may be licensed in ways that cause takedowns on streams. Files that
carry that risk go under a `licensed/` subdirectory:

```jsonc
"music.battle.neon-idols": "music/licensed/neon-idols-battle.ogg"
```

When Settings → Audio → *Streamer-safe music* is enabled, any slot whose path
contains `/licensed/` resolves to silence. Supply a cleared alternative under a
different path and swap the slot to make the mode transparent rather than silent.

---

## 5. Default mix

| Channel | Default |
|---|---|
| Master | 0.80 |
| Music | 0.60 |
| Voice | 0.90 |
| Interface | 0.70 |
| Battle effects | 0.80 |
| Ambient | 0.50 |

Voice sits above music so lines stay intelligible without ducking.

---

## 6. File format and loudness

- **Preferred:** Ogg Vorbis (`.ogg`) — best size/quality, universal outside Safari.
- **Fallback:** AAC (`.m4a`) for Safari/iOS.
- Sample rate 44.1 kHz. Music stereo; short SFX may be mono.
- **Loudness:** music −16 LUFS integrated · SFX −18 LUFS · voice −14 LUFS,
  true peak ≤ −1 dBTP.
- Music loops must be **seamless** — sample-accurate, no gap, no click.
- Keep individual SFX under 200 KB and music under 4 MB; everything is fetched
  on demand and decoded once.

---

## 7. Adding audio, step by step

1. Drop the file, e.g. `public/assets/audio/music/neon-idols-battle.ogg`.
2. Open `data/audio-manifest.json` and set the slot:
   `"music.battle.neon-idols": "music/neon-idols-battle.ogg"`
3. Reload. That is the whole process — no build step, no code change.

Adding a **new** slot name additionally requires a `audio.play("...")` call at
the point in code where it should fire.

Settings → Audio shows how many slots are still empty, so you can track coverage.

---

## 8. Acceptance checklist

- [ ] The game starts and plays a full match with **no** audio files present
- [ ] Every channel slider audibly and independently changes its channel
- [ ] Master scales all channels
- [ ] Music crossfades on scene change without a click or gap
- [ ] Battle music loops seamlessly through a 12-minute match
- [ ] Streamer-safe mode silences every `/licensed/` slot
- [ ] Voice lines are subtitled when subtitles are enabled
- [ ] Audio unlocks on the first user gesture (browser autoplay policy)
- [ ] No audio call ever throws or stalls a frame when a file is missing
