/**
 * Nothing the server imports may be a Vite feature, and nothing it imports may
 * come from the client's half of the tree.
 *
 * The engine runs in two places now, and only one of them is a browser inside a
 * Vite build. Two hazards follow, and they fail differently:
 *
 * 1. **`import.meta.glob` does not throw on workerd.** It is a property access
 *    on an object that has no such property, so it evaluates to `undefined`, and
 *    the failure downstream is a match dealt from an empty card pool rather than
 *    a stack trace. `src/engine/dataFiles.ts` removed the two that existed; this
 *    stops the third from being added.
 * 2. **A reach into `src/ui` or `src/game` compiles perfectly.** It just drags
 *    three.js and the DOM into a Workers bundle, where the first is dead weight
 *    against the script-size limit and the second does not exist.
 *
 * Neither is caught by the root typecheck. The *browser globals* question is
 * caught, and caught exactly, by `server/tsconfig.json` — it compiles the engine
 * a second time with no DOM in `lib` — so this file deliberately does not
 * re-litigate it with regexes. A weaker duplicate of a compiler check is worth
 * less than nothing, because it eventually cries wolf and gets deleted.
 *
 * This walks the real import graph from the server's entry points instead of
 * grepping a directory, because the claim is about what is *reachable*, not
 * about what happens to sit in a folder.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Where the walk starts: everything the Workers bundle can reach. */
const ENTRY_POINTS = ["server/src/shared/engine.ts", "server/src/worker.ts"];

/**
 * Directories the server's graph is allowed to touch.
 *
 * `src/net` is in because the wire protocol is shared by both ends by design
 * (§7). `src/ui`, `src/game` and `src/save` are out: they are the client.
 */
const ALLOWED_PREFIXES = ["server/src/", "src/engine/", "src/net/", "data/"];

/**
 * Bare (non-relative) imports the worker bundle may contain, each with the
 * reason it is allowed.
 *
 * A justification of at least forty characters, because a one-word one is not a
 * reason — the convention has already caught four placeholder entries elsewhere
 * in this suite.
 */
const ALLOWED_PACKAGES: Record<string, string> = {
  zod: "the wire schemas and the content validator both need it; it is the engine's only runtime dependency",
  "cloudflare:workers":
    "a workerd built-in module, not a package: it provides the DurableObject base class and is resolved by the runtime, so it adds nothing to the bundle",
};

/**
 * Strip comments so prose about the hazard is not mistaken for the hazard.
 *
 * This is not optional: `src/engine/dataFiles.ts` exists specifically to explain
 * why `import.meta.glob` is gone, and says the words several times while doing
 * it. A naive search would fail on the file that fixed the problem.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < source.length && source.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    const char = source[i]!;
    if (char === '"' || char === "'" || char === "`") {
      out += char;
      i++;
      while (i < source.length && source[i] !== char) {
        if (source[i] === "\\") {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        i++;
      }
      out += char;
      i++;
      continue;
    }
    out += char;
    i++;
  }
  return out;
}

const IMPORT_SPECIFIER = /(?:^|[\s;}])(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g;

function specifiersIn(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER)) found.push(match[1]!);
  // `import type X from` and side-effect imports are covered above; dynamic
  // import() is caught separately so it cannot smuggle a module past the walk.
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) found.push(match[1]!);
  return found;
}

/** Resolve a relative specifier the way the bundlers do: exact, then .ts, then /index.ts. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, resolve(base, "index.ts")]) {
    if (existsSync(candidate) && !candidate.endsWith(sep)) return candidate;
  }
  return null;
}

interface Walk {
  files: string[];
  packages: Set<string>;
  unresolved: string[];
}

function walkFrom(entries: string[]): Walk {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const unresolved: string[] = [];
  const queue = entries.map((entry) => resolve(ROOT, entry));

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith(".json")) continue; // data, not code

    const source = stripComments(readFileSync(file, "utf8"));
    for (const specifier of specifiersIn(source)) {
      if (!specifier.startsWith(".")) {
        packages.add(specifier);
        continue;
      }
      const resolved = resolveSpecifier(file, specifier);
      if (resolved === null) unresolved.push(`${relative(ROOT, file)} -> ${specifier}`);
      else queue.push(resolved);
    }
  }

  return { files: [...seen], packages, unresolved };
}

const walk = walkFrom(ENTRY_POINTS);
const asRepoPath = (file: string): string => relative(ROOT, file).split(sep).join("/");

describe("the server's import graph", () => {
  it("was actually walked", () => {
    // Every assertion below is a statement about a set. If the walk resolved
    // nothing, all of them hold vacuously and this file becomes decoration.
    expect(walk.files.length, "the walk visited almost nothing, so it proved nothing").toBeGreaterThan(10);
    expect(walk.unresolved, "an import could not be resolved, so part of the graph went unchecked").toEqual([]);
    // and it really did leave the server directory and reach the shared engine
    expect(walk.files.map(asRepoPath)).toContain("src/engine/reducer.ts");
  });

  it("stays inside the engine, the wire protocol and the server itself", () => {
    const strays = walk.files.map(asRepoPath).filter((path) => !ALLOWED_PREFIXES.some((p) => path.startsWith(p)));
    expect(strays, "the worker bundle reaches into client-only code").toEqual([]);
  });

  it("pulls in no package beyond the ones the worker is meant to ship", () => {
    // three.js is the one that matters: it is imported all over `src/ui`, and if
    // it ever appears here it means an import crossed the boundary above.
    expect([...walk.packages].sort()).toEqual(Object.keys(ALLOWED_PACKAGES).sort());
  });

  it("has a real reason written down for each allowed package", () => {
    for (const [name, reason] of Object.entries(ALLOWED_PACKAGES)) {
      expect(reason.length, `"${name}" is allowed without saying why`).toBeGreaterThan(40);
    }
  });

  it("contains no `import.meta` anywhere", () => {
    /**
     * Not just `.glob` — `import.meta.env` and `import.meta.hot` are equally
     * Vite-only and equally silent, and `import.meta.url` is legal ESM that
     * still means something different under a bundler. The engine has no
     * business asking about its own module context; if one ever needs to, that
     * is a conversation, not a quiet commit.
     */
    const offenders = walk.files
      .filter((file) => !file.endsWith(".json"))
      .filter((file) => stripComments(readFileSync(file, "utf8")).includes("import.meta"))
      .map(asRepoPath);
    expect(offenders).toEqual([]);
  });
});

describe("the comment stripper the checks above depend on", () => {
  it("removes comments and keeps strings", () => {
    // If this were broken the other way round, every check above would silently
    // stop looking at real code.
    expect(stripComments('a; // import.meta.glob\nb;')).toBe("a; \nb;");
    expect(stripComments("a; /* import.meta.glob */ b;")).toBe("a;  b;");
    expect(stripComments('const s = "import.meta.glob";')).toBe('const s = "import.meta.glob";');
    expect(stripComments('const url = "https://x.dev/a"; c;')).toBe('const url = "https://x.dev/a"; c;');
  });

  it("still sees the hazard when it is real", () => {
    expect(stripComments("const m = import.meta.glob('./*.json');")).toContain("import.meta");
  });

  it("finds the imports it is asked to find", () => {
    const source = [
      'import a from "./a";',
      'import type { B } from "./b";',
      'export { c } from "./c";',
      'import "./d";',
      'const e = await import("./e");',
    ].join("\n");
    expect(specifiersIn(source).sort()).toEqual(["./a", "./b", "./c", "./d", "./e"]);
  });
});
