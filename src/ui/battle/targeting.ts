/**
 * The targeting arrow and damage-preview badge.
 *
 * Drawn as an SVG overlay rather than in 3D: it stays crisp at any resolution,
 * costs nothing on the GPU, and always renders on top of the board.
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

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("fill", "url(#arrow-gradient)");
  path.setAttribute("filter", "url(#arrow-glow)");
  path.style.opacity = "0";
  path.style.transition = "opacity 120ms ease-out";
  svg.appendChild(path);

  const head = document.createElementNS(SVG_NS, "path");
  head.setAttribute("fill", "#ff5fa2");
  head.setAttribute("filter", "url(#arrow-glow)");
  head.style.opacity = "0";
  head.style.transition = "opacity 120ms ease-out";
  svg.appendChild(head);

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

    // arc the arrow upward so it reads as thrown, not drawn flat
    const lift = Math.min(distance * 0.24, 130);
    const cx = (x0 + x1) / 2 + px * 0 - Math.abs(nx) * 0;
    const cy = (y0 + y1) / 2 - lift;

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

    const headWidth = 19;
    head.setAttribute(
      "d",
      `M ${tipX} ${tipY} L ${baseX + px * headWidth} ${baseY + py * headWidth} L ${baseX - px * headWidth} ${baseY - py * headWidth} Z`
    );

    path.style.opacity = "1";
    head.style.opacity = "1";
  }

  function hide(): void {
    path.style.opacity = "0";
    head.style.opacity = "0";
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
