/**
 * The comment stripper two other test files depend on.
 *
 * `server-portability.test.ts` uses it to prove no `import.meta` survives in
 * the server's graph, and `mode-honesty.test.ts` uses it to prove a screen no
 * longer renders a misleading label. Both would fail *open* if the stripper
 * over-removed — a search that finds nothing looks exactly like a codebase with
 * nothing wrong in it — so the stripper needs its own tests rather than being
 * trusted because it is short.
 */

import { describe, expect, it } from "vitest";
import { stripComments } from "./helpers/source";

describe("stripComments", () => {
  it("removes line comments and keeps the newline", () => {
    expect(stripComments("a; // import.meta.glob\nb;")).toBe("a; \nb;");
  });

  it("removes block comments", () => {
    expect(stripComments("a; /* import.meta.glob */ b;")).toBe("a;  b;");
  });

  it("removes a multi-line doc comment", () => {
    expect(stripComments("/**\n * Needs server\n */\nconst a = 1;")).toBe("\nconst a = 1;");
  });

  it("keeps strings that look like comments", () => {
    // The whole point: the words being searched for usually appear in a string
    // literal that matters and a comment that does not.
    expect(stripComments('const s = "// not a comment";')).toBe('const s = "// not a comment";');
    expect(stripComments('const s = "Needs server";')).toBe('const s = "Needs server";');
    expect(stripComments("const s = 'a /* b */ c';")).toBe("const s = 'a /* b */ c';");
    expect(stripComments("const s = `Coming online`;")).toBe("const s = `Coming online`;");
  });

  it("does not mistake a URL for a comment", () => {
    expect(stripComments('const u = "https://x.dev/a"; c;')).toBe('const u = "https://x.dev/a"; c;');
  });

  it("survives an escaped quote inside a string", () => {
    expect(stripComments('const s = "he said \\"hi\\""; // gone')).toBe('const s = "he said \\"hi\\""; ');
  });

  it("still sees the hazard when it is real code", () => {
    expect(stripComments("const m = import.meta.glob('./*.json');")).toContain("import.meta");
  });

  it("leaves code with no comments untouched", () => {
    // The fail-open direction. If this ever over-removes, every search built on
    // it quietly starts finding nothing.
    const code = "export function f(a: number): number {\n  return a * 2;\n}\n";
    expect(stripComments(code)).toBe(code);
  });
});
