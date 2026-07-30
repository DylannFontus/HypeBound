/**
 * Accessibility — `13-accessibility.md`, and `03-screens-and-navigation.md`
 * §4.6.2.
 *
 * The load-bearing test here is §7.2's, and it is worth reading the spec's own
 * justification for it:
 *
 * > *"A failing palette change fails CI. **This is why the palette can be tuned
 * > freely later: the guardrail is mechanical, not editorial.**"*
 *
 * Whether eight hues stay distinguishable under three kinds of colour blindness
 * is not a judgement anybody can make reliably by looking, and *"looks fine to
 * me"* is the exact failure mode it exists to catch. So it is arithmetic: a
 * Brettel–Viénot simulation, ΔE\*ab, and a WCAG luminance ratio, with no
 * dependency added to get them.
 *
 * The rest is about settings that **do something**. Two of this game's
 * accessibility options were inert when this block started — nothing anywhere
 * read `data-colorblind` or `data-labels` — which is the worst version of the
 * inert-reward bug, because the person it fails is the person who needed it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getContent, collectibleCards } from "../src/engine/content";
import {
  checkPalettes,
  defaultPalettePressure,
  deltaE,
  hexToRgb,
  luminanceRatio,
  MIN_DELTA_E,
  MIN_LUMINANCE_RATIO,
  pairVerdicts,
  relativeLuminance,
  simulate,
  toLab,
} from "../src/game/a11y";
import {
  buildPalette,
  COLORBLIND_MODES,
  CURRENT_PALETTE,
  applyColorblindMode,
  paletteFor,
} from "../src/ui/cardRenderer/palette";
import { lensText, parseCardText, setRulesLens } from "../src/ui/cardRenderer/renderCard";
import {
  UI_SCALES,
  cueVolume,
  getSettings,
  nearestScale,
  patternsActive,
  settingsStore,
  updateSettings,
} from "../src/save/settings";
import { DEFERRED_A11Y } from "../src/ui/screens/a11yScreen";

const content = getContent();

// ---------------------------------------------------------------------------

describe("the colour guardrail — §7.2", () => {
  it("keeps every pair of Currents distinguishable in every colour-blind mode", () => {
    const problems = checkPalettes();
    expect(problems, problems.length === 0 ? "" : `\nthe palettes:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  /**
   * The default palette is deliberately *not* required to pass. It fails under
   * all three simulations, which is the reason the modes exist — and this
   * asserts the modes are worth turning on rather than decoration.
   */
  it("fixes pairs the default palette genuinely confuses", () => {
    for (const entry of defaultPalettePressure()) {
      expect(entry.confusableByDefault, `${entry.mode} has nothing to fix`).toBeGreaterThan(0);
      expect(entry.confusableInMode, `${entry.mode} leaves pairs confusable`).toBe(0);
    }
  });

  /**
   * Red and green collapse **in hue** for a deuteranope while staying far apart
   * in lightness — pure red is dark and pure green is bright. That is the whole
   * reason §7.2 accepts a pair on *either* threshold rather than on ΔE alone,
   * and it is worth asserting rather than assuming: an earlier version of this
   * test expected the two to be indistinguishable outright and was simply wrong.
   */
  it("collapses the red–green axis while leaving lightness alone", () => {
    const red = simulate(hexToRgb("#ff0000"), "deuteranopia");
    const green = simulate(hexToRgb("#00ff00"), "deuteranopia");
    const chroma = (rgb: ReturnType<typeof hexToRgb>): [number, number] => {
      const [, a, b] = toLab(rgb);
      return [a, b];
    };
    const [ar, br] = chroma(red);
    const [ag, bg] = chroma(green);
    expect(Math.hypot(ar - ag, br - bg), "the hues did not collapse").toBeLessThan(12);
    expect(luminanceRatio(red, green), "lightness should still separate them").toBeGreaterThan(MIN_LUMINANCE_RATIO);

    // and blue is barely touched by a red–green collapse
    const blue = hexToRgb("#0000ff");
    expect(deltaE(simulate(blue, "deuteranopia"), blue)).toBeLessThan(6);
    // `off` is the identity
    expect(simulate(hexToRgb("#a855f7"), "off")).toEqual(hexToRgb("#a855f7"));
  });

  it("measures luminance and distance the way the thresholds mean them", () => {
    expect(relativeLuminance(hexToRgb("#ffffff"))).toBeCloseTo(1, 3);
    expect(relativeLuminance(hexToRgb("#000000"))).toBeCloseTo(0, 3);
    expect(luminanceRatio(hexToRgb("#ffffff"), hexToRgb("#000000"))).toBeCloseTo(21, 0);
    expect(deltaE(hexToRgb("#ff0000"), hexToRgb("#ff0000"))).toBe(0);
  });

  it("passes a pair on either threshold, not both", () => {
    const verdicts = pairVerdicts("deuteranopia", "deuteranopia");
    for (const verdict of verdicts) {
      expect(verdict.distinguishable).toBe(
        verdict.deltaE >= MIN_DELTA_E || verdict.luminanceRatio >= MIN_LUMINANCE_RATIO
      );
    }
    // and at least one pair is carried by luminance alone, or the rule is dead weight
    expect(verdicts.some((verdict) => verdict.deltaE < MIN_DELTA_E && verdict.luminanceRatio >= MIN_LUMINANCE_RATIO)).toBe(
      true
    );
  });
});

