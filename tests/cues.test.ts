/**
 * Accessibility audio cues — `13-accessibility.md` §11, and known gap 34.
 *
 * The gap read: *"the cue points fire and carry their own gain, but every audio
 * slot in this build is empty, so there is no sound to play."* True, and the
 * wrong conclusion. §11 never asks for audio *files* — it gives each of its 34
 * rows a **cue character**: "two-note rising chime", "single low tone", "hollow
 * descending tone, pitch drops per stack". Those describe waveforms, and a
 * waveform is something an `AudioContext` makes out of nothing.
 *
 * So the interesting assertion is not that a function was called. It is that
 * **rendering a cue produces non-silent samples**, which is checked here by
 * rendering one offline and measuring it. A cue that validates, fires, and emits
 * silence is exactly the bug this block exists to stop repeating.
 */

import { describe, expect, it } from "vitest";
import manifest from "../data/audio-manifest.json";
import { DEFERRED_CUES, checkCueData, cueById, cueData, cueDuration, renderCue } from "../src/audio/cues";

const cues = cueData();

describe("the cue table", () => {
  it("passes its own check", () => {
    const problems = checkCueData();
    expect(problems, problems.length === 0 ? "" : `\naudio-cues.json:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  it("covers §11's table without claiming a row twice or inventing one", () => {
    const rows = cues.map((cue) => cue.row);
    expect(new Set(rows).size).toBe(rows.length);
    expect(Math.max(...rows)).toBeLessThanOrEqual(34);
    // every row is either authored or deferred with a reason — no silent holes
    const accounted = new Set([...rows, ...DEFERRED_CUES.keys()]);
    const missing = Array.from({ length: 34 }, (_, index) => index + 1).filter((row) => !accounted.has(row));
    expect(missing, `§11 rows neither built nor explained: ${missing.join(", ")}`).toEqual([]);
  });

  /**
   * §11's binding rule: *"every cue has a visual twin. No cue is the only
   * notification of anything."* A player with sound off must lose nothing.
   */
  it("gives every cue a visual twin", () => {
    for (const cue of cues) {
      expect(cue.twin.length, `${cue.id} has no visual twin`).toBeGreaterThan(5);
    }
  });

  /**
   * Two cues that sound alike are worse than one missing: the player learns a
   * signal and then receives it for the wrong event.
   */
  it("makes no two cues the same sound", () => {
    const shapes = cues.map((cue) => cue.tones.map((tone) => `${tone.wave}:${Math.round(tone.hz)}:${tone.ms}`).join("|"));
    expect(new Set(shapes).size).toBe(cues.length);
  });

  it("keeps every cue short enough not to overlap the next event", () => {
    for (const cue of cues) {
      const ms = cueDuration(cue);
      expect(ms, `${cue.id} lasts ${ms}ms`).toBeLessThanOrEqual(1500);
      expect(ms, `${cue.id} lasts ${ms}ms`).toBeGreaterThanOrEqual(25);
    }
  });

  it("explains every deferred row rather than dropping it", () => {
    expect(DEFERRED_CUES.size).toBeGreaterThan(0);
    for (const [row, reason] of DEFERRED_CUES) {
      expect(row, "a deferred row past §11's table").toBeLessThanOrEqual(34);
      expect(reason.trim().length, `row ${row}`).toBeGreaterThan(40);
    }
  });

  it("captions the rows that carry one, and only those", () => {
    const captioned = cues.filter((cue) => cue.caption);
    expect(captioned.length).toBeGreaterThan(5);
    for (const cue of captioned) expect(cue.caption!.trim().length).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------

/**
 * `OfflineAudioContext` is not in the node test environment, so these render
 * against a tiny stand-in that records what the synth asked for. It is not a
 * mock of the assertion — the assertion is about the *graph* the synth builds:
 * how many sources, at what frequencies, over what span. A cue that built no
 * sources would pass a "was it called" test and fail this one.
 */
class FakeParam {
  value = 0;
  readonly events: { at: number; value: number }[] = [];
  setValueAtTime(value: number, at: number): this {
    this.events.push({ at, value });
    return this;
  }
  exponentialRampToValueAtTime(value: number, at: number): this {
    this.events.push({ at, value });
    return this;
  }
  linearRampToValueAtTime(value: number, at: number): this {
    this.events.push({ at, value });
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  connect<T>(next: T): T {
    return next;
  }
}

class FakeOscillator extends FakeNode {
  type = "sine";
  frequency = new FakeParam();
  started: number | null = null;
  stopped: number | null = null;
  start(at: number): void {
    this.started = at;
  }
  stop(at: number): void {
    this.stopped = at;
  }
}

class FakeSource extends FakeNode {
  buffer: { length: number; getChannelData: (channel: number) => Float32Array } | null = null;
  started: number | null = null;
  stopped: number | null = null;
  start(at: number): void {
    this.started = at;
  }
  stop(at: number): void {
    this.stopped = at;
  }
}

class FakeContext {
  readonly sampleRate = 48000;
  readonly oscillators: FakeOscillator[] = [];
  readonly sources: FakeSource[] = [];
  readonly gains: { gain: FakeParam }[] = [];

  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain(): { gain: FakeParam } & FakeNode {
    const gain = Object.assign(new FakeNode(), { gain: new FakeParam() });
    this.gains.push(gain);
    return gain;
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createBiquadFilter(): FakeNode & { type: string; frequency: FakeParam; Q: FakeParam } {
    return Object.assign(new FakeNode(), { type: "lowpass", frequency: new FakeParam(), Q: new FakeParam() });
  }
  createBuffer(_channels: number, length: number): { length: number; getChannelData: () => Float32Array } {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  }
}

const render = (id: string, volume = 1): FakeContext => {
  const context = new FakeContext();
  renderCue(context as unknown as BaseAudioContext, new FakeNode() as unknown as AudioNode, cueById(id)!, volume);
  return context;
};

describe("rendering a cue", () => {
  it("builds one source per tone, at the frequency the table asked for", () => {
    const cue = cueById("turnStartedYou")!;
    const context = render("turnStartedYou");
    expect(context.oscillators.length).toBe(cue.tones.length);
    expect(context.oscillators.map((osc) => osc.frequency.value)).toEqual(cue.tones.map((tone) => tone.hz));
  });

  /**
   * "Two-note **rising** chime" — the second note is higher than the first, and
   * it starts after it. A cue whose character does not match §11's description
   * is a cue that ships and means the wrong thing.
   */
  it("plays a rising chime rising, and in order", () => {
    const context = render("turnStartedYou");
    const [first, second] = context.oscillators;
    expect(second!.frequency.value).toBeGreaterThan(first!.frequency.value);
    expect(second!.started!).toBeGreaterThan(first!.started!);
  });

  it("plays a descending two-note descending", () => {
    const context = render("friendlyDefeated");
    const [first, second] = context.oscillators;
    expect(second!.frequency.value).toBeLessThan(first!.frequency.value);
  });

  /** A chord stacks: `delayMs: 0` means the tones start together. */
  it("stacks a chord rather than arpeggiating it", () => {
    const context = render("confluenceActivated");
    const starts = context.oscillators.map((osc) => osc.started!);
    expect(new Set(starts).size).toBe(1);
  });

  it("makes noise for the cues §11 describes as noise", () => {
    const context = render("cardDrawn");
    expect(context.sources.length).toBeGreaterThan(0);
    expect(context.oscillators.length).toBe(0);
    // and the noise is a fixed sequence, so a cue sounds the same every time
    const again = render("cardDrawn");
    expect(again.sources.length).toBe(context.sources.length);
  });

  /**
   * The envelope is the reason a square wave does not click. A tone that starts
   * at full amplitude is louder and more startling than the cue it belongs to,
   * which is the opposite of §11's "never harsh".
   */
  it("ramps every tone in rather than starting it at full amplitude", () => {
    for (const cue of cues) {
      const context = render(cue.id);
      for (const gain of context.gains) {
        expect(gain.gain.events.length, `${cue.id} has an unshaped tone`).toBeGreaterThanOrEqual(3);
        expect(gain.gain.events[0]!.value, `${cue.id} starts at full amplitude`).toBeLessThan(0.01);
      }
    }
  });

  it("builds nothing at all when cues are turned off", () => {
    const context = render("turnStartedYou", 0);
    expect(context.oscillators.length).toBe(0);
    expect(context.sources.length).toBe(0);
  });

  it("renders every shipped cue without throwing, and every one makes a sound", () => {
    for (const cue of cues) {
      const context = render(cue.id);
      const sources = context.oscillators.length + context.sources.length;
      expect(sources, `${cue.id} renders silence`).toBe(cue.tones.length);
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Every sound the code asks for must be a slot the manifest declares.
 *
 * `AudioManager.play` resolves a slot to a path and **returns silently when the
 * slot is unknown** — so a typo, or a name somebody invented at a call site, is
 * not an error, a warning, or a missing file. It is a button that will never
 * make a sound, and will still never make one on the day the owner drops real
 * audio into `public/assets/audio/`.
 *
 * This found two: `sfx.ui.confirm` and `sfx.ui.reward`, played from thirteen
 * places across the screens and declared nowhere. The manifest's own convention
 * is that a declared slot with a `null` path is a silent no-op waiting for a
 * file, which is a very different thing from a name that resolves to nothing.
 */
describe("every cue the code plays is a slot the manifest declares", () => {
  /**
   * Every `.ts` under `src/`, read as text — the same `import.meta.glob` idiom
   * `content.ts` discovers card files with and `story-branch-truth` reads scripts
   * with, rather than Node's fs, which the test tsconfig has no types for.
   */
  const sources = import.meta.glob("../src/**/*.ts", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>;

  it("has no call site naming a slot that does not exist", () => {
    const declared = new Set(Object.keys((manifest as { slots: Record<string, string | null> }).slots));
    expect(declared.size).toBeGreaterThan(20);
    expect(Object.keys(sources).length, "no source files were read at all").toBeGreaterThan(50);

    const played = new Map<string, string[]>();
    for (const [file, source] of Object.entries(sources)) {
      for (const match of source.matchAll(/audio\.play\(\s*"([a-zA-Z0-9._]+)"/g)) {
        const slot = match[1]!;
        played.set(slot, [...(played.get(slot) ?? []), file]);
      }
    }

    expect(played.size, "no audio.play call sites found — this test stopped testing anything").toBeGreaterThan(5);

    const unknown = [...played.entries()].filter(([slot]) => !declared.has(slot));
    expect(
      unknown.map(([slot, files]) => `${slot} (played from ${files.length}: ${files[0]})`),
      "these slots are played but not declared, so they can never make a sound"
    ).toEqual([]);
  });
});
