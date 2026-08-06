const sel = [".leader-plate-player",".obsession-dial.obsession-player",".ability-bar",".ability-btn",".hype-wrap",".leader-plate-enemy",".obsession-enemy",".hand-bar",".turn-wrap"];
const r = {};
for (const s of sel) r[s] = [...document.querySelectorAll(s)].map(n => { const b = n.getBoundingClientRect(); return [Math.round(b.x),Math.round(b.y),Math.round(b.width),Math.round(b.height)]; });
r.vars = { top: getComputedStyle(document.documentElement).getPropertyValue("--board-inset-top"), bottom: getComputedStyle(document.documentElement).getPropertyValue("--board-inset-bottom") };
return r;
