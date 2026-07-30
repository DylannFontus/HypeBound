/**
 * Procedural iconography. Every Current and status has a distinct silhouette
 * so players can identify them without relying on colour (canon §8 interface
 * requirements + the accessibility contract).
 *
 * Each icon draws inside a unit box centred on (0,0) spanning -1..1, so the
 * caller controls placement with translate/scale.
 */

import type { CurrentId, StatusId } from "../../engine/types";

type IconFn = (ctx: CanvasRenderingContext2D) => void;

// ---------------------------------------------------------------------------
// Current icons
// ---------------------------------------------------------------------------

/** CINDER — an upward flame with an inner tongue. */
const cinder: IconFn = (ctx) => {
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.bezierCurveTo(0.55, -0.35, 0.72, 0.15, 0.4, 0.6);
  ctx.bezierCurveTo(0.22, 0.88, -0.22, 0.88, -0.4, 0.6);
  ctx.bezierCurveTo(-0.72, 0.15, -0.5, -0.3, 0, -1);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha *= 0.55;
  ctx.beginPath();
  ctx.moveTo(0, -0.25);
  ctx.bezierCurveTo(0.3, 0.1, 0.32, 0.4, 0.14, 0.6);
  ctx.bezierCurveTo(-0.02, 0.74, -0.24, 0.6, -0.22, 0.36);
  ctx.bezierCurveTo(-0.2, 0.14, -0.1, 0, 0, -0.25);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha /= 0.55;
};

/** TIDE — a droplet riding a wave crest. */
const tide: IconFn = (ctx) => {
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.bezierCurveTo(0.62, -0.24, 0.6, 0.34, 0.16, 0.5);
  ctx.bezierCurveTo(-0.24, 0.64, -0.62, 0.24, -0.42, -0.2);
  ctx.bezierCurveTo(-0.3, -0.46, -0.16, -0.7, 0, -1);
  ctx.closePath();
  ctx.fill();

  ctx.lineWidth = 0.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-0.95, 0.72);
  ctx.quadraticCurveTo(-0.5, 0.44, 0, 0.72);
  ctx.quadraticCurveTo(0.5, 1, 0.95, 0.72);
  ctx.stroke();
};

/** ROOT — a seed inside a hexagonal shell with two shoots. */
const root: IconFn = (ctx) => {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const px = Math.cos(a) * 0.95;
    const py = Math.sin(a) * 0.95;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.lineWidth = 0.17;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, 0.62);
  ctx.lineTo(0, -0.1);
  ctx.lineWidth = 0.16;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, -0.06);
  ctx.quadraticCurveTo(0.42, -0.16, 0.46, -0.56);
  ctx.quadraticCurveTo(0.06, -0.5, 0, -0.06);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, 0.14);
  ctx.quadraticCurveTo(-0.4, 0.04, -0.44, -0.34);
  ctx.quadraticCurveTo(-0.05, -0.3, 0, 0.14);
  ctx.closePath();
  ctx.fill();
};

/** GALE — three swept motion lines curling to the right. */
const gale: IconFn = (ctx) => {
  ctx.lineWidth = 0.19;
  ctx.lineCap = "round";
  const sweep = (y: number, len: number, curl: number): void => {
    ctx.beginPath();
    ctx.moveTo(-0.95, y);
    ctx.lineTo(len - 0.28, y);
    ctx.arc(len - 0.28, y - curl, curl, Math.PI / 2, -Math.PI / 2, true);
    ctx.stroke();
  };
  sweep(-0.52, 0.7, 0.26);
  sweep(0.02, 1.0, 0.32);
  sweep(0.56, 0.55, 0.22);
};

/** PULSE — a lightning bolt. */
const pulse: IconFn = (ctx) => {
  ctx.beginPath();
  ctx.moveTo(0.24, -1);
  ctx.lineTo(-0.62, 0.12);
  ctx.lineTo(-0.06, 0.12);
  ctx.lineTo(-0.28, 1);
  ctx.lineTo(0.66, -0.18);
  ctx.lineTo(0.08, -0.18);
  ctx.closePath();
  ctx.fill();
};

/** HALO — a ring with radiating spokes. */
const halo: IconFn = (ctx) => {
  ctx.lineWidth = 0.18;
  ctx.beginPath();
  ctx.arc(0, 0, 0.52, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineCap = "round";
  ctx.lineWidth = 0.14;
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    const inner = 0.72;
    const outer = i % 2 === 0 ? 1 : 0.88;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    ctx.stroke();
  }
};

/** VEIL — a masked crescent with a slit eye. */
const veil: IconFn = (ctx) => {
  ctx.beginPath();
  ctx.arc(0, 0, 0.92, Math.PI * 0.32, Math.PI * 1.68);
  ctx.arc(0.38, 0, 0.78, Math.PI * 1.62, Math.PI * 0.38, true);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(-0.18, 0, 0.3, 0.14, 0, 0, Math.PI * 2);
  ctx.closePath();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
};

