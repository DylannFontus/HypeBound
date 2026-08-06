/**
 * Read the stylesheets the way a browser does, so a test can disagree with a
 * comment.
 *
 * Three of the four guards in this directory have to answer questions about the
 * theme that no amount of `grep` can answer honestly. "Is every material's ink
 * legible on its own plate?" needs the custom-property graph resolved, the alpha
 * composited and the WCAG maths run. "Is every gradient lit from 315°?" needs
 * `calc(var(--light-sweep, 135deg) + 90deg)` evaluated to a number, because a
 * regular expression looking for `315deg` reads that as compliant and it is 225.
 *
 * Both of those questions have already been answered wrongly in this repository
 * by a test that pattern-matched instead of parsing, so this module exists to
 * stop the next one doing it again. It is deliberately small and deliberately
 * literal: no CSS engine, no cascade, no specificity. What it gives you is the
 * declarations as authored, grouped by the block they were authored in, with the
 * comments kept as data rather than thrown away — because "carries a comment
 * justifying the difference" is one of the rules being enforced, and a stripped
 * comment cannot be checked.
 *
 * ## The one thing that is genuinely subtle
 *
 * Comments are removed by **blanking**, not by deletion: every character inside
 * `/* … *​/` becomes a space and every newline survives. That keeps byte offsets
 * and line numbers identical between the raw source and the parsed source, which
 * is what lets a failure message say `foundation.css:591` and be right. It also
 * means a brace or a semicolon written inside prose — and this codebase writes a
 * great deal of prose — cannot derail the parser.
 */

// ---------------------------------------------------------------------------
// source text
// ---------------------------------------------------------------------------

/**
 * Comment bodies replaced by spaces, newlines preserved.
 *
 * Offsets and line numbers are therefore identical to the input, which every
 * caller below relies on.
 */
export function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
}

export interface CssComment {
  /** the text between the delimiters, whitespace collapsed */
  readonly text: string;
  /** byte offset of the `/*` */
  readonly start: number;
  /** byte offset just past the `*​/` */
  readonly end: number;
  readonly startLine: number;
  readonly endLine: number;
}

export function comments(source: string): CssComment[] {
  const out: CssComment[] = [];
  const re = /\/\*[\s\S]*?\*\//g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    out.push({
      text: match[0].slice(2, -2).replace(/\s+/g, " ").trim(),
      start: match.index,
      end: match.index + match[0].length,
      startLine: lineOf(source, match.index),
      endLine: lineOf(source, match.index + match[0].length),
    });
  }
  return out;
}

/** 1-indexed line number of a byte offset. */
export function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) if (source[i] === "\n") line += 1;
  return line;
}

// ---------------------------------------------------------------------------
// blocks and declarations
// ---------------------------------------------------------------------------

export interface CssDeclaration {
  readonly prop: string;
  readonly value: string;
  /** byte offset of the first character of the property name */
  readonly offset: number;
  readonly line: number;
}

export interface CssBlock {
  /** everything between the previous `{`/`}`/`;` and this block's `{` */
  readonly prelude: string;
  /** the prelude split on top-level commas */
  readonly selectors: readonly string[];
  /** enclosing preludes, outermost first — `@media …`, `@supports …` */
  readonly ancestors: readonly string[];
  readonly declarations: readonly CssDeclaration[];
  readonly line: number;
}

/**
 * Every `{ … }` in the sheet, with the declarations written directly inside it.
 *
 * A block that contains nested blocks (an `@media`) reports only its own loose
 * declarations, and the nested ones appear as their own entries carrying it in
 * `ancestors`. Strings and parentheses are tracked so that a `;` inside a
 * `data:` URI or a `{` inside `content: "…"` is not mistaken for structure.
 */
