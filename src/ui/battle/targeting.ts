/**
 * The targeting arrow and damage-preview badge.
 *
 * Drawn as an SVG overlay rather than in 3D: it stays crisp at any resolution,
 * costs nothing on the GPU, and always renders on top of the board.
 *
 * ## Two things were wrong with it and both were geometric before they were
 * aesthetic
 *
 * **The bow was displaced along -y instead of along the perpendicular.** The
 * control point was `(midX, midY - lift)`, which is a bow only for a horizontal
 * attack. Nearly every attack in this game is close to vertical — the two rows
 * face each other across the mat — and for a vertical attack `-y` lies *on* the
 * line between the pair, so the quadratic degenerated and the "thrown ribbon"
 * drew as a straight bar. Offsetting by the unit perpendicular instead means the
 * bow is the same shape at every angle, which is the only version that can be
 * called an arc.
 *
 * **Nothing moved.** Held perfectly still for two seconds, the ribbon, the
 * arrowhead and the target ring were pixel-identical between t=5ms and t=970ms:
 * `path` and `head` carried a 120ms opacity transition and no keyframe named
 * `arrow-*` existed in any stylesheet. A targeting arrow is the one object on
 * screen that exists purely to say "this is about to happen to that", and a
 * still one says it in the past tense. It now carries a charge travelling toward
 * the target, a pulse on the head, and a reticle turning over whatever the head
 * is pointing at — all `stroke-dashoffset`, `transform` and `opacity` on five
 * elements, which is what §3's "never a paint property on many elements at once"
 * leaves available.
 */

import type { AttackPreview } from "../../engine/types";
import { icon } from "../art/uiIcons";

export type ArrowMode = "play" | "attack" | "attack-valid";

export interface TargetingLayer {
  show: (from: { x: number; y: number }, to: { x: number; y: number }, mode: ArrowMode) => void;
  hide: () => void;
  showPreview: (at: { x: number; y: number }, preview: AttackPreview) => void;
  hidePreview: () => void;
  dispose: () => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function createTargetingLayer(container: HTMLElement): TargetingLayer {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "targeting-layer");
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:40;overflow:visible";

  const defs = document.createElementNS(SVG_NS, "defs");
  svg.appendChild(defs);

  // gradient + glow for the arrow body
  const gradient = document.createElementNS(SVG_NS, "linearGradient");
  gradient.setAttribute("id", "arrow-gradient");
  gradient.setAttribute("gradientUnits", "userSpaceOnUse");
  const stopA = document.createElementNS(SVG_NS, "stop");
  stopA.setAttribute("offset", "0%");
  stopA.setAttribute("stop-color", "#b56cff");
  stopA.setAttribute("stop-opacity", "0.35");
  const stopB = document.createElementNS(SVG_NS, "stop");
  stopB.setAttribute("offset", "100%");
  stopB.setAttribute("stop-color", "#ff5fa2");
  stopB.setAttribute("stop-opacity", "1");
  gradient.append(stopA, stopB);
  defs.appendChild(gradient);

  const blur = document.createElementNS(SVG_NS, "filter");
  blur.setAttribute("id", "arrow-glow");
  blur.setAttribute("x", "-50%");
  blur.setAttribute("y", "-50%");
  blur.setAttribute("width", "200%");
  blur.setAttribute("height", "200%");
  const feBlur = document.createElementNS(SVG_NS, "feGaussianBlur");
  feBlur.setAttribute("stdDeviation", "6");
  feBlur.setAttribute("result", "blurred");
  const feMerge = document.createElementNS(SVG_NS, "feMerge");
  for (const input of ["blurred", "SourceGraphic"]) {
    const node = document.createElementNS(SVG_NS, "feMergeNode");
    node.setAttribute("in", input);
    feMerge.appendChild(node);
  }
  blur.append(feBlur, feMerge);
  defs.appendChild(blur);

  /**
   * The cast, first, because it is underneath everything.
   *
   * A ribbon and an arrowhead drawn flat at z-index 40 over a lit board are
   * stickers: nothing between them and the mat says they are above it, so an
   * arrow crossing an intervening token hid the card the player was attacking
   * *past*. A soft dark copy offset along the same 315° every other object in
   * this game casts along turns the pair into objects with air under them, and
   * it darkens whatever the head is covering rather than replacing it.
   */
  const cast = document.createElementNS(SVG_NS, "g");
  cast.setAttribute("class", "arrow-cast");
  cast.setAttribute("filter", "url(#arrow-cast-blur)");
  const castBody = document.createElementNS(SVG_NS, "path");
  const castHead = document.createElementNS(SVG_NS, "path");
  for (const node of [castBody, castHead]) {
    node.setAttribute("fill", "rgba(4,2,10,0.55)");
    cast.appendChild(node);
  }
  svg.appendChild(cast);

