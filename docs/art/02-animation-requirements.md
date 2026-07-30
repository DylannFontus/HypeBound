# Animation Requirements

> Implementation lives in [`src/ui/battle/presenter.ts`](../../src/ui/battle/presenter.ts)
> (pacing), [`src/ui/battle/vfx.ts`](../../src/ui/battle/vfx.ts) (particles) and
> the CSS keyframes in [`src/ui/theme/battle.css`](../../src/ui/theme/battle.css).
> Durations are declared in one place — the `TIMING` table in `presenter.ts`.

## 1. Principles

1. **The engine never waits on animation.** By the time anything moves, the
   engine has already resolved the whole action and handed the presenter a list
   of `EngineEvent`s. The presenter owns pacing alone, so it is always free to
   compress, skip or fast-forward without any risk to game state.
2. **Exciting but fast.** A full turn of animation should never exceed a few
   seconds. Every budget below is a ceiling, not a target.
3. **Shorten what has been seen.** With *Shorten seen animations* on (default),
   an effect the player has already watched this session replays at 55% length.
4. **Skippable.** Clicking anywhere during a sequence calls
   `presenter.requestSkip()` and collapses the remainder to zero.
5. **Reduced motion is a first-class path, not a disable switch.** Every effect
   has a defined reduced-motion behaviour that still communicates what happened.

## 2. Speed settings

| Setting | Multiplier | Notes |
|---|---|---|
| Full | ×1.0 | Default |
| Fast | ×0.55 | Everything plays, just quicker |
| Instant | ×0.01 | Effectively immediate; state changes still read clearly |
| Reduced motion | ×0.25 | Forced regardless of the speed setting |

Implemented by `animationScale()` in [`src/save/settings.ts`](../../src/save/settings.ts).

## 3. Duration budgets

| Event | Budget | Behaviour | Reduced-motion variant |
|---|---|---|---|
| Card drawn | 60 ms | Card flies from the deck corner into the fan | Card appears in place |
| Card played | 420 ms (≤600 ms hard cap) | Card lifts, moves to its slot, Current-tinted flash | Cross-fade in place |
| Character summoned | 300 ms | Scale pop from 0.4→1, ground ring, 20 rising motes | Fade in, no particles |
| Attack declared | 380 ms | Attacker lunges ~0.7 units toward the target and returns | No lunge; brief highlight |
| Damage dealt | 240 ms | Impact burst, floating number, screen shake at ≥4 damage | Number only, no shake |
| Healing | 260 ms | Rising green motes, floating `+N` | Number only |
| Status applied | 200 ms | Expanding ring in the status polarity colour | Icon appears |
| Character defeated | 380 ms | Dark particle scatter, card fades | Card fades |
| Confluence | 1100 ms (≤1200 ms cap) | Two Current colours spiral inward, white flash, name toast | Screen tint + toast |
| Perfect Resonance | 1400 ms (≤1500 ms cap) | Three expanding rings + column of motes, full-board tint | Tint + toast |
| Full Fixation | 400 ms | Gold screen flash, banner toast | Toast only |
| Trigger queued | 180 ms | Chip slides into the trigger rail, then out | Chip appears/disappears |
| Turn banner | 700 ms | Scale-in banner, hold, fade | Fade in/out |
| Turn timer rope | — | Ring turns red, countdown appears at 15 s | Identical (not motion) |
| Victory / Defeat | ≤4 s, skippable | Title scales in from blur, subtitle and buttons stagger | Straight fade |
| Mulligan | 300 ms per card | Cards deal in with stagger | All appear at once |
| Pack opening | ≤5 s, skippable | *(designed, not implemented)* | Immediate reveal |

## 4. Per-Current visual language

Each Current has a consistent motion and particle signature, so a player learns
to recognise what happened peripherally.

| Current | Motion | Particles | Colour |
|---|---|---|---|
| **Cinder** | Sharp attack, quick decay | Rising embers, heat shimmer | Orange → white |
| **Tide** | Smooth ease-in-out, overshoot | Droplets, horizontal wave bands | Deep blue → cyan |
| **Root** | Slow, heavy, settles with weight | Stone chips, growing stems | Green → pale gold |
| **Gale** | Fast, overshoots and snaps back | Speed lines, ribbons, feathers | Turquoise → white |
| **Pulse** | Staccato, stepped, strobing | Circuit traces, sparks | Violet → white |
| **Halo** | Gentle bloom, symmetrical | Radiating rays, soft glow | White-gold |
| **Veil** | Reverse-easing, unstable jitter | Fracture cracks, shadow wisps | Black-violet |
| **Prism** | Combines two random Current motions | Rainbow refraction bands | Full spectrum |

## 5. Performance rules

- Particles come from a **pooled sprite system** — no per-effect allocation.
- Per-tier caps: high 420, medium 200, low 70 live particles
  (`QUALITY_PRESETS` in [`scene.ts`](../../src/ui/battle/scene.ts)).
- Reduced motion sets the effective budget to **0**; set-pieces fall back to
  a screen tint plus a toast.
- Bloom is high/medium only and is lazily imported, so the low tier never pays
  the download or the frame cost.
- Screen shake is opt-out (Settings → Accessibility) and only fires at ≥4 damage.
- Card textures are cached by everything that can change their appearance and
  evicted LRU at 160 entries. Re-rendering a card face is the single most
  expensive UI operation — never do it per frame.

## 6. Acceptance checklist

- [ ] No animation exceeds its budget at ×1.0 speed
- [ ] Every animation has a distinct reduced-motion variant that still reads
- [ ] Clicking mid-sequence skips the remainder without desyncing the board
- [ ] Instant speed completes a full AI turn in under a second
- [ ] No animation blocks input for longer than its stated budget
- [ ] Board state after any sequence matches the engine state exactly
- [ ] 60 fps sustained on desktop high tier, 30 fps floor on mobile low tier