describe("the palette itself", () => {
  beforeEach(() => applyColorblindMode("off"));

  it("changes only the eight hues, never a shape or a label", () => {
    const base = buildPalette("off");
    for (const mode of COLORBLIND_MODES) {
      const other = buildPalette(mode);
      for (const id of Object.keys(base) as (keyof typeof base)[]) {
        expect(other[id].shape, `${mode}/${id}`).toBe(base[id].shape);
        expect(other[id].label, `${mode}/${id}`).toBe(base[id].label);
        expect(other[id].hatch, `${mode}/${id}`).toBe(base[id].hatch);
      }
    }
  });

  it("gives every Current a distinct shape, label and hatch", () => {
    const base = buildPalette("off");
    const values = Object.values(base);
    expect(new Set(values.map((entry) => entry.shape)).size).toBe(values.length);
    expect(new Set(values.map((entry) => entry.label)).size).toBe(values.length);
    expect(new Set(values.map((entry) => entry.hatch)).size).toBe(values.length);
  });

  it("swaps the live palette in place, so every renderer sees it at once", () => {
    const before = CURRENT_PALETTE.veil.key;
    applyColorblindMode("protanopia");
    expect(CURRENT_PALETTE.veil.key).toBe(paletteFor("protanopia").veil);
    expect(CURRENT_PALETTE.veil.key).not.toBe(before);
    // the derived shades follow the key rather than going stale
    expect(CURRENT_PALETTE.veil.lo).not.toBe(CURRENT_PALETTE.veil.key);
    applyColorblindMode("off");
    expect(CURRENT_PALETTE.veil.key).toBe(before);
  });

  it("moves as little as it can get away with", () => {
    // the modes are the minimum change that clears §7.2, not a repaint
    for (const mode of COLORBLIND_MODES.filter((entry) => entry !== "off")) {
      const drift =
        Object.keys(paletteFor("off"))
          .map((id) => deltaE(hexToRgb(paletteFor("off")[id as never]), hexToRgb(paletteFor(mode)[id as never])))
          .reduce((sum, value) => sum + value, 0) / 8;
      expect(drift, `${mode} repaints the whole palette`).toBeLessThan(12);
    }
  });
});

