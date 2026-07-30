/**
 * Audio manager.
 *
 * Every sound is addressed by a slot name from data/audio-manifest.json. Slots
 * with a null path are silent no-ops, so the game runs perfectly with zero
 * audio files present — the owner drops files into public/assets/audio/ and
 * points the manifest at them, with no code change.
 *
 * Five independent channels (music, voice, ui, battle, ambient) plus a master,
 * all driven by the settings store.
 */

import manifest from "../../data/audio-manifest.json";
import { channelVolume, cueVolume, getSettings } from "../save/settings";
import { cueById, cueDuration, renderCue } from "./cues";

export type AudioChannel = "music" | "voice" | "ui" | "battle" | "ambient";

const AUDIO_BASE = "assets/audio";

/** Which channel a slot belongs to, inferred from its name prefix. */
function channelFor(slot: string): AudioChannel {
  if (slot.startsWith("music.")) return "music";
  if (slot.startsWith("voice.")) return "voice";
  if (slot.startsWith("ambient.")) return "ambient";
  if (slot.startsWith("sfx.ui.")) return "ui";
  return "battle";
}

interface LoadedSound {
  buffer: AudioBuffer | null;
  failed: boolean;
}

export class AudioManager {
  private context: AudioContext | null = null;
  private channelGains = new Map<AudioChannel, GainNode>();
  private masterGain: GainNode | null = null;
  private cache = new Map<string, LoadedSound>();
  private loading = new Set<string>();
  private musicSource: AudioBufferSourceNode | null = null;
  private currentMusicSlot: string | null = null;
  private warned = new Set<string>();
  private unlocked = false;

  private readonly slots: Record<string, string | null>;

  constructor() {
    const data = manifest as { slots?: Record<string, string | null> };
    this.slots = data.slots ?? {};
  }

