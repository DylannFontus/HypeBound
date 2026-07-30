/**
 * Accessibility audio cues — `13-accessibility.md` §11, **synthesised**.
 *
 * Known gap 34 said the cue points fired but every audio slot in the build was
 * empty, so there was nothing to play. That was true and the conclusion was
 * wrong. §11 never specifies audio *files*: it specifies a **cue character** for
 * each of its 34 rows — "two-note rising chime", "single low tone", "hollow
 * descending tone". A character is a description of a waveform, and an
 * `AudioContext` can make a waveform out of nothing at all.
 *
 * So these are oscillators and filtered noise, built at play time from
 * `data/audio-cues.json`. There are no files to ship, nothing to download, no
 * licence to honour, and no empty slot pretending to be a sound. Dropping real
 * recordings in later replaces the synth for any cue that gains a file; until
 * then the cue is real rather than notional.
 *
 * Two rules from §11 are enforced rather than remembered:
 *
 * - **Every cue has a visual twin.** No cue is the only notification of
 *   anything, so a player with the sound off loses nothing.
 * - **Cues route through their own gain**, off the battle channel, so turning
 *   battle effects down never turns off the thing telling you it is your move.
 */

import { z } from "zod";
import raw from "../../data/audio-cues.json";
import { cueVolume, getSettings } from "../save/settings";

const toneSchema = z
  .object({
    hz: z.number().positive(),
    ms: z.number().positive(),
    wave: z.enum(["sine", "triangle", "square", "sawtooth", "noise"]),
    /** 1 by default; lower for a layer that should sit under the others */
    gain: z.number().min(0).max(1).optional(),
    /**
     * Milliseconds after the *previous* tone starts, rather than after it ends.
     * `0` stacks a tone on the one before it, which is how a chord is written.
     */
    delayMs: z.number().min(0).optional(),
  })
  .strict();

const cueSchema = z
  .object({
    id: z.string().min(1),
    /** the row in §11's table, so a cue can be checked against the spec by eye */
    row: z.number().int().positive(),
    event: z.string().min(1),
    character: z.string().min(1),
    /** §11's binding rule: no cue is the only notification of anything */
    twin: z.string().min(1),
    /** §11 marks some rows captioned; those carry the text the setting shows */
    caption: z.string().min(1).optional(),
    tones: z.array(toneSchema).min(1),
  })
  .strict();

const fileSchema = z.object({ _readme: z.array(z.string()).optional(), cues: z.array(cueSchema).min(1) }).strict();

export type CueTone = z.infer<typeof toneSchema>;
export type CueDef = z.infer<typeof cueSchema>;

let parsed: z.infer<typeof fileSchema> | null = null;

export function cueData(): CueDef[] {
  if (!parsed) parsed = fileSchema.parse(raw);
  return parsed.cues;
}

export const cueById = (id: string): CueDef | null => cueData().find((cue) => cue.id === id) ?? null;

export type CueId = string;

/**
 * How long a cue lasts, in milliseconds — the sum of its tones, honouring the
 * stacking `delayMs`. Used by the caption layer to decide how long to show the
 * text, and by the ducking below.
 */
export function cueDuration(cue: CueDef): number {
  let start = 0;
  let end = 0;
  for (const [index, tone] of cue.tones.entries()) {
    const offset = index === 0 ? 0 : (tone.delayMs ?? cue.tones[index - 1]!.ms);
    start += offset;
    end = Math.max(end, start + tone.ms);
  }
  return end;
}

// ---------------------------------------------------------------------------
// The synth
// ---------------------------------------------------------------------------

/** A short burst of filtered noise — a paper slide, a glass tap, a crumple. */
function noiseBuffer(context: BaseAudioContext, ms: number): AudioBuffer {
  const frames = Math.max(1, Math.floor((context.sampleRate * ms) / 1000));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  /**
   * A fixed sequence rather than `Math.random()`.
   *
   * Not for determinism's sake — nobody replays audio — but so a cue sounds the
   * same every time it fires. A cue whose texture wanders is a cue you have to
   * re-learn, which is the one thing an accessibility signal must not be.
   */
  let seed = 0x9e3779b9;
  for (let i = 0; i < frames; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = (seed / 0x80000000 - 1) * 0.6;
  }
  return buffer;
}

/**
 * Play one cue into `destination`, at `volume`.
 *
 * Separated from the manager so it can be rendered offline in a test — which is
 * the only way to assert that a cue actually makes a sound rather than that a
 * function was called.
 */