describe("settings that actually do something", () => {
  beforeEach(() => settingsStore.reset());

  it("clamps the interface scale to a shipped step", () => {
    expect(UI_SCALES).toContain(nearestScale(1.0));
    expect(nearestScale(0.42)).toBe(0.8);
    expect(nearestScale(9)).toBe(1.6);
    expect(nearestScale(1.22)).toBe(1.25);
  });

  /**
   * Somebody who chose "extra large" chose it for a reason, and silently
   * returning them to 100% is the worst possible outcome of an accessibility
   * change. The old four names map onto the new seven steps.
   */
  it("carries an older save's text size forward instead of resetting it", () => {
    const migrated = settingsStore["options"].migrate!({ textScale: "xl", volumeMusic: 0.3 }, 1);
    expect(migrated.uiScale).toBe(1.4);
    expect(migrated.volumeMusic).toBe(0.3);
    expect(settingsStore["options"].migrate!({ textScale: "m" }, 1).uiScale).toBe(1);
    expect(settingsStore["options"].migrate!({}, 1).uiScale).toBe(1);
  });

  it("forces hatch patterns on inside a colour-blind mode", () => {
    expect(patternsActive({ ...getSettings(), currentPatterns: false, colorblindMode: "off" })).toBe(false);
    expect(patternsActive({ ...getSettings(), currentPatterns: true, colorblindMode: "off" })).toBe(true);
    expect(patternsActive({ ...getSettings(), currentPatterns: false, colorblindMode: "tritanopia" })).toBe(true);
  });

  /**
   * A cue that tells you your turn started is not a battle effect. Turning
   * battle effects down must not turn off the thing telling you it is your move.
   */
  it("keeps the accessibility cue gain off the battle channel", () => {
    updateSettings({ volumeBattle: 0, volumeMaster: 1, audioCueGain: 1, audioCues: true });
    expect(cueVolume()).toBe(1);
    updateSettings({ audioCues: false });
    expect(cueVolume()).toBe(0);
  });

  it("accounts for every control the spec asks for and this build cannot give", () => {
    expect(DEFERRED_A11Y.size).toBeGreaterThan(0);
    for (const [name, reason] of DEFERRED_A11Y) {
      expect(reason.trim().length, name).toBeGreaterThan(20);
    }
  });
});

describe("the Rules Lens — §17", () => {
  const reminders = Object.fromEntries(
    Object.values(content.keywords).map((keyword) => [keyword.id, keyword.reminderText])
  );

  beforeEach(() => setRulesLens(false, reminders));

  it("adds nothing at all when it is off", () => {
    const card = collectibleCards(content).find((entry) => entry.keywords.length > 0)!;
    expect(lensText(card)).toBe("");
  });

  it("prints every keyword's reminder, in italics, when it is on", () => {
    setRulesLens(true, reminders);
    const card = collectibleCards(content).find((entry) => entry.keywords.length > 0)!;
    const text = lensText(card);
    for (const keyword of card.keywords) {
      expect(text, keyword).toContain(reminders[keyword]!);
    }
    // the renderer's markup: a single italic run
    const segments = parseCardText(text);
    expect(segments.every((segment) => segment.italic)).toBe(true);
  });

  it("adds nothing to a card with no keywords", () => {
    setRulesLens(true, reminders);
    const plain = collectibleCards(content).find((entry) => entry.keywords.length === 0);
    if (plain) expect(lensText(plain)).toBe("");
  });

  /**
   * The lens has to fit. `drawRichText` shrinks to 11px and then draws whatever
   * is left, so a card whose text plus reminders overruns the box would clip
   * silently — the one failure mode a reading aid must not have.
   */
  it("leaves every shipped card inside its text box at the minimum size", () => {
    setRulesLens(true, reminders);
    const BOX = { w: 512 - 60 - 32, h: 142 - 24 };
    const CHAR = 5.3; // measured width of an 11px character in the card font
    const LINE = 11 * 1.28;
    const overflowing: string[] = [];

    for (const card of collectibleCards(content)) {
      const full = [card.text?.trim() ?? "", lensText(card)].filter(Boolean).join(" ");
      const plain = full.replace(/\*/g, "");
      const lines = Math.ceil((plain.length * CHAR) / BOX.w);
      if (lines * LINE > BOX.h) overflowing.push(`${card.id} (${plain.length} chars)`);
    }

    expect(
      overflowing,
      overflowing.length === 0
        ? ""
        : `\n${overflowing.length} cards overflow their text box with the Rules Lens on:\n  ${overflowing
            .slice(0, 8)
            .join("\n  ")}\n`
    ).toEqual([]);
  });
});
