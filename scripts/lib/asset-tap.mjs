/**
 * The paint tap. Two plain functions, handed to Playwright as functions rather
 * than as source strings — a string of JavaScript inside a template literal has
 * to survive two levels of backslash escaping, and the first version of this
 * file silently lost a regex to exactly that.
 */

/** Installed before any app code runs. Records every asset that reaches a pixel. */
export function installTap() {
  if (window.__hbTap) return;

  const KEY = (url) => {
    if (typeof url !== "string" || !url) return null;
    let u = url;
    const q = u.indexOf("?");
    if (q >= 0) u = u.slice(0, q);
    const h = u.indexOf("#");
    if (h >= 0) u = u.slice(0, h);
    const i = u.indexOf("/assets/");
    if (i < 0) return null;
    return u.slice(i + 1).replace(/\.(png|webp|jpe?g|avif|gif|svg)$/i, "");
  };

  /** canvas -> { keys:Set, pure:boolean } — what this surface carries. */
  const carries = new WeakMap();
  /** canvas -> Set<canvas> it has been drawn into, so a chain can be walked. */
  const parents = new WeakMap();

  const tap = {
    /**
     * One entry per *direct* paint of an asset: the source was the file itself,
     * or a surface that is nothing but a resample of the file.
     */
    direct: [],
    /** Textures uploaded straight to the GPU — three.js never touches a 2D context. */
    gl: [],
    carries,
    parents,
  };
  window.__hbTap = tap;

  const sourceInfo = (source) => {
    if (!source) return null;
    if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
      const key = KEY(source.currentSrc || source.src);
      return key ? { keys: [key], pure: true } : null;
    }
    const held = carries.get(source);
    return held ? { keys: [...held.keys], pure: held.pure } : null;
  };

  const proto = CanvasRenderingContext2D.prototype;
  const originalDrawImage = proto.drawImage;
  proto.drawImage = function (source, ...rest) {
    let info = null;
    try {
      info = sourceInfo(source);
    } catch {
      info = null;
    }
    if (info && info.keys.length) {
      const dest = this.canvas;

      let dx = 0;
      let dy = 0;
      let dw = 0;
      let dh = 0;
      const naturalW = source.naturalWidth || source.width || 0;
      const naturalH = source.naturalHeight || source.height || 0;
      if (rest.length <= 2) {
        dx = rest[0] || 0;
        dy = rest[1] || 0;
        dw = naturalW;
        dh = naturalH;
      } else if (rest.length <= 4) {
        dx = rest[0] || 0;
        dy = rest[1] || 0;
        dw = rest[2] || 0;
        dh = rest[3] || 0;
      } else {
        dx = rest[4] || 0;
        dy = rest[5] || 0;
        dw = rest[6] || 0;
        dh = rest[7] || 0;
      }

      let sx = 1;
      let sy = 1;
      let ox = 0;
      let oy = 0;
      try {
        const m = this.getTransform ? this.getTransform() : null;
        if (m) {
          sx = m.a;
          sy = m.d;
          ox = m.e;
          oy = m.f;
        }
      } catch {
        /* a context without getTransform; unscaled is the right guess */
      }
      const w = Math.abs(dw * sx);
      const h = Math.abs(dh * sy);

      /**
       * A surface is a *pure* carrier when the paint covered it edge to edge.
       *
       * That is exactly what `texture.ts::scaledAsset` builds — a chain of
       * halvings, each one a full-surface `drawImage` — so a mip is
       * indistinguishable from the file for the purpose of "was this painted".
       * A card canvas takes the same icon into a 20px corner of a 512px surface
       * and is emphatically not the same thing: its rect is the card's, not the
       * icon's, and reporting it would answer "how big is the crest on screen"
       * with the size of the card it sits on.
       */
      const fills = w >= (dest.width || 1) * 0.98 && h >= (dest.height || 1) * 0.98;
      const pure = Boolean(info.pure && fills);

      let held = carries.get(dest);
      if (!held) {
        held = { keys: new Set(), pure };
        carries.set(dest, held);
      } else if (!pure) {
        held.pure = false;
      }
      for (const key of info.keys) held.keys.add(key);

      if (info.pure) {
        // The asset itself landing somewhere. This is the paint that counts.
        for (const key of info.keys) {
          tap.direct.push({ key, canvas: dest, x: dx * sx + ox, y: dy * sy + oy, w, h, fills });
        }
      }
      if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
        /**
         * The edge carries its own scale, measured, rather than the ratio of the
         * two backing stores.
         *
         * Guessing from backing sizes is right only for a whole-surface blit,
         * and the interesting hop here is not one: `placeholderArt::crestStamp`
         * paints a 157px stamp into a 512px card, and a backing-size guess turns
         * a 10px crest into a 167px one — a card-sized answer to a question about
         * an icon. The draw knows the real ratio; it is recorded here.
         */
        let sourceParents = parents.get(source);
        if (!sourceParents) {
          sourceParents = [];
          parents.set(source, sourceParents);
        }
        sourceParents.push({ dest, sx: w / (source.width || 1), sy: h / (source.height || 1) });
      }
    }
    return originalDrawImage.apply(this, arguments);
  };

  for (const ctor of [
    typeof WebGLRenderingContext !== "undefined" ? WebGLRenderingContext : null,
    typeof WebGL2RenderingContext !== "undefined" ? WebGL2RenderingContext : null,
  ]) {
    if (!ctor) continue;
    /**
     * Both upload calls, and the second one is the one that mattered.
     *
     * three.js takes the `texStorage2D` + `texSubImage2D` path on a WebGL2
     * context, which is every context this game creates. A tap that hooked only
     * `texImage2D` therefore reported the battle backdrop as *never uploaded* —
     * while the backdrop was plainly there in the screenshot. Instrument
     * fifteen, caught by a control: the picture said yes and the probe said no.
     */
    for (const name of ["texImage2D", "texSubImage2D"]) {
      const original = ctor.prototype[name];
      if (!original) continue;
      ctor.prototype[name] = function (...args) {
        try {
          const last = args[args.length - 1];
          const info = sourceInfo(last);
          if (info) {
            for (const key of info.keys) {
              tap.gl.push({ key, w: last.naturalWidth || last.width || 0, h: last.naturalHeight || last.height || 0 });
            }
          }
        } catch {
          /* an upload from an ArrayBuffer; nothing to attribute */
        }
        return original.apply(this, args);
      };
    }
  }
}

