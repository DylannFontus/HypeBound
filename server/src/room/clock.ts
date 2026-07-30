/**
 * A clock that cannot go backwards.
 *
 * §7.7 C10: `MatchClocks.serverNowMs` is documented as monotonic and was
 * implemented as `Date.now()`, which is not — it follows NTP corrections, and a
 * correction of a few hundred milliseconds is entirely ordinary. The client
 * derives its countdown offset from this number, so a step backwards shows a
 * turn timer that jumps *up*, and a step backwards across a rope expiry decides
 * a turn twice.
 *
 * Workers make this both easier and stranger than it sounds. `Date.now()` inside
 * a Worker is frozen for the duration of synchronous execution and only advances
 * at I/O boundaries, specifically so timing cannot be used as a side channel. So
 * within one message handler the clock genuinely does not move — which is fine,
 * because a room applies one intent per handler — and between handlers it can
 * move by any amount, including a negative one.
 *
 * The fix is the smallest one that works: remember the highest value handed out
 * and never return less. No offset table, no drift correction. If the wall clock
 * jumps backwards the room simply stops for that long, which is the correct
 * failure — a paused timer is recoverable and a rewound one is not.
 */
export class MonotonicClock {
  private highWater = 0;

  constructor(private readonly source: () => number = Date.now) {}

  now(): number {
    const raw = this.source();
    if (raw > this.highWater) this.highWater = raw;
    return this.highWater;
  }

  /**
   * Bring the clock forward to a known-good point — used when a room is rebuilt
   * from storage and the persisted `turnStartedAtMs` is ahead of this instance's
   * idea of the time, which happens whenever an object migrates between machines.
   */
  observe(timestampMs: number): void {
    if (timestampMs > this.highWater) this.highWater = timestampMs;
  }
}