  /** Browsers require a user gesture before audio may start. */
  unlock(): void {
    if (this.unlocked) return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.context = new Ctor();
      this.masterGain = this.context.createGain();
      this.masterGain.connect(this.context.destination);

      for (const channel of ["music", "voice", "ui", "battle", "ambient"] as AudioChannel[]) {
        const gain = this.context.createGain();
        gain.connect(this.masterGain);
        this.channelGains.set(channel, gain);
      }
      this.applyVolumes();
      this.unlocked = true;
      void this.context.resume();
    } catch {
      this.unlocked = false;
    }
  }

  /** Re-read the settings store; call after the settings screen changes a value. */
  applyVolumes(): void {
    if (!this.context) return;
    for (const [channel, gain] of this.channelGains) {
      gain.gain.value = channelVolume(channel);
    }
    if (this.masterGain) this.masterGain.gain.value = 1;
  }

  private resolvePath(slot: string): string | null {
    const path = this.slots[slot];
    if (!path) return null;
    if (getSettings().streamerSafeAudio && path.includes("/licensed/")) return null;
    return path.startsWith("http") || path.startsWith("/") ? path : `${AUDIO_BASE}/${path}`;
  }

  private async load(slot: string): Promise<AudioBuffer | null> {
    const cached = this.cache.get(slot);
    if (cached) return cached.buffer;
    if (this.loading.has(slot)) return null;

    const path = this.resolvePath(slot);
    if (!path || !this.context) {
      this.cache.set(slot, { buffer: null, failed: true });
      return null;
    }

    this.loading.add(slot);
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const buffer = await this.context.decodeAudioData(bytes);
      this.cache.set(slot, { buffer, failed: false });
      return buffer;
    } catch {
      // a missing file is expected during development — warn once, never throw
      if (!this.warned.has(slot)) {
        this.warned.add(slot);
        console.info(`[audio] slot "${slot}" has no playable file yet (${path})`);
      }
      this.cache.set(slot, { buffer: null, failed: true });
      return null;
    } finally {
      this.loading.delete(slot);
    }
  }

  /** Fire and forget a one-shot. Silent if the slot has no file. */
  play(slot: string, options: { volume?: number; rate?: number } = {}): void {
    if (!this.context || !this.unlocked) return;
    const path = this.resolvePath(slot);
    if (!path) return;

    void this.load(slot).then((buffer) => {
      if (!buffer || !this.context) return;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = options.rate ?? 1;

      const gain = this.context.createGain();
      gain.gain.value = options.volume ?? 1;
      const channel = this.channelGains.get(channelFor(slot));
      if (!channel) return;
      source.connect(gain).connect(channel);
      source.start();
    });
  }

  /** Crossfade to a looping music slot. */
  /**
   * Is this a slot the manifest declares?
   *
   * Asked before choosing faction music, so a faction with no track of its own
   * falls back to the default rather than requesting a slot that does not
   * exist — which plays nothing and says nothing.
   */
  hasSlot(slot: string): boolean {
    return slot in this.slots;
  }

  playMusic(slot: string, fadeSeconds = 1.2): void {
    if (!this.context || !this.unlocked) return;
    if (this.currentMusicSlot === slot) return;
    const path = this.resolvePath(slot);
    if (!path) {
      this.stopMusic(fadeSeconds);
      return;
    }

    void this.load(slot).then((buffer) => {
      if (!buffer || !this.context) return;
      this.stopMusic(fadeSeconds);

      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const gain = this.context.createGain();
      gain.gain.setValueAtTime(0, this.context.currentTime);
      gain.gain.linearRampToValueAtTime(1, this.context.currentTime + fadeSeconds);

      const channel = this.channelGains.get("music");
      if (!channel) return;
      source.connect(gain).connect(channel);
      source.start();

      this.musicSource = source;
      this.currentMusicSlot = slot;
    });
  }

  stopMusic(fadeSeconds = 0.8): void {
    const source = this.musicSource;
    if (!source || !this.context) return;
    this.musicSource = null;
    this.currentMusicSlot = null;
    try {
      source.stop(this.context.currentTime + fadeSeconds);
    } catch {
      /* already stopped */
    }
  }

  /**
   * Play an accessibility cue (§11) — synthesised, not loaded.
   *
   * It goes through a **dedicated sub-gain off the ui channel**, exactly as §11
   * asks, so raising cues never raises interface sound generally and turning
   * battle effects to zero never silences the thing telling you it is your
   * move. `cueVolume()` already folds in the accessibility gain and the on/off
   * switch, which is why this reads it rather than the channel volume.
   *
   * Silent and harmless before the first user gesture, like every other sound.
   */
  cue(id: string): void {
    if (!this.context || !this.unlocked) return;
    const cue = cueById(id);
    if (!cue) return;
    const volume = cueVolume();
    if (volume <= 0) return;

    if (!this.cueGain) {
      const gain = this.context.createGain();
      const ui = this.channelGains.get("ui");
      // straight to master if the ui channel is somehow absent: a cue that
      // vanishes because a channel failed to build is the worst outcome here
      gain.connect(ui ?? this.masterGain ?? this.context.destination);
      this.cueGain = gain;
    }
    this.cueGain.gain.value = 1;

    renderCue(this.context, this.cueGain, cue, volume, this.context.currentTime);

    /**
     * §11's `duckUnderCues`: music and ambient drop 6 dB for the cue's length.
     * 6 dB is a factor of about 0.5, and it is a ramp rather than a step so the
     * duck itself is not a second sound.
     */
    if (getSettings().duckUnderCues) this.duck(cueDuration(cue) / 1000);
  }

  private cueGain: GainNode | null = null;

  private duck(seconds: number): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const channel of ["music", "ambient"] as AudioChannel[]) {
      const gain = this.channelGains.get(channel);
      if (!gain) continue;
      const level = channelVolume(channel);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(level * 0.5, now + 0.05);
      gain.gain.setValueAtTime(level * 0.5, now + seconds);
      gain.gain.linearRampToValueAtTime(level, now + seconds + 0.25);
    }
  }

  /** Which slots still have no file — surfaced in the audio tools screen. */
  missingSlots(): string[] {
    return Object.entries(this.slots)
      .filter(([, path]) => !path)
      .map(([slot]) => slot);
  }

  allSlots(): string[] {
    return Object.keys(this.slots);
  }
}

export const audio = new AudioManager();

/** Unlock on the first user gesture anywhere in the app. */
if (typeof window !== "undefined") {
  const unlock = (): void => {
    audio.unlock();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: false });
  window.addEventListener("keydown", unlock, { once: false });
}