/** PRISM — a triangle splitting a beam into three. */
const prism: IconFn = (ctx) => {
  ctx.lineWidth = 0.17;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(0, -0.86);
  ctx.lineTo(0.82, 0.62);
  ctx.lineTo(-0.82, 0.62);
  ctx.closePath();
  ctx.stroke();

  ctx.lineCap = "round";
  ctx.lineWidth = 0.13;
  ctx.beginPath();
  ctx.moveTo(-1, -0.2);
  ctx.lineTo(-0.3, -0.2);
  ctx.stroke();
  for (const dy of [-0.34, 0.02, 0.38]) {
    ctx.beginPath();
    ctx.moveTo(0.26, 0.02);
    ctx.lineTo(1, dy);
    ctx.stroke();
  }
};

const CURRENT_ICONS: Record<CurrentId, IconFn> = { cinder, tide, root, gale, pulse, halo, veil, prism };

/** Draw a Current icon centred at (cx, cy) with the given radius. */
export function drawCurrentIcon(
  ctx: CanvasRenderingContext2D,
  current: CurrentId,
  cx: number,
  cy: number,
  radius: number,
  color: string
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(radius, radius);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  CURRENT_ICONS[current](ctx);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Status icons — each has a distinct outline, never colour-only
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<StatusId, IconFn> = {
  scorched: cinder,
  shielded: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(0, -0.95);
    ctx.lineTo(0.8, -0.5);
    ctx.lineTo(0.8, 0.25);
    ctx.quadraticCurveTo(0.8, 0.8, 0, 1);
    ctx.quadraticCurveTo(-0.8, 0.8, -0.8, 0.25);
    ctx.lineTo(-0.8, -0.5);
    ctx.closePath();
    ctx.fill();
  },
  armor: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(-0.85, -0.55);
    ctx.lineTo(0.85, -0.55);
    ctx.lineTo(0.85, 0.2);
    ctx.lineTo(0, 0.9);
    ctx.lineTo(-0.85, 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillRect(-0.12, -0.55, 0.24, 1.1);
    ctx.globalCompositeOperation = "source-over";
  },
  cancelled: (ctx) => {
    ctx.lineWidth = 0.2;
    ctx.beginPath();
    ctx.arc(0, 0, 0.78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-0.5, -0.5);
    ctx.lineTo(0.5, 0.5);
    ctx.stroke();
  },
  lurking: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(0, -0.95);
    ctx.quadraticCurveTo(0.85, -0.5, 0.72, 0.5);
    ctx.quadraticCurveTo(0.4, 0.95, 0, 0.95);
    ctx.quadraticCurveTo(-0.4, 0.95, -0.72, 0.5);
    ctx.quadraticCurveTo(-0.85, -0.5, 0, -0.95);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.ellipse(0, 0.24, 0.42, 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  },
  warded: (ctx) => {
    ctx.lineWidth = 0.19;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(0, -0.92);
    ctx.lineTo(0.82, 0);
    ctx.lineTo(0, 0.92);
    ctx.lineTo(-0.82, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -0.4);
    ctx.lineTo(0.36, 0);
    ctx.lineTo(0, 0.4);
    ctx.lineTo(-0.36, 0);
    ctx.closePath();
    ctx.fill();
  },
  weakened: (ctx) => {
    ctx.lineWidth = 0.22;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const dy of [-0.4, 0.25]) {
      ctx.beginPath();
      ctx.moveTo(-0.62, dy);
      ctx.lineTo(0, dy + 0.5);
      ctx.lineTo(0.62, dy);
      ctx.stroke();
    }
  },
  empowered: (ctx) => {
    ctx.lineWidth = 0.22;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const dy of [0.4, -0.25]) {
      ctx.beginPath();
      ctx.moveTo(-0.62, dy);
      ctx.lineTo(0, dy - 0.5);
      ctx.lineTo(0.62, dy);
      ctx.stroke();
    }
  },
  cursed: (ctx) => {
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const px = Math.cos(a) * 0.9;
      const py = Math.sin(a) * 0.9;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.44, 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  banished: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(-0.1, 0.9);
    ctx.quadraticCurveTo(-0.9, 0.3, -0.2, -0.75);
    ctx.quadraticCurveTo(0.7, -0.2, -0.1, 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 0.14;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0.3, 0.35);
    ctx.lineTo(0.95, -0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0.95, -0.3);
    ctx.lineTo(0.55, -0.3);
    ctx.moveTo(0.95, -0.3);
    ctx.lineTo(0.95, 0.1);
    ctx.stroke();
  },
};

export function drawStatusIcon(
  ctx: CanvasRenderingContext2D,
  status: StatusId,
  cx: number,
  cy: number,
  radius: number,
  color: string
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(radius, radius);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  STATUS_ICONS[status](ctx);
  ctx.restore();
}

/** Simple faction crest: a ringed monogram, distinct per faction by petal count. */
export function drawFactionCrest(
  ctx: CanvasRenderingContext2D,
  factionIndex: number,
  cx: number,
  cy: number,
  radius: number,
  color: string
): void {
  const petals = 3 + (factionIndex % 8);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = radius * 0.16;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.86, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < petals; i++) {
    const a = ((Math.PI * 2) / petals) * i - Math.PI / 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * radius * 0.46, Math.sin(a) * radius * 0.46, radius * 0.22, radius * 0.12, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