  const castBlur = document.createElementNS(SVG_NS, "filter");
  castBlur.setAttribute("id", "arrow-cast-blur");
  castBlur.setAttribute("x", "-50%");
  castBlur.setAttribute("y", "-50%");
  castBlur.setAttribute("width", "200%");
  castBlur.setAttribute("height", "200%");
  const castFe = document.createElementNS(SVG_NS, "feGaussianBlur");
  castFe.setAttribute("stdDeviation", "7");
  castBlur.appendChild(castFe);
  defs.appendChild(castBlur);

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("fill", "url(#arrow-gradient)");
  path.setAttribute("filter", "url(#arrow-glow)");
  path.style.opacity = "0";
  path.style.transition = "opacity 120ms ease-out";
  svg.appendChild(path);

  /**
   * The charge running up the ribbon.
   *
   * A dashed stroke along the arrow's own centre line with an animated
   * `stroke-dashoffset` — one path, one property, and the dashes travel toward
   * the target at a constant rate whatever the distance, which is what makes it
   * read as flow rather than as a marching-ants selection.
   */
  const flow = document.createElementNS(SVG_NS, "path");
  flow.setAttribute("class", "arrow-flow");
  flow.setAttribute("fill", "none");
  flow.setAttribute("stroke-linecap", "round");
  svg.appendChild(flow);

  const head = document.createElementNS(SVG_NS, "path");
  head.setAttribute("class", "arrow-head");
  head.setAttribute("fill", "#ff5fa2");
  head.setAttribute("filter", "url(#arrow-glow)");
  head.style.opacity = "0";
  head.style.transition = "opacity 120ms ease-out";
  svg.appendChild(head);