export function blocks(source: string): CssBlock[] {
  const css = blankComments(source);
  const out: CssBlock[] = [];
  const stack: { block: CssBlock; declarations: CssDeclaration[] }[] = [];

  let buffer = "";
  let bufferStart = 0;
  let paren = 0;
  let quote: string | null = null;

  const flushDeclaration = (): void => {
    const text = buffer.trim();
    buffer = "";
    if (text === "") return;
    const colon = text.indexOf(":");
    if (colon === -1) return;
    const top = stack[stack.length - 1];
    if (top === undefined) return; // an at-statement at file scope, e.g. @import
    const leading = buffer.length; // always 0 here; kept for clarity
    void leading;
    top.declarations.push({
      prop: text.slice(0, colon).trim(),
      value: text.slice(colon + 1).trim(),
      offset: bufferStart,
      line: lineOf(css, bufferStart),
    });
  };

  for (let i = 0; i < css.length; i += 1) {
    const c = css[i] as string;

    if (quote !== null) {
      buffer += c;
      if (c === "\\") {
        const next = css[i + 1];
        if (next !== undefined) {
          buffer += next;
          i += 1;
        }
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }

    if (c === '"' || c === "'") {
      quote = c;
      buffer += c;
      continue;
    }

    if (c === "(") paren += 1;
    if (c === ")") paren = Math.max(0, paren - 1);

    if (paren > 0) {
      buffer += c;
      continue;
    }

    if (c === "{") {
      const prelude = buffer.trim();
      const declarations: CssDeclaration[] = [];
      const block: CssBlock = {
        prelude,
        selectors: prelude
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== ""),
        ancestors: stack.map((entry) => entry.block.prelude),
        declarations,
        line: lineOf(css, i),
      };
      out.push(block);
      stack.push({ block, declarations });
      buffer = "";
      bufferStart = i + 1;
      continue;
    }

    if (c === ";") {
      flushDeclaration();
      bufferStart = i + 1;
      continue;
    }

    if (c === "}") {
      flushDeclaration();
      stack.pop();
      buffer = "";
      bufferStart = i + 1;
      continue;
    }

    if (buffer === "" && /\s/.test(c)) {
      bufferStart = i + 1;
      continue;
    }
    buffer += c;
  }

  return out;
}

/**
 * The custom properties a set of blocks declares, last writer winning.
 *
 * That is not the cascade — it ignores specificity entirely — and it is the
 * right model for the two callers here, both of which hand over an explicit,
 * ordered list of the blocks they mean.
 */
export function customProperties(chosen: readonly CssBlock[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of chosen) {
    for (const declaration of block.declarations) {
      if (declaration.prop.startsWith("--")) out[declaration.prop] = declaration.value;
    }
  }
  return out;
}

/** Blocks whose selector list contains `selector` exactly, in source order. */
export function blocksFor(all: readonly CssBlock[], selector: string): CssBlock[] {
  return all.filter((block) => block.selectors.includes(selector));
}

/**
 * Substitute `var()` until nothing is left to substitute.
 *
 * Fallbacks are honoured, which matters more here than it looks: module B
 * injects `--tex-grain-*` at boot and module A writes every use site as
 * `var(--tex-grain-mid, none)`, so a resolver that ignored fallbacks would
 * report half the sheet as empty.
 */
export function resolveVars(scope: Readonly<Record<string, string>>, value: string, depth = 0): string {
  if (depth > 16 || !value.includes("var(")) return value;
  let out = "";
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf("var(", i);
    if (at === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, at);
    // find the matching close paren
    let depthCount = 1;
    let j = at + 4;
    for (; j < value.length && depthCount > 0; j += 1) {
      if (value[j] === "(") depthCount += 1;
      else if (value[j] === ")") depthCount -= 1;
    }
    const inner = value.slice(at + 4, j - 1);
    const comma = topLevelSplit(inner, ",");
    const name = (comma[0] ?? "").trim();
    const fallback = comma.slice(1).join(",").trim();
    const declared = scope[name];
    if (declared !== undefined) out += resolveVars(scope, declared, depth + 1);
    else if (fallback !== "") out += resolveVars(scope, fallback, depth + 1);
    i = j;
  }
  return resolveVars(scope, out, depth + 1);
}

/** Split on a separator that is not inside parentheses or quotes. */
export function topLevelSplit(text: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quote !== null) {
      current += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      continue;
    }
    if (c === "(") depth += 1;
    if (c === ")") depth -= 1;
    if (c === separator && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  out.push(current);
  return out;
}

// ---------------------------------------------------------------------------
// colour
// ---------------------------------------------------------------------------

/** Straight (non-premultiplied) sRGB, channels 0–255, alpha 0–1. */
export type Rgba = readonly [number, number, number, number];

