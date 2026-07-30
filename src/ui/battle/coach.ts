/**
 * The coach overlay: a speaking guide plus a spotlight.
 *
 * Shared by every scripted mode — the tutorial's Nova Encore, puzzle hints,
 * story dialogue, boss taunts — so it knows nothing about lessons or rules. It
 * shows a line, optionally dims the screen except for one element, and tells
 * the caller when the player has acknowledged it. Whoever drives it owns the
 * script.
 *
 * The spotlight deliberately does NOT block input to the element it highlights:
 * the whole point is to say "click *this*", so the cutout has to stay clickable
 * while everything around it is inert.
 */

export type CoachSide = "left" | "right";

export interface CoachLine {
  /** who is speaking; omit for narration */
  speaker?: string;
  text: string;
  /** element to spotlight, as a CSS selector resolved when the line is shown */
  spotlight?: string;
  /** show a "Got it" button and wait for it; otherwise the caller advances */
  requireAck?: boolean;
  /** which corner the panel sits in, to keep it off whatever is being taught */
  side?: CoachSide;
}

export interface CoachOverlay {
  /** Show a line. Resolves when acknowledged, or immediately if not required. */
  say: (line: CoachLine) => Promise<void>;
  /** Highlight one element (or clear with null) without saying anything. */
  spotlight: (selector: string | null) => void;
  /** Hide the panel and the spotlight, leaving the board fully interactive. */
  clear: () => void;
  dispose: () => void;
}

export function createCoachOverlay(host: HTMLElement): CoachOverlay {
  const root = document.createElement("div");
  root.className = "coach-layer";
  root.hidden = true;

  /**
   * The dimmer is a single element with an enormous spread shadow: the element
   * itself is the hole, the shadow is everything else. Cheaper and crisper than
   * four panels or an SVG mask, and it scales to any rect.
   */
  const dimmer = document.createElement("div");
  dimmer.className = "coach-spotlight";
  dimmer.hidden = true;
  root.appendChild(dimmer);

  const panel = document.createElement("div");
  panel.className = "coach-panel";
  panel.hidden = true;
  // announced to screen readers; the visual panel is not the only channel
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");

  const speakerEl = document.createElement("div");
  speakerEl.className = "coach-speaker";

  const textEl = document.createElement("p");
  textEl.className = "coach-text";

  const ackButton = document.createElement("button");
  ackButton.className = "btn btn-primary coach-ack";
  ackButton.type = "button";
  ackButton.textContent = "Got it";
  ackButton.hidden = true;

  panel.append(speakerEl, textEl, ackButton);
  root.appendChild(panel);
  host.appendChild(root);

  let pendingAck: (() => void) | null = null;
  let trackedSelector: string | null = null;
  let raf = 0;

  /**
   * Selectors come from encounter JSON, so a typo silently produces no
   * spotlight at all — the lesson still runs but stops pointing at anything.
   * Warn once per selector so that fails loudly in development instead of just
   * looking slightly worse.
   */
  const warned = new Set<string>();

  const positionSpotlight = (): void => {
    if (!trackedSelector) return;
    const target = document.querySelector(trackedSelector);
    if (!(target instanceof HTMLElement)) {
      if (!warned.has(trackedSelector)) {
        warned.add(trackedSelector);
        console.warn(`[coach] spotlight selector matched nothing: ${trackedSelector}`);
      }
      dimmer.hidden = true;
      return;
    }
    const rect = target.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const pad = 8;
    dimmer.hidden = false;
    dimmer.style.left = `${rect.left - hostRect.left - pad}px`;
    dimmer.style.top = `${rect.top - hostRect.top - pad}px`;
    dimmer.style.width = `${rect.width + pad * 2}px`;
    dimmer.style.height = `${rect.height + pad * 2}px`;
  };

  /**
   * Board cards live in a canvas and the hand reflows constantly, so the
   * highlighted rect moves. Tracking per frame is far simpler than trying to
   * invalidate on every layout change, and it is one getBoundingClientRect.
   */
  const track = (): void => {
    positionSpotlight();
    raf = requestAnimationFrame(track);
  };

  const spotlight = (selector: string | null): void => {
    trackedSelector = selector;
    if (!selector) {
      dimmer.hidden = true;
      root.hidden = panel.hidden;
      cancelAnimationFrame(raf);
      raf = 0;
      return;
    }
    root.hidden = false;
    positionSpotlight();
    if (!raf) raf = requestAnimationFrame(track);
  };

  ackButton.addEventListener("click", () => {
    const resolve = pendingAck;
    pendingAck = null;
    ackButton.hidden = true;
    resolve?.();
  });

  const say = (line: CoachLine): Promise<void> => {
    root.hidden = false;
    panel.hidden = false;
    panel.classList.toggle("coach-panel-right", line.side === "right");
    speakerEl.textContent = line.speaker ?? "";
    speakerEl.hidden = !line.speaker;
    textEl.textContent = line.text;
    spotlight(line.spotlight ?? null);

    // replay the entrance so consecutive lines still read as new
    panel.classList.remove("coach-panel-in");
    void panel.offsetWidth;
    panel.classList.add("coach-panel-in");

    if (!line.requireAck) return Promise.resolve();
    ackButton.hidden = false;
    return new Promise<void>((resolve) => {
      pendingAck = resolve;
    });
  };

  const clear = (): void => {
    // never leave a caller awaiting an acknowledgement that can no longer happen
    pendingAck?.();
    pendingAck = null;
    panel.hidden = true;
    ackButton.hidden = true;
    spotlight(null);
    root.hidden = true;
  };

  return {
    say,
    spotlight,
    clear,
    dispose: () => {
      clear();
      cancelAnimationFrame(raf);
      root.remove();
    },
  };
}