  /**
   * And the mark on the thing being pointed at.
   *
   * The board already tints a valid target, but a tint is a state and this is an
   * *aim*: it belongs to the arrow, it turns, and it goes away the instant the
   * pointer leaves. Two arcs and four ticks, rotating in opposite directions on
   * a long period, which is the reticle every game in the reference set draws
   * over the thing you are about to hit.
   */
  const reticle = document.createElementNS(SVG_NS, "g");
  reticle.setAttribute("class", "arrow-reticle");
  const spin = document.createElementNS(SVG_NS, "g");
  spin.setAttribute("class", "arrow-reticle-spin");
  for (const [radius, dash, width] of [
    [30, "26 20", 2.2],
    [21, "10 15", 1.6],
  ] as const) {
    const ring = document.createElementNS(SVG_NS, "circle");
    ring.setAttribute("r", String(radius));
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke-dasharray", dash);
    ring.setAttribute("stroke-width", String(width));
    ring.setAttribute("stroke-linecap", "round");
    ring.setAttribute("class", radius > 25 ? "arrow-reticle-outer" : "arrow-reticle-inner");
    spin.appendChild(ring);
  }
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ] as const) {
    const tick = document.createElementNS(SVG_NS, "line");
    tick.setAttribute("x1", String(dx * 34));
    tick.setAttribute("y1", String(dy * 34));
    tick.setAttribute("x2", String(dx * 41));
    tick.setAttribute("y2", String(dy * 41));
    tick.setAttribute("stroke-width", "2");
    tick.setAttribute("stroke-linecap", "round");
    tick.setAttribute("class", "arrow-reticle-tick");
    reticle.appendChild(tick);
  }
  reticle.appendChild(spin);
  reticle.style.opacity = "0";
  svg.appendChild(reticle);

  container.appendChild(svg);

  // damage preview badge (DOM, so it inherits text scaling and fonts)
  const preview = document.createElement("div");
  preview.className = "damage-preview mat-panel";
  preview.hidden = true;
  container.appendChild(preview);

  function setColors(mode: ArrowMode): void {
    const end = mode === "attack-valid" ? "#ff4d6a" : mode === "play" ? "#7dffb0" : "#ffd86b";
    const start = mode === "attack-valid" ? "#ff9a5f" : mode === "play" ? "#52c8ff" : "#b56cff";
    stopA.setAttribute("stop-color", start);
    stopB.setAttribute("stop-color", end);
    head.setAttribute("fill", end);
    flow.setAttribute("stroke", end);
    svg.style.setProperty("--arrow-key", end);
  }

  function show(from: { x: number; y: number }, to: { x: number; y: number }, mode: ArrowMode): void {
    const rect = container.getBoundingClientRect();
    const x0 = from.x - rect.left;
    const y0 = from.y - rect.top;
    const x1 = to.x - rect.left;
    const y1 = to.y - rect.top;

    setColors(mode);
    gradient.setAttribute("x1", String(x0));
    gradient.setAttribute("y1", String(y0));
    gradient.setAttribute("x2", String(x1));
    gradient.setAttribute("y2", String(y1));

    const dx = x1 - x0;
    const dy = y1 - y0;
    const distance = Math.hypot(dx, dy) || 1;
    const nx = dx / distance;
    const ny = dy / distance;
    // perpendicular, for the tapering ribbon body
    const px = -ny;
    const py = nx;

    /**
     * The bow, thrown across the attack vector rather than up the screen.
     *
     * `cy = mid - lift` was a bow only when the attack was horizontal. The two
     * rows on this mat face each other, so the overwhelming majority of attacks
     * are within a few degrees of vertical, and for those the displacement lay
     * along the line itself: the quadratic collapsed onto its own chord and the
     * ribbon drew as a straight bar. Displacing by the *unit perpendicular*
     * gives the same bow at every angle.
     *
     * The sign keeps the bow on the upper side of the line wherever there is an
     * upper side, so an arrow reads as thrown over the board rather than sagging
     * under it; for a dead-vertical attack there is no upper side and the bow
     * goes sideways, which is what a thrown ribbon does.
     */
    const lift = Math.min(distance * 0.24, 130);
    const bowSign = py > 0 ? -1 : 1;
    const cx = (x0 + x1) / 2 + px * lift * bowSign;
    const cy = (y0 + y1) / 2 + py * lift * bowSign;

    const headLength = 34;
    const tipX = x1;
    const tipY = y1;
    const baseX = x1 - nx * headLength;
    const baseY = y1 - ny * headLength;

    const startWidth = 15;
    const endWidth = 7;

    const body = [
      `M ${x0 + px * startWidth} ${y0 + py * startWidth}`,
      `Q ${cx + px * startWidth * 0.7} ${cy + py * startWidth * 0.7} ${baseX + px * endWidth} ${baseY + py * endWidth}`,
      `L ${baseX - px * endWidth} ${baseY - py * endWidth}`,
      `Q ${cx - px * startWidth * 0.7} ${cy - py * startWidth * 0.7} ${x0 - px * startWidth} ${y0 - py * startWidth}`,
      "Z",
    ].join(" ");
    path.setAttribute("d", body);

    const spine = `M ${x0} ${y0} Q ${cx} ${cy} ${baseX} ${baseY}`;
    flow.setAttribute("d", spine);

    const headWidth = 19;
    const headPath = `M ${tipX} ${tipY} L ${baseX + px * headWidth} ${baseY + py * headWidth} L ${baseX - px * headWidth} ${baseY - py * headWidth} Z`;
    head.setAttribute("d", headPath);

    // 4.4 : 7.1 is the shadow offset every surface in this game casts at — see
    // LIGHT_RIG in texture.ts. The arrow is high above the mat, so it casts far.
    castBody.setAttribute("d", body);
    castHead.setAttribute("d", headPath);
    cast.setAttribute("transform", "translate(9, 15)");

    reticle.setAttribute("transform", `translate(${x1}, ${y1})`);
    reticle.style.opacity = mode === "attack" ? "0" : "1";

    svg.classList.add("is-live");
    path.style.opacity = "1";
    head.style.opacity = "1";
  }

  function hide(): void {
    /**
     * `is-live` gates every keyframe in the stylesheet, so an arrow that is not
     * on screen is not costing the compositor a rotation and two dash offsets
     * for the rest of the match. Opacity alone would have left all four running
     * forever behind a transparent element.
     */
    svg.classList.remove("is-live");
    path.style.opacity = "0";
    head.style.opacity = "0";
    reticle.style.opacity = "0";
  }

  function showPreview(at: { x: number; y: number }, data: AttackPreview): void {
    const rect = container.getBoundingClientRect();
    const parts: string[] = [];

    if (data.shieldAbsorbs) {
      parts.push('<span class="dp-blocked">Shielded — no damage</span>');
    } else {
      parts.push(`<span class="dp-damage num">-${data.attackerDamage}</span>`);
      /**
       * The bonus mark is drawn, not typed.
       *
       * It was `▲`, which renders in whatever face the operating system has for
       * U+25B2 — a different weight and a different optical size from every
       * other mark in this HUD, and tofu on a device that has none. Module C's
       * chevron is `currentColor` at the one stroke weight the contract names.
       */
      if (data.elementalBonus) {
        parts.push(`<span class="dp-bonus">${icon("chevron-up")}Current advantage +1</span>`);
      }
      if (data.defenderDies) parts.push('<span class="dp-kill">Defeats target</span>');
    }
    if (data.defenderDamage > 0) parts.push(`<span class="dp-counter">Takes ${data.defenderDamage} back</span>`);
    if (data.attackerDies) parts.push('<span class="dp-risk">Your character dies</span>');
    if (data.lethalOnLeader) parts.push('<span class="dp-lethal">LETHAL</span>');

    preview.innerHTML = parts.join("");
    preview.hidden = false;
    preview.style.left = `${at.x - rect.left}px`;
    preview.style.top = `${at.y - rect.top - 92}px`;
  }

  function hidePreview(): void {
    preview.hidden = true;
  }

  function dispose(): void {
    svg.remove();
    preview.remove();
  }

  return { show, hide, showPreview, hidePreview, dispose };
}
