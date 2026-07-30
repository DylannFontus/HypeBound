/**
 * Reading source as text, for the tests that assert about the code itself.
 *
 * Two of them now do — `server-portability.test.ts` proves no `import.meta`
 * survives in the server's import graph, and `mode-honesty.test.ts` proves a
 * gated mode explains itself — and both hit the same wall immediately: **the
 * comment explaining a fix contains the words being searched for**.
 *
 * `dataFiles.ts` exists to explain why `import.meta.glob` is gone and says it
 * four times. `playScreen.ts` explains that "Needs server" was replaced and
 * quotes it. In both cases a naive search fails on the file that fixed the
 * problem — which is the worst possible false positive, because it punishes
 * writing down why.
 *
 * One implementation, shared, because two copies of a text-stripper is how the
 * two tests eventually disagree about what a string literal is.
 */

/**
 * Remove comments, keep string and template literals intact.
 *
 * A character-level pass rather than a regex, because the regex version has to
 * choose between eating a `//` inside a URL string and missing a block comment
 * inside one, and both failure modes are silent.
 *
 * Note the absence of a literal block-comment terminator anywhere in this file,
 * including in prose. Writing one inside a doc comment ends the comment there,
 * and the remainder becomes code — which is how the first version of this file
 * failed to parse at all. A module about comment handling, defeated by a
 * comment.
 */
export function stripComments(source: string): string {
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