const NAMED: Readonly<Record<string, Rgba>> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
};

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` in either syntax, `color-mix(in srgb, …)`. */
export function parseColour(text: string): Rgba | null {
  const value = text.trim();
  if (value === "") return null;

  const named = NAMED[value.toLowerCase()];
  if (named !== undefined) return named;

  const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (hex !== null) {
    const digits = hex[1] as string;
    const pair = (n: number): number =>
      digits.length <= 4
        ? parseInt((digits[n] as string) + (digits[n] as string), 16)
        : parseInt(digits.slice(n * 2, n * 2 + 2), 16);
    if (digits.length === 3 || digits.length === 6) return [pair(0), pair(1), pair(2), 1];
    if (digits.length === 4 || digits.length === 8) return [pair(0), pair(1), pair(2), pair(3) / 255];
    return null;
  }

  const rgb = /^rgba?\(([\s\S]*)\)$/i.exec(value);
  if (rgb !== null) {
    const body = (rgb[1] as string).trim();
    const parts = body
      .split(/[\s,/]+/)
      .filter((p) => p !== "")
      .map((p) => (p.endsWith("%") ? Number(p.slice(0, -1)) : Number(p)));
    const pct = body.split(/[\s,/]+/).filter((p) => p !== "");
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    const chan = (n: number): number =>
      (pct[n] as string).endsWith("%") ? ((parts[n] as number) / 100) * 255 : (parts[n] as number);
    const alphaRaw = parts[3];
    const alpha =
      alphaRaw === undefined ? 1 : (pct[3] as string).endsWith("%") ? alphaRaw / 100 : alphaRaw;
    return [chan(0), chan(1), chan(2), alpha];
  }

  const mix = /^color-mix\(\s*in\s+srgb\s*,([\s\S]*)\)$/i.exec(value);
  if (mix !== null) {
    const [aRaw, bRaw] = topLevelSplit(mix[1] as string, ",");
    if (aRaw === undefined || bRaw === undefined) return null;
    const share = (raw: string): { colour: Rgba | null; weight: number | null } => {
      const percent = /(-?[0-9.]+)%\s*$/.exec(raw.trim());
      const colour = parseColour(percent === null ? raw : raw.trim().slice(0, percent.index));
      return { colour, weight: percent === null ? null : Number(percent[1]) / 100 };
    };
    const a = share(aRaw);
    const b = share(bRaw);
    const first = a.colour;
    const second = b.colour;
    if (first === null || second === null) return null;
    const wa = a.weight ?? (b.weight === null ? 0.5 : 1 - b.weight);
    const wb = b.weight ?? 1 - wa;
    const total = wa + wb || 1;
    const blend = (x: number, y: number): number => (x * wa + y * wb) / total;
    return [
      blend(first[0], second[0]),
      blend(first[1], second[1]),
      blend(first[2], second[2]),
      blend(first[3], second[3]),
    ];
  }

  return null;
}

/** Source-over: `fg` painted on top of an opaque `bg`. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

export function relativeLuminance(colour: Rgba): number {
  const channel = (v: number): number => {
    const c = Math.min(255, Math.max(0, v)) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2]);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface GradientStop {
  readonly colour: Rgba;
  /** 0–1 along the gradient line, or null where the author left it implicit */
  readonly position: number | null;
}

/**
 * A gradient's colour stops with their declared positions.
 *
 * Only percentage positions are read. A stop placed in pixels depends on the
 * size of the box and cannot be resolved from the stylesheet, so it comes back
 * as `null` and is treated as implicit — which is the safe direction, since an
 * implicit stop is spaced evenly rather than assumed to be somewhere useful.
 */
export function gradientStopList(value: string): GradientStop[] {
  const fn = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(([\s\S]*)\)$/i.exec(value.trim());
  if (fn === null) return [];
  const out: GradientStop[] = [];
  for (const argument of topLevelSplit(fn[1] as string, ",")) {
    const text = argument.trim();
    const positions = [...text.matchAll(/(-?[0-9.]+)%(?=\s*$|\s+-?[0-9.]+%\s*$)/g)].map((m) => Number(m[1]) / 100);
    const stripped = text.replace(/(\s+-?[0-9.]+(?:%|px|deg|turn|rad|grad))+$/g, "");
    const colour = parseColour(stripped);
    if (colour === null) continue;
    // `<colour> 40% 60%` is a hard stop: the same colour at two positions.
    if (positions.length === 0) out.push({ colour, position: null });
    else for (const position of positions) out.push({ colour, position });
  }
  return out;
}

/** Every colour a gradient takes at one of its stops, in order. */
export function gradientStops(value: string): Rgba[] {
  return gradientStopList(value).map((stop) => stop.colour);
}

/**
 * The colour at `t` (0–1) along a gradient line.
 *
 * Implicit positions are filled in the way CSS fills them: the first is 0, the
 * last is 1, and a run of unpositioned stops is spaced evenly between its
 * positioned neighbours. This exists because sampling a three-stop gradient by
 * averaging its ends is wrong in a way that matters — `--fill-hero` puts its
 * darkest colour at 48%, so the middle of that plate, which is where a label
 * sits, is nowhere near the mean of the two ends.
 */
export function sampleGradient(stops: readonly GradientStop[], t: number): Rgba | null {
  if (stops.length === 0) return null;
  const positions: number[] = stops.map((stop) => stop.position ?? Number.NaN);
  if (Number.isNaN(positions[0])) positions[0] = 0;
  if (Number.isNaN(positions[positions.length - 1] as number)) positions[positions.length - 1] = 1;
  for (let i = 1; i < positions.length - 1; i += 1) {
    if (!Number.isNaN(positions[i] as number)) continue;
    let end = i;
    while (end < positions.length && Number.isNaN(positions[end] as number)) end += 1;
    const before = positions[i - 1] as number;
    const after = positions[end] as number;
    for (let k = i; k < end; k += 1) positions[k] = before + ((after - before) * (k - i + 1)) / (end - i + 1);
    i = end - 1;
  }
  // CSS clamps a stop that runs backwards to its predecessor.
  for (let i = 1; i < positions.length; i += 1) {
    positions[i] = Math.max(positions[i] as number, positions[i - 1] as number);
  }

  if (t <= (positions[0] as number)) return (stops[0] as GradientStop).colour;
  for (let i = 1; i < stops.length; i += 1) {
    const a = positions[i - 1] as number;
    const b = positions[i] as number;
    if (t > b) continue;
    const from = (stops[i - 1] as GradientStop).colour;
    const to = (stops[i] as GradientStop).colour;
    const k = b === a ? 1 : (t - a) / (b - a);
    const step = (x: number, y: number): number => x + (y - x) * k;
    return [step(from[0], to[0]), step(from[1], to[1]), step(from[2], to[2]), step(from[3], to[3])];
  }
  return (stops[stops.length - 1] as GradientStop).colour;
}

// ---------------------------------------------------------------------------
// angles
// ---------------------------------------------------------------------------

const ANGLE_UNITS: Readonly<Record<string, number>> = {
  deg: 1,
  grad: 0.9,
  rad: 180 / Math.PI,
  turn: 360,
};

/**
 * A CSS angle expression as a number of degrees in `[0, 360)`, or null.
 *
 * Handles what the theme actually writes: a bare angle, a `var()` chain that
 * resolves to one, and `calc()` over a sum or difference of them. Anything it
 * cannot reduce to a single number returns `null` and the caller must treat that
 * as *unknown*, never as *fine* — an unparsed angle is exactly the shape of the
 * defect this exists to catch.
 */
export function evaluateAngle(expression: string, scope: Readonly<Record<string, string>> = {}): number | null {
  const resolved = resolveVars(scope, expression).trim();
  const body = /^calc\(([\s\S]*)\)$/i.exec(resolved);
  const text = (body === null ? resolved : (body[1] as string)).trim();

  const terms = [...text.matchAll(/([+-])?\s*(-?[0-9.]+)(deg|grad|rad|turn)\b/gi)];
  if (terms.length === 0) return null;

  // Anything that is not a term, an operator or whitespace means this is an
  // expression we do not model — a multiplication by a variable, for instance.
  const residue = text.replace(/([+-])?\s*(-?[0-9.]+)(deg|grad|rad|turn)\b/gi, "").replace(/[\s+\-()]/g, "");
  if (residue !== "") return null;

  let total = 0;
  for (const term of terms) {
    const sign = term[1] === "-" ? -1 : 1;
    const unit = ANGLE_UNITS[(term[3] as string).toLowerCase()];
    if (unit === undefined) return null;
    total += sign * Number(term[2]) * unit;
  }
  return ((total % 360) + 360) % 360;
}
