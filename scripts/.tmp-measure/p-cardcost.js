const mod = await import("/src/ui/cardRenderer/renderCard.ts");
const content = await (await import("/src/engine/content.ts")).loadContent?.();
const leaders = Object.values(window.__content?.leaders ?? {});
const out = { hasLoad: typeof mod.renderCardToCanvas };
const ids = [...document.querySelectorAll(".tour-stop-card")].map((n) => n.dataset.leader);
out.ids = ids.slice(0, 3);
// time a fresh render of the same leader at three sizes
const idx = await import("/src/ui/screens/data/kit.ts");
void idx;
const c = window.hypeboundContent;
out.hasWindowContent = Boolean(c);
return out;