/** Read the tap back, and scan the live DOM for the assets CSS paints. */
export function readTap() {
  const KEY = (url) => {
    if (typeof url !== "string" || !url) return null;
    let u = url;
    const q = u.indexOf("?");
    if (q >= 0) u = u.slice(0, q);
    const h = u.indexOf("#");
    if (h >= 0) u = u.slice(0, h);
    const i = u.indexOf("/assets/");
    if (i < 0) return null;
    return u.slice(i + 1).replace(/\.(png|webp|jpe?g|avif|gif|svg)$/i, "");
  };

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  /** null when the element paints nothing a player could see. */
  const shown = (el) => {
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return null;
    let node = el;
    let alpha = 1;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      if (cs.display === "none" || cs.visibility === "hidden") return null;
      alpha *= parseFloat(cs.opacity || "1");
      node = node.parentElement;
    }
    if (alpha < 0.02) return null;
    return { w: r.width, h: r.height, x: r.left, y: r.top };
  };

  const out = {};
  const entry = (key) => {
    if (!out[key]) out[key] = { painted: 0, onScreen: 0, css: 0, cssOnScreen: 0, img: 0, gl: 0, boxes: [] };
    return out[key];
  };

  const tap = window.__hbTap;
  if (tap) {
    /**
     * A card canvas is drawn into the cell that shows it, which is drawn into
     * nothing else — so "is this on screen" is a walk up the chain of surfaces,
     * not a question about the one the icon landed on. The scale of every hop is
     * carried with it, so what comes back is the icon's size in CSS pixels on
     * the screen a player is looking at rather than in the coordinate space of
     * whichever offscreen surface happened to receive the paint.
     */
    const reach = (canvas, scaleX, scaleY, seen) => {
      if (!canvas || seen.has(canvas)) return null;
      seen.add(canvas);
      const box = shown(canvas);
      if (box) {
        return { sx: scaleX * (box.w / (canvas.width || 1)), sy: scaleY * (box.h / (canvas.height || 1)) };
      }
      const up = tap.parents.get(canvas);
      if (!up) return null;
      for (const edge of up) {
        const hop = reach(edge.dest, scaleX * edge.sx, scaleY * edge.sy, seen);
        if (hop) return hop;
      }
      return null;
    };

    for (const d of tap.direct) {
      const e = entry(d.key);
      e.painted++;
      const hit = reach(d.canvas, 1, 1, new Set());
      if (hit) {
        e.onScreen++;
        e.boxes.push({ w: d.w * hit.sx, h: d.h * hit.sy, how: "canvas" });
      }
    }
    /**
     * A texture upload counts as on screen, and the caveat is stated here.
     *
     * The battle board is a three.js scene: its backdrop and every card face on
     * the mat reach the player as a GPU texture and never as a 2D surface in
     * the document, so the walk above cannot see them and reports zero. The
     * screenshot plainly shows both. Counting the upload is the correction —
     * and it is a *weaker* claim than the 2D one, because a texture can belong
     * to an object behind the camera. It is recorded separately for that
     * reason: `gl` never masquerades as `onScreen`.
     */
    for (const g of tap.gl) {
      const e = entry(g.key);
      e.gl++;
      e.boxes.push({ w: g.w, h: g.h, how: "webgl" });
    }
  }

  const props = ["backgroundImage", "maskImage", "webkitMaskImage", "borderImageSource", "content", "listStyleImage"];
  const DOUBLE = String.fromCharCode(34);
  const SINGLE = String.fromCharCode(39);
  const urlsIn = (value) => {
    const found = [];
    let from = 0;
    for (;;) {
      const open = value.indexOf("url(", from);
      if (open < 0) break;
      const close = value.indexOf(")", open + 4);
      if (close < 0) break;
      from = close + 1;
      let raw = value.slice(open + 4, close).trim();
      const first = raw.charAt(0);
      if (raw.length > 1 && (first === DOUBLE || first === SINGLE)) raw = raw.slice(1, -1);
      found.push(raw);
    }
    return found;
  };

  const scan = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo || undefined);
    for (const prop of props) {
      const value = cs[prop];
      if (!value || value === "none") continue;
      for (const url of urlsIn(value)) {
        const key = KEY(url);
        if (!key) continue;
        const e = entry(key);
        e.css++;
        const box = shown(el);
        if (box) {
          e.cssOnScreen++;
          e.boxes.push({
            w: box.w,
            h: box.h,
            how: pseudo ? `css${pseudo}` : "css",
            host: String(el.className || el.tagName).slice(0, 40),
          });
        }
      }
    }
  };

  for (const el of document.querySelectorAll("*")) {
    scan(el, null);
    scan(el, "::before");
    scan(el, "::after");
    if (el.tagName === "IMG") {
      const key = KEY(el.currentSrc || el.src);
      if (key) {
        const e = entry(key);
        e.img++;
        const box = shown(el);
        if (box) {
          e.onScreen++;
          e.boxes.push({ w: box.w, h: box.h, how: "img", host: String(el.className || "img").slice(0, 40) });
        }
      }
    }
  }

  return { assets: out, rootClasses: [...document.documentElement.classList].filter((c) => c.startsWith("has-")) };
}
