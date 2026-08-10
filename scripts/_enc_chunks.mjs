/**
 * What is actually inside the entry chunk, and why it cannot leave.
 *
 * The brief says "the JS is one 3,040 kB chunk — split it", and `manualChunks`
 * looks like the answer until you notice that a chunk boundary does not make a
 * statically-imported module optional: Rollup will happily put `three` in its
 * own file and Vite will happily `modulepreload` it on the same page load. The
 * only thing that removes bytes from a first load is a module that nothing on
 * the boot path imports statically.
 *
 * So this reports two things a size table cannot:
 *
 * 1. **Per-chunk module composition**, from Rollup's own `renderedLength`, so
 *    "the entry is 2.5 MB" becomes a list of what those megabytes are.
 * 2. **The shortest static import chain from `src/main.ts` to `three`**, walked
 *    over the real import statements. A claim that a dependency is unavoidable
 *    is worth nothing without the path that makes it unavoidable, and a path is
 *    also the fix: it names every file that would have to change.
 *
 * Run with `node scripts/_enc_chunks.mjs`. It performs its own Vite build into
 * a throwaway directory rather than reading `dist`, because a chunk's module
 * list is not written to disk anywhere.
 */

import { build } from "vite";
import { readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".asset-cache", "_chunk-probe");

// ---------------------------------------------------------------------------
// 1. Composition
// ---------------------------------------------------------------------------

const composition = [];

await build({
  root: ROOT,
  configFile: path.join(ROOT, "vite.config.ts"),
  logLevel: "silent",
  build: {
    outDir: OUT,
    // The plugin that copies 80 MB of assets keys off `config.build.outDir`,
    // and this probe wants chunks, not a second copy of every card painting.
    // Emptying is left off for the same reason.
    emptyOutDir: false,
    write: false,
    rollupOptions: {
      output: {
        manualChunks: undefined, // measured unsplit: what would be in one chunk
      },
    },
  },
  plugins: [
    {
      name: "probe",
      generateBundle(_options, bundle) {
        for (const [file, chunk] of Object.entries(bundle)) {
          if (chunk.type !== "chunk") continue;
          const modules = Object.entries(chunk.modules)
            .map(([id, m]) => ({ id: path.relative(ROOT, id).replace(/\\/g, "/"), bytes: m.renderedLength }))
            .sort((a, b) => b.bytes - a.bytes);
          composition.push({ file, isEntry: chunk.isEntry, total: modules.reduce((s, m) => s + m.bytes, 0), modules });
        }
      },
    },
  ],
});

composition.sort((a, b) => b.total - a.total);
for (const chunk of composition) {
  console.log(`\n${chunk.file}  ${(chunk.total / 1024).toFixed(0)} kB${chunk.isEntry ? "  (entry)" : ""}`);

  // Grouped, because 271 module lines is not a finding.
  const groups = new Map();
  for (const m of chunk.modules) {
    const key = m.id.startsWith("node_modules/")
      ? `node_modules/${m.id.split("/")[1]}`
      : m.id.split("/").slice(0, 3).join("/");
    groups.set(key, (groups.get(key) ?? 0) + m.bytes);
  }
  for (const [key, bytes] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`   ${(bytes / 1024).toFixed(0).padStart(6)} kB  ${key}`);
  }
}

rmSync(OUT, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 2. The chain that keeps three.js on the boot path
// ---------------------------------------------------------------------------

/**
 * Static `import ... from "x"` and `export ... from "x"` only. `import()` is
 * deliberately not matched — a dynamic import is precisely the thing that would
 * break the chain, so counting it would answer the opposite question.
 */
const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)(?:\s[\s\S]*?)?\s*from\s*["']([^"']+)["']/g;
const BARE_IMPORT = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;

function resolveLocal(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [`${base}.ts`, path.join(base, "index.ts"), base]) {
    if (existsSync(candidate) && candidate.endsWith(".ts")) return candidate;
  }
  return null;
}

function importsOf(file) {
  const source = readFileSync(file, "utf8");
  const specs = new Set();
  for (const re of [STATIC_IMPORT, BARE_IMPORT]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source)) !== null) specs.add(match[1]);
  }
  return [...specs];
}

function shortestChainTo(target) {
  const start = path.join(ROOT, "src", "main.ts");
  const queue = [[start]];
  const seen = new Set([start]);
  while (queue.length) {
    const chain = queue.shift();
    const file = chain[chain.length - 1];
    for (const spec of importsOf(file)) {
      if (spec === target) return [...chain, target];
      const next = resolveLocal(file, spec);
      if (!next || seen.has(next)) continue;
      seen.add(next);
      queue.push([...chain, next]);
    }
  }
  return null;
}

for (const dependency of ["three", "postprocessing", "zod"]) {
  const chain = shortestChainTo(dependency);
  console.log(`\nshortest STATIC import chain  main.ts → ${dependency}`);
  if (!chain) {
    console.log("   none — nothing on the boot path imports it statically, so it can be split off a first load");
    continue;
  }
  console.log(`   ${chain.map((f) => (f === dependency ? f : path.relative(ROOT, f).replace(/\\/g, "/"))).join("\n   → ")}`);
}