export function renderCue(
  context: BaseAudioContext,
  destination: AudioNode,
  cue: CueDef,
  volume: number,
  startAt = 0
): void {
  if (volume <= 0) return;
  let cursor = startAt;

  for (const [index, tone] of cue.tones.entries()) {
    const offset = index === 0 ? 0 : (tone.delayMs ?? cue.tones[index - 1]!.ms) / 1000;
    cursor += offset;

    const seconds = tone.ms / 1000;
    const gain = context.createGain();
    const peak = volume * (tone.gain ?? 0.8);

    /**
     * An 8 ms attack, then an exponential fall to silence.
     *
     * The attack is not decoration: a square or sawtooth starting instantly at
     * full amplitude clicks, and a click is louder and more startling than the
     * cue it belongs to — the opposite of §11's "never harsh".
     */
    gain.gain.setValueAtTime(0.0001, cursor);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), cursor + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, cursor + seconds);
    gain.connect(destination);

    if (tone.wave === "noise") {
      const source = context.createBufferSource();
      source.buffer = noiseBuffer(context, tone.ms);
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = tone.hz;
      filter.Q.value = 0.9;
      source.connect(filter).connect(gain);
      source.start(cursor);
      source.stop(cursor + seconds);
    } else {
      const osc = context.createOscillator();
      osc.type = tone.wave;
      osc.frequency.value = tone.hz;
      osc.connect(gain);
      osc.start(cursor);
      osc.stop(cursor + seconds);
    }
  }
}

/** Whether a cue should be heard at all right now. */
export const cuesAudible = (): boolean => cueVolume() > 0;

/** The caption a cue shows, or null when §11 does not mark the row captioned. */
export function cueCaption(id: CueId): string | null {
  if (!getSettings().soundCaptions) return null;
  return cueById(id)?.caption ?? null;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Everything wrong with the cue table. */
export function checkCueData(): string[] {
  const problems: string[] = [];
  const cues = cueData();

  const seenIds = new Set<string>();
  const seenRows = new Set<number>();
  const seenTones = new Map<string, string>();

  for (const cue of cues) {
    if (seenIds.has(cue.id)) problems.push(`${cue.id}: two cues share an id`);
    seenIds.add(cue.id);
    if (seenRows.has(cue.row)) problems.push(`${cue.id}: row ${cue.row} is claimed twice`);
    seenRows.add(cue.row);
    if (cue.row > 34) problems.push(`${cue.id}: row ${cue.row} is past the end of §11's table`);

    /**
     * Two cues that sound the same are worse than one cue missing: the player
     * learns a signal and then gets it for the wrong event. Compared on the
     * tone sequence rather than by ear, which is the same reason §7.2's palette
     * check is arithmetic.
     */
    const shape = cue.tones.map((tone) => `${tone.wave}:${Math.round(tone.hz)}:${tone.ms}`).join("|");
    const twin = seenTones.get(shape);
    if (twin) problems.push(`${cue.id} and ${twin} are the same sound`);
    else seenTones.set(shape, cue.id);

    // §11's binding rule
    if (!cue.twin.trim()) problems.push(`${cue.id}: no visual twin, and §11 forbids a cue that is the only notice`);

    const duration = cueDuration(cue);
    if (duration > 1500) problems.push(`${cue.id}: ${duration}ms is long enough to overlap the next one`);
    if (duration < 25) problems.push(`${cue.id}: ${duration}ms is too short to hear`);

    for (const tone of cue.tones) {
      // outside roughly this band a tone is inaudible on laptop speakers, which
      // is a cue that ships, validates, plays, and is heard by nobody
      if (tone.wave !== "noise" && (tone.hz < 60 || tone.hz > 5000)) {
        problems.push(`${cue.id}: ${tone.hz}Hz is outside what a laptop speaker reproduces`);
      }
    }
  }

  return problems;
}

/**
 * §11 rows this build does not fire, and why.
 *
 * The table has 34 rows; the ones missing here need the network transport, an
 * event the engine does not emit, or art that does not exist.
 *
 * Rows 3 and 4 — the turn rope — were on this list for one revision, on the
 * stated grounds that *"there is no turn timer in the offline build"*. There is:
 * `hud.startTimer` has run a 75-second clock with a 15-second rope, a ring and a
 * countdown numeral since the board shipped. It was deferred on a claim rather
 * than a check, which is the mistake this list exists to prevent rather than to
 * commit.
 */
export const DEFERRED_CUES: ReadonlyMap<number, string> = new Map([
  [11, "Fixation / Ultimate ready — the button already enables itself, and a once-per-availability ping needs a latch the battle view does not keep."],
  [20, "Trigger cascade ticks — the engine resolves a cascade atomically and emits no per-step event to hang a tick on."],
  [21, "Trigger cap reached — the cap is enforced in the reducer and reported in the log, but no event carries it out."],
  [28, "Opponent emote — emotes arrive over the transport, and there is no transport."],
  [29, "Connection lost or restored — likewise: there is no connection to lose, so the cue would announce nothing."],
  [33, "Pack rarity reveal — the Drop reveal is a screen of its own and its escalation wants per-rarity timbres tuned against real art."],
]);
