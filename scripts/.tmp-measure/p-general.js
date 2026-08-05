const frames = window.__frames.slice(1).sort((a, b) => a - b);
const pct = (p) => frames[Math.min(frames.length - 1, Math.floor(frames.length * p))] ?? 0;
const fades = [...document.querySelectorAll(".d-fade")].map((n) => {
  const cs = getComputedStyle(n);
  return {
    cls: n.className.split(" ").slice(0, 2).join("."),
    scrollTop: n.scrollTop,
    overflow: n.scrollHeight - n.clientHeight,
    a: cs.getPropertyValue("--fade-a").trim(),
    b: cs.getPropertyValue("--fade-b").trim(),
    mask: (cs.maskImage || cs.webkitMaskImage || "").slice(0, 170),
  };
});
const heroes = [...document.querySelectorAll(".mat-hero")].map((n) => ({
  text: (n.textContent || "").trim().slice(0, 26),
  box: `${Math.round(n.getBoundingClientRect().width)}x${Math.round(n.getBoundingClientRect().height)}`,
}));
const small = [...document.querySelectorAll("button, input, a[href], .d-chip, .d-go, .d-claim")]
  .map((n) => ({ n, r: n.getBoundingClientRect() }))
  .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 32)
  .map(({ n, r }) => `${n.className.split(" ")[0] || n.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
const clipped = [...document.querySelectorAll(".screen *")].filter((n) => {
  const cs = getComputedStyle(n);
  if (cs.overflow !== "hidden" && cs.overflowY !== "hidden") return false;
  if (n.classList.contains("d-row-sub")) return false;
  return n.scrollHeight - n.clientHeight > 3 && n.clientHeight > 8;
}).length;
const ellipsised = [...document.querySelectorAll(".d-tile-name > span, .replay-entry-meta, .tour-stop-faction")]
  .filter((n) => n.scrollWidth - n.clientWidth > 1)
  .map((n) => (n.textContent || "").trim().slice(0, 30));
return {
  route: location.hash,
  hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  longTasks: window.__longTasks,
  longTaskTotal: window.__longTasks.reduce((a, b) => a + b, 0),
  frameP50: pct(0.5),
  frameP95: pct(0.95),
  worstFrame: frames[frames.length - 1] ?? 0,
  animStarts: window.__anim.length,
  firstAnimAt: window.__anim[0]?.[1] ?? null,
  lastAnimAt: window.__anim[window.__anim.length - 1]?.[1] ?? null,
  transitionProps: [...new Set(window.__transitions)],
  idleInfinite: document.getAnimations().filter((a) => a.effect?.getTiming?.().iterations === Infinity).length,
  heroCount: heroes.length,
  heroes,
  fades,
  under32: small,
  clippedOverflow: clipped,
  ellipsised,
};
