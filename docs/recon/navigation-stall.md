# The navigation stall

Three independent reviews have reported the same defect in different words: the
screen transitions are well choreographed and the player never sees them. This
is the measured account, written down because the file that owns it —
`src/ui/shell.ts` — was assigned to no wave-2 track, so nobody was going to fix
it.

## What was measured

Attributed with `PerformanceObserver({entryTypes:["longtask"]})` plus an rAF gap
trace, on an RTX 2060 at 1600×900 that sustains 75.2fps at rest with a worst gap
of 13.5ms:

| Leg | Long tasks | Frames in 1.6s |
|---|---|---|
| `#lobby → #play` | 116ms starting at **+1ms** | 75, 6 over 33ms |
| `#lobby → #settings` | 78 + 97 + 80 + 74 + 50ms | 82, 6 over 33ms |
| `#lobby → #collection` | 167 + 88 + **489** + 139 + 303 + 171ms ≈ **1.36s** | **7**, 5 over 33ms |

The critics' own instruments agree from the other side: rAF gaps of 175ms /
136ms / 105ms, CDP compositor gaps of 201ms / 198ms / 172ms.

The `+1ms` start is the important number. The block begins the instant the hash
changes, before anything has animated.

## Why it happens, and why the current code is not naive

`handleHash()` is deliberately ordered so that construction happens while
**nothing** is mid-animation:

```
if (veiled && outgoing) { raiseCurtain(); await twoFrames(); }
const screen = await factory(params);      // 116ms … 1.36s
if (outgoing) retire(outgoing, plan);
place(screen, …);
```

For a *veiled* (heavy) route this is correct, and the comment explains exactly
why it works: the curtain is a `translate3d` on the compositor, so once it has
been given one frame it keeps playing smoothly for the whole of the block
underneath it.

For an *unveiled* route the same paragraph is the refutation. If a
compositor-driven animation survives a blocked main thread — and the curtain
proves it does — then the **exit** animation would survive it too. Blocking
before animating protects nothing; it just means the player clicks and gets no
response at all for 116ms, which is also the "no visible feedback for 130–230ms"
the battle-motion review reported.

The reason the exit was excluded is real, though: `nav-descend-out` animates
`filter: blur()` and `brightness()` alongside transform and opacity, and a
filter does not reliably promote to the compositor. So the animation that was
supposed to cover the block is exactly the one that cannot.

## The fix

1. **Make the exit compositor-safe.** `nav-descend-out` / `nav-ascend-out` keep
   `transform` and `opacity` and lose the animated `filter`. If the parent needs
   to look recessed, apply blur and brightness as a *static* value set before the
   animation starts, not as animated properties. A static filter costs one paint;
   an animated one costs every frame and cannot composite.
2. **Then start the exit before building**, for every navigation and not only
   veiled ones — the same `raiseCurtain(); await twoFrames();` shape that already
   works, with the exit animation in place of the curtain.
3. **Chunk or defer the heavy constructors.** 1.36s for `#collection` is not a
   transition problem, it is a screen problem: 245 card canvases built
   synchronously. The collection track is already fixing the 2,499.6ms
   per-keystroke rebuild; the same virtualisation fixes this.
4. **Lower the bar for `veiled`.** Any route whose recorded `buildCost` exceeds
   ~60ms should be veiled automatically. `shell.ts` already records build cost
   for exactly this purpose (`this.buildCost.set(id, …)`) and currently only
   consults a static `heavy` flag.

## How to know it is fixed

- No long task longer than ~50ms between the hash change and the first painted
  frame of the transition.
- First visible change within 100ms of the click on every route.
- Total settle inside the 260–420ms budget from AAA-BAR §3a.
- `#lobby → #collection` draws more than 7 frames in 1.6 seconds.

## Postscript: what it actually was

Written after the wave-3 shell pass, because three of the four items above were
right about the symptom and wrong about the cause, and the fourth was actively
harmful.

**Items 1 and 2 were correct and are done.** `nav-descend-out` and the two
curtain exits no longer animate `filter`; the blur and the dim are declared on
the rule instead, identical across `-hold` and `-out` so the attribute swap has
nothing to re-rasterise. The hold already got its composited frame from
`twoFrames()`; what it did not get was a thread free of the *previous*
navigation's teardown, which ran as the first statement of `handleHash` and has
moved to just after those two frames.

**Item 4 was backwards.** Lowering `veiled`'s bar to 60ms covered four of the
five most-travelled legs, and the cover is darker than the transition: filmed at
1600×900, `lobby → play` under the late veil put a frame on the glass at 47% of
the reference mean and 24% of its 95th percentile, against 80% and 55% for the
same leg with no veil at all. It is back to 220ms and the node-count prior is
gone. Warm, at 1600×900, Play and Mastery and Settings each produce **zero**
long tasks and 118–120 frames in the following 1.6 seconds; there was nothing
to cover.

**What was really costing the 50–64ms.** Two selector shapes in §2.7 of
`transitions.css` — `.screen[data-nav] > * > *:nth-child(N)` and
`:is(…, [class*="-sheet"])` — each register a *whole-subtree* invalidation set
in Blink, the first against `data-nav` and the second against `class`. Writing
one attribute on a screen root therefore relaid its entire subtree: 23ms on the
lobby, 34ms on Missions, 42ms on the Collection. Adding a class that matches
nothing anywhere in the stylesheet cost 12–22ms, on any element, anywhere in the
game. `shell.ts::markCascade` now writes `data-cascade` and `data-rise` on the
screen's own children while the tree is still detached, and the stylesheet keys
off those; the unused-class cost is 0ms and `scripts/_w3nav_split.mjs` is the
instrument that shows it.

**And the cover, where one is still wanted, now carries the match.** The VS card
was being armed on "two consecutive on-time frames", which during a battle build
never come — measured, it first reached the glass at t≈5.2s of a 5.4s hold. It
is armed synchronously, its keyframes open at a paintable opacity rather than at
zero (an element at `opacity: 0` is not painted, so the compositor was handed an
animation and no pixels), and its idle breathe moved to a wrapper because two
animations claiming one property on one element means neither is composited. It
is now up at t≈300ms and complete by t≈900ms.
