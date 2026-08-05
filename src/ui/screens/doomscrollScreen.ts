/**
 * The Doomscroll — the roguelike campaign's map, sidebar and node panels.
 *
 * The screen owns no rules. Every button calls a pure function in
 * `game/doomscroll/run.ts`, saves whatever comes back, and re-renders; the run
 * is the single source of truth and it lives in storage, so a reload mid-shop
 * puts you back in that shop. That split is what lets a hundred runs be played
 * to completion in a unit test without a browser.
 *
 * The map is drawn from percentages rather than measured pixels: nodes sit at
 * (index + 0.5) / width across and floor / (floors - 1) down, and the edges are
 * an SVG with `preserveAspectRatio="none"` over the same coordinate space. No
 * layout reads, no resize observers, and the edges cannot drift out of register
 * with the nodes because both are computed from the same two numbers.
 */

import type { CardDef, ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import { audio } from "../../audio/audio";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { getRoguelikeData, artifactById, eventById, type NodeKind } from "../../game/doomscroll/data";
import type { MapNode } from "../../game/doomscroll/map";
import type { IconId } from "../art/uiIcons";
import {
  abandonRun,
  actOf,
  artifactTotal,
  battleFor,
  currentNode,
  enterNode,
  reachableNodeIds,
  removalPrice,
  resolveBattle,
  resolvePrompt,
  startRun,
  summarize,
  type RunChoice,
  type RunState,
} from "../../game/doomscroll/run";
import { activeRun, beginRun, doomscrollStore, finishRun, saveRun } from "../../save/doomscrollSave";
import { completeDailyDoomscroll, getProfile, profileStore, todaysDoomscrollSeed } from "../../save/profile";
import { count, countUp, enter, icon, quantify, room } from "./data/kit";
import { paintLeaderPortrait } from "../art/leaderPortrait";

export interface DoomscrollCallbacks {
  onBack: () => void;
  /** the run is standing on a fight — hand over to the battle route */
  onFight: () => void;
}

/**
 * The map node marks, drawn rather than typed.
 *
 * These were `⚔ ☠ ❔ ▤ ☘ ✦ ◆ ★` — eight code points standing in for eight icons,
 * rendered in whatever face the OS happened to have, at whatever weight that
 * face draws them, and tofu on any device missing one. Module C's set covers all
 * eight on one 24px grid at one stroke weight, which is the only way a map of
 * forty nodes reads as one legend rather than as eight fonts.
 */
const NODE_ICON: Record<NodeKind, IconId> = {
  battle: "attack",
  elite: "skull",
  event: "help",
  shop: "shop",
  rest: "kw-touch-grass",
  recruit: "recruit",
  treasure: "chest",
  boss: "star-filled",
};

const NODE_NAME: Record<NodeKind, string> = {
  battle: "Battle",
  elite: "Elite",
  event: "Notification",
  shop: "Merch Table",
  rest: "Touch Grass Break",
  recruit: "Collab Call",
  treasure: "Sponsor Drop",
  boss: "Main Event",
};

const NODE_BLURB: Record<NodeKind, string> = {
  battle: "A fight. Win a card and some Clout.",
  elite: "A harder fight. Guarantees an artifact.",
  event: "Someone wants something from you.",
  shop: "Spend run-Clout on cards, artifacts, and cutting dead weight.",
  rest: "Heal, or cut a card from the run deck.",
  recruit: "Somebody from another scene wants in.",
  treasure: "Free artifact, or take the Clout.",
  boss: "The act's Main Event, and its rule twist.",
};

const escape = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export function createDoomscrollScreen(content: ContentIndex, callbacks: DoomscrollCallbacks): Screen {
  const data = getRoguelikeData(content);

  const root = document.createElement("div");
  root.className = "screen doom-screen d-hall d-hall-solo d-hall-read";
  root.innerHTML = `
    ${room({ accent: "#4fe3d0", lit: 0.8 })}
    <header class="sub-header">
      <button class="btn btn-ghost" id="doom-back">${icon("arrow-left", 16)} Lobby</button>
      <h1 class="title" id="doom-title">The Doomscroll</h1>
      <div class="sub-header-meta muted" id="doom-meta"></div>
    </header>
    <div class="doom-body data-body" id="doom-body"></div>
    <div class="doom-prompt-backdrop" id="doom-prompt" hidden></div>`;

  const body = root.querySelector<HTMLElement>("#doom-body")!;
  const titleEl = root.querySelector<HTMLElement>("#doom-title")!;
  const metaEl = root.querySelector<HTMLElement>("#doom-meta")!;
  const promptHost = root.querySelector<HTMLElement>("#doom-prompt")!;

  let run: RunState | null = activeRun();

  // ---- mutation helpers ----------------------------------------------------

  const commit = (next: RunState): void => {
    run = next;
    saveRun(next);
    render();
  };

  const choose = (choice: RunChoice): void => {
    if (!run) return;
    audio.play("sfx.ui.click");
    commit(resolvePrompt(data, content, run, choice));
  };

  // ---- setup ---------------------------------------------------------------

  function renderSetup(): void {
    const save = doomscrollStore.get();
    titleEl.textContent = "The Doomscroll";
    metaEl.textContent = save.runsStarted > 0
      ? `${quantify(save.runsStarted, "run")} · best ${save.bestActsCleared}/${data.acts.length} acts · ${save.lifetimeClout} Clout banked`
      : "A run down the feed. Your collection is not involved.";

    const panel = document.createElement("div");
    panel.className = "doom-setup";
    panel.innerHTML = `
      <div class="mat-panel r-panel d-enter doom-setup-panel">
        <div class="t-label">Descend</div>
        <h2 class="title">Pick who is posting</h2>
        <p class="muted">
          You start with a ${data.leaders[0]!.deck.length}-card temporary deck and ${data.run.startingHealth} health that
          carries between fights. Cards you find exist only inside the run. Reaching the end of
          ${data.acts.length === 1 ? "the act" : `all ${data.acts.length} acts`} converts run-Clout to real Clout at
          ${data.run.cloutConversion}:1.
        </p>
        <div class="doom-leader-grid" id="doom-leaders"></div>
        <div class="doom-seed-row">
          <label for="doom-seed">Run seed</label>
          <input id="doom-seed" class="field input" type="text" inputmode="numeric" />
          <button type="button" class="mat-chip act r-chip" id="doom-reroll">${icon("refresh", 14)} Reroll</button>
          <button type="button" class="mat-chip act r-chip" id="doom-daily">${icon("events", 14)} Today's run</button>
        </div>
        <p class="muted doom-seed-note">
          Same seed and same choices give the same map, events, shops and offers — copy it to replay or share a run.
        </p>
        <p class="muted doom-seed-note" id="doom-daily-note">
          <strong>Today's run</strong> is the same seed for everybody, and clearing it fills the bonus daily slot.
        </p>
      </div>

      ${/*
         * The band that stops the lower third being void.
         *
         * Measured before this: content stopped at y=643 of 900 and the rest of
         * the frame was ambient gradient, which §2 reads as content that failed
         * to load. The fix is not decoration — it is the two things a player
         * standing at the entrance actually wants to know: how far the descent
         * goes, and how far they have got before. The acts are drawn as plates
         * with the one they have reached lit, so the map is a picture of the run
         * rather than a sentence about it.
         */ ""}
      <section class="mat-panel r-panel d-enter doom-record">
        <div class="doom-record-head">
          <div>
            <div class="t-label">The descent</div>
            <h3 class="t-heading">${quantify(data.acts.length, "act")}, then it stops</h3>
          </div>
          <dl class="d-stats doom-record-stats">
            <div class="d-stat"><dt>Runs</dt><dd class="num" data-count="${save.runsStarted}">${count(
              save.runsStarted
            )}</dd></div>
            <div class="d-stat"><dt>Best</dt><dd class="num">${count(save.bestActsCleared)}<span
              class="doom-record-of">/${count(data.acts.length)}</span></dd></div>
            <div class="d-stat"><dt>Clout banked</dt><dd class="num" data-count="${save.lifetimeClout}">${count(
              save.lifetimeClout
            )}</dd></div>
          </dl>
        </div>
        <ol class="doom-acts">
          ${data.acts
            .map((act, i) => {
              const cleared = i < save.bestActsCleared;
              const next = i === save.bestActsCleared;
              return `
                <li class="mat-panel r-tile d-enter doom-act ${cleared ? "is-cleared" : ""} ${next ? "is-next" : ""}">
                  <span class="doom-act-no num">${count(i + 1)}</span>
                  <span class="doom-act-text">
                    <span class="doom-act-name">${escape(act.name)}</span>
                    <span class="doom-act-blurb">${escape(act.blurb)}</span>
                  </span>
                  <span class="doom-act-state">
                    ${
                      cleared
                        ? `${icon("check", 14)} Cleared`
                        : next
                          ? `${icon("crosshair", 14)} Furthest`
                          : `${icon("lock", 14)} Ahead`
                    }
                  </span>
                </li>`;
            })
            .join("")}
        </ol>
      </section>`;
    body.replaceChildren(panel);
    countUp(panel);
    enter(panel, ".doom-setup-panel, .doom-record, .doom-act", 40);

    const seedInput = panel.querySelector<HTMLInputElement>("#doom-seed")!;
    seedInput.value = String(Math.floor(Math.random() * 0x7fffffff));
    panel.querySelector("#doom-reroll")?.addEventListener("click", () => {
      seedInput.value = String(Math.floor(Math.random() * 0x7fffffff));
    });
    /**
     * The Daily Doomscroll is not a separate mode — it is this run, on a seed
     * the date chose. Everybody gets the same one, which is the only reason a
     * daily run is worth talking about.
     */
    panel.querySelector("#doom-daily")?.addEventListener("click", () => {
      seedInput.value = String(todaysDoomscrollSeed());
    });

    const grid = panel.querySelector<HTMLElement>("#doom-leaders")!;
    for (const leader of data.leaders) {
      const card = document.createElement("button");
      /*
       * A leader choice is a portrait, not a 370x140 capsule.
       *
       * Two defects at once. `--radius-pill` on a 370x140 content card put a
       * lozenge inside a 20px-radius panel — three corner radii on one screen,
       * which §7 names — and the card had no picture on the screen where the
       * whole decision is "who am I playing as". `paintLeaderPortrait` is the
       * painter the lobby, the queue and the sign-in screen already use, with
       * the left edge feathered so the art bleeds into the plate rather than
       * ending at a rectangle.
       */
      card.className = "doom-leader mat-panel act r-panel d-enter";
      card.type = "button";
      const def = content.leaders[leader.leaderCardId];
      card.innerHTML = `
        <span class="doom-leader-art" aria-hidden="true"></span>
        <span class="doom-leader-text">
          <span class="doom-leader-name">${escape(leader.name)}</span>
          <span class="doom-leader-sub">${escape(def?.title ?? "")}</span>
          <span class="doom-leader-blurb">${escape(leader.blurb)}</span>
          <span class="doom-leader-deck">${leader.deck.length}-card deck · “${escape(leader.deckName)}”</span>
        </span>`;
      const artHost = card.querySelector<HTMLElement>(".doom-leader-art");
      if (artHost && def) {
        artHost.appendChild(
          paintLeaderPortrait(def, { width: 168, aspect: 1.15, bias: 0.2, fadeLeft: 0.34, fadeBottom: 0.18, scrim: 0.3 })
        );
      }
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        const typed = Number(seedInput.value.trim());
        const seed = Number.isFinite(typed) && typed > 0 ? Math.floor(typed) : Math.floor(Math.random() * 0x7fffffff);
        const fresh = startRun(data, leader.leaderCardId, seed, Date.now());
        beginRun(fresh);
        run = fresh;
        render();
      });
      grid.appendChild(card);
    }
    enter(panel, ".doom-leader", 60);
  }

  // ---- run sidebar ---------------------------------------------------------

  function renderSidebar(active: RunState): HTMLElement {
    const aside = document.createElement("aside");
    aside.className = "doom-side mat-panel r-panel";

    const healthPercent = Math.max(0, Math.round((active.health / Math.max(1, active.maxHealth)) * 100));
    const leader = content.leaders[active.leaderCardId];

    const head = document.createElement("div");
    head.className = "doom-side-head";
    head.innerHTML = `
      <div class="doom-side-leader">${escape(leader?.name ?? active.leaderCardId)}</div>
      <div class="doom-health">
        <div class="doom-health-fill" style="width:${healthPercent}%"></div>
        <span class="doom-health-text">${active.health} / ${active.maxHealth}</span>
      </div>
      <div class="doom-side-stats">
        <span title="Run-Clout, converted at the end of the run">${icon("clout", 14)} <span class="num">${count(active.clout)}</span></span>
        ${/*
            * The last two typed glyphs on this screen.
            *
            * The note above this rail records eight code points being replaced
            * with drawn icons and these two were missed, which is the failure
            * mode of a hand-checked sweep: `▥` and `⚔` render in whatever font
            * the OS happens to have, at a weight nobody chose, and become tofu
            * on a device that lacks them — while sitting inside the same row as
            * a `uiIcons` Clout mark at 1.75px stroke. Both counts are `.num`
            * for the same reason the Clout one already was.
            */ ""}
        <span title="Cards in the run deck">${icon("deck", 14)} <span class="num">${count(
          active.deck.length
        )}</span></span>
        <span title="Battles won">${icon("attack", 14)} <span class="num">${count(
          active.battlesWon
        )}</span></span>
      </div>`;
    aside.appendChild(head);

    // --- artifacts
    const artifacts = document.createElement("div");
    artifacts.className = "doom-side-block";
    artifacts.innerHTML = `<div class="t-label">Artifacts</div>`;
    if (active.artifacts.length === 0) {
      const none = document.createElement("p");
      none.className = "muted doom-empty";
      none.textContent = "None yet. Elites and Sponsor Drops carry them.";
      artifacts.appendChild(none);
    } else {
      for (const id of active.artifacts) {
        const artifact = artifactById(data, id);
        if (!artifact) continue;
        const row = document.createElement("div");
        row.className = "doom-artifact";
        row.innerHTML = `<span class="doom-artifact-name">${escape(artifact.name)}</span>
          <span class="muted doom-artifact-text">${escape(artifact.text)}</span>`;
        artifacts.appendChild(row);
      }
    }
    aside.appendChild(artifacts);

    /**
     * Signal Fragments — the optional finale's entry condition.
     *
     * Shown as a filled/empty track rather than a number, and shown from the
     * first floor rather than once you hold one, because the whole decision it
     * drives is made on the map: walk into this act's Elite or route around it.
     * A counter you only discover after your first Elite is a counter that
     * arrives too late to change anything.
     */
    const finale = data.acts.find((act) => act.requiresFragments !== undefined);
    if (finale?.requiresFragments) {
      const held = active.fragments.length;
      const track = document.createElement("div");
      track.className = "doom-side-block doom-fragments";
      track.dataset["held"] = String(held);
      track.innerHTML = `
        <div class="t-label">Signal Fragments</div>
        <div class="doom-fragment-track" aria-label="${held} of ${finale.requiresFragments} Signal Fragments">
          ${Array.from({ length: finale.requiresFragments }, (_, i) =>
            `<span class="doom-fragment${i < held ? " doom-fragment-held" : ""}" aria-hidden="true">${icon("diamond", 13)}</span>`
          ).join("")}
        </div>
        <p class="muted doom-fragment-note">${
          held >= finale.requiresFragments
            ? `All ${finale.requiresFragments} recovered. ${escape(finale.name)} will open.`
            : `Beat one Elite per act. All ${finale.requiresFragments} opens ${escape(finale.name)}.`
        }</p>`;
      aside.appendChild(track);
    }

    // --- deck
    const deckBlock = document.createElement("div");
    deckBlock.className = "doom-side-block doom-deck-block";
    deckBlock.innerHTML = `<div class="t-label">Run deck (${active.deck.length})</div>`;
    deckBlock.appendChild(deckRows(active));
    aside.appendChild(deckBlock);

    // --- log
    const logBlock = document.createElement("div");
    logBlock.className = "doom-side-block doom-log-block";
    logBlock.innerHTML = `<div class="t-label">Feed</div>`;
    const log = document.createElement("div");
    log.className = "doom-log scroll";
    for (const line of [...active.log].reverse().slice(0, 20)) {
      const entry = document.createElement("div");
      entry.className = "doom-log-line muted";
      entry.textContent = line;
      log.appendChild(entry);
    }
    logBlock.appendChild(log);
    aside.appendChild(logBlock);

    const abandon = document.createElement("button");
    abandon.className = "btn btn-ghost doom-abandon";
    abandon.id = "doom-abandon";
    abandon.textContent = "Abandon run";
    abandon.addEventListener("click", () => {
      if (!run) return;
      audio.play("sfx.ui.click");
      commit(abandonRun(run));
    });
    aside.appendChild(abandon);

    return aside;
  }

  /** The run deck, grouped by card and sorted by cost. */
  /**
   * The run deck, either as a read-only list or as a picker.
   *
   * A picker lists every copy separately; the read-only view groups them. That
   * asymmetry is the point — copies are not interchangeable. A Collab recruit
   * cannot be cut while a drafted copy of the same card can, and one copy can be
   * Remastered while the copy beside it is not.
   */
  function deckRows(active: RunState, pick?: { mode: "cut" | "upgrade"; onPick: (index: number) => void }): HTMLElement {
    const list = document.createElement("div");
    list.className = "doom-decklist scroll";

    const entries = active.deck
      .map((card, index) => ({ card, index, def: content.cards[card.cardId] }))
      .sort((a, b) => (a.def?.cost ?? 0) - (b.def?.cost ?? 0) || (a.card.cardId < b.card.cardId ? -1 : 1));

    if (pick) {
      for (const entry of entries) {
        list.appendChild(
          deckPickRow(entry.def, entry.card, entry.index, pick.mode, pick.onPick, active.deck.length <= 1)
        );
      }
      return list;
    }

    const grouped = new Map<string, { def: CardDef | undefined; count: number; recruit: boolean; upgraded: boolean }>();
    for (const entry of entries) {
      // upgraded copies group apart from un-upgraded ones: they are, by now,
      // genuinely different cards
      const key = `${entry.card.cardId}${entry.card.recruit ? ":collab" : ""}${entry.card.upgraded ? ":rm" : ""}`;
      const existing = grouped.get(key);
      if (existing) existing.count += 1;
      else {
        grouped.set(key, {
          def: entry.def,
          count: 1,
          recruit: entry.card.recruit === true,
          upgraded: entry.card.upgraded === true,
        });
      }
    }
    for (const entry of grouped.values()) {
      const row = document.createElement("div");
      row.className = `doom-deck-row${entry.upgraded ? " doom-deck-remastered" : ""}`;
      row.innerHTML = `
        <span class="doom-deck-cost">${entry.def?.cost ?? "?"}</span>
        <span class="doom-deck-name">${escape(entry.def?.name ?? "Unknown")}${
          entry.upgraded ? ' <em class="doom-remastered-tag">Remastered</em>' : ""
        }${entry.recruit ? " <em>Collab</em>" : ""}</span>
        <span class="doom-deck-count muted">×${entry.count}</span>`;
      list.appendChild(row);
    }
    return list;
  }

  function deckPickRow(
    def: CardDef | undefined,
    card: RunState["deck"][number],
    index: number,
    mode: "cut" | "upgrade",
    onPick: (index: number) => void,
    last: boolean
  ): HTMLElement {
    const row = document.createElement("button");
    row.className = `doom-deck-row doom-deck-pick${card.upgraded ? " doom-deck-remastered" : ""}`;
    row.type = "button";
    row.dataset["index"] = String(index);

    const blocked =
      mode === "cut"
        ? card.recruit === true || last
        : card.upgraded === true;
    const note =
      mode === "cut"
        ? card.recruit
          ? "Collab — cannot cut"
          : last
            ? "last card"
            : "Cut"
        : card.upgraded
          ? "Already Remastered"
          : "Remaster";

    row.disabled = blocked;
    row.innerHTML = `
      <span class="doom-deck-cost">${def?.cost ?? "?"}</span>
      <span class="doom-deck-name">${escape(def?.name ?? "Unknown")}</span>
      <span class="doom-deck-count muted">${note}</span>`;
    if (!row.disabled) row.addEventListener("click", () => onPick(index));
    return row;
  }

  // ---- map -----------------------------------------------------------------

  function renderMap(active: RunState): HTMLElement {
    const act = actOf(data, active);
    const wrap = document.createElement("div");
    wrap.className = "doom-map-wrap mat-panel r-panel";

    const heading = document.createElement("div");
    heading.className = "doom-map-head";
    // the act name is already in the screen header — repeating it here costs a
    // whole floor of map that the player needs to plan a route with
    heading.innerHTML = `
      <div class="t-label">Act ${active.actIndex + 1} of ${data.acts.length}</div>
      <p class="muted">${escape(act.blurb)}</p>`;
    wrap.appendChild(heading);

    const map = document.createElement("div");
    map.className = "doom-map";

    const floors = active.map.floors;
    const rows = floors.length;
    const yOf = (floor: number): number => (rows <= 1 ? 50 : (floor / (rows - 1)) * 100);
    const xOf = (index: number, width: number): number => ((index + 0.5) / width) * 100;

    const reachable = new Set(reachableNodeIds(active));
    const taken = new Set(active.path);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "doom-edges");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    for (let floor = 0; floor < rows - 1; floor++) {
      const from = floors[floor]!;
      const to = floors[floor + 1]!;
      for (const node of from) {
        for (const targetIndex of node.next) {
          const target = to[targetIndex];
          if (!target) continue;
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", `${xOf(node.index, from.length)}`);
          line.setAttribute("y1", `${yOf(floor)}`);
          line.setAttribute("x2", `${xOf(target.index, to.length)}`);
          line.setAttribute("y2", `${yOf(floor + 1)}`);
          const live = taken.has(node.id) && reachable.has(target.id);
          line.setAttribute("class", `doom-edge${live ? " doom-edge-live" : ""}${taken.has(node.id) && taken.has(target.id) ? " doom-edge-taken" : ""}`);
          svg.appendChild(line);
        }
      }
    }
    map.appendChild(svg);

    for (let floor = 0; floor < rows; floor++) {
      const width = floors[floor]!.length;
      for (const node of floors[floor]!) {
        map.appendChild(nodeButton(active, node, xOf(node.index, width), yOf(floor), reachable, taken));
      }
    }

    wrap.appendChild(map);
    return wrap;
  }

  function nodeButton(
    active: RunState,
    node: MapNode,
    x: number,
    y: number,
    reachable: Set<string>,
    taken: Set<string>
  ): HTMLElement {
    const button = document.createElement("button");
    const isHere = active.nodeId === node.id;
    const isOpen = reachable.has(node.id);
    button.type = "button";
    button.className = [
      "doom-node",
      `doom-node-${node.kind}`,
      isOpen ? "doom-node-open" : "",
      taken.has(node.id) ? "doom-node-taken" : "",
      isHere ? "doom-node-here" : "",
    ]
      .filter(Boolean)
      .join(" ");
    button.style.left = `${x}%`;
    button.style.top = `${y}%`;
    button.dataset["node"] = node.id;
    button.disabled = !isOpen;
    button.title = `${NODE_NAME[node.kind]} — ${NODE_BLURB[node.kind]}`;
    button.innerHTML = `<span class="doom-node-icon">${icon(NODE_ICON[node.kind], 18)}</span>
      <span class="doom-node-label">${NODE_NAME[node.kind]}</span>`;
    if (isOpen) {
      button.addEventListener("click", () => {
        if (!run) return;
        audio.play("sfx.ui.click");
        commit(enterNode(data, content, run, node.id));
      });
    }
    return button;
  }

  // ---- the fight brief -----------------------------------------------------

  function renderBattleBrief(active: RunState): HTMLElement | null {
    const battle = battleFor(data, content, active);
    if (!battle) return null;
    const panel = document.createElement("div");
    panel.className = "mat-panel r-panel doom-brief";
    panel.innerHTML = `
      <div class="t-label">${battle.kind === "boss" ? "Main Event" : battle.kind === "elite" ? "Elite" : "Battle"}</div>
      <h2 class="title">${escape(battle.title)}</h2>
      <p class="muted">${escape(battle.subtitle)}</p>
      <p class="muted doom-brief-note">
        You bring ${active.deck.length} cards and ${active.health} health. Damage carries to the next node.
      </p>`;
    const go = document.createElement("button");
    go.className = "btn btn-primary";
    go.id = "doom-fight";
    go.textContent = "Start the fight";
    go.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onFight();
    });
    panel.appendChild(go);
    return panel;
  }

  // ---- prompts -------------------------------------------------------------

  function cardTile(cardId: string, price: number | null, sold: boolean, onPick: () => void): HTMLElement {
    const card = content.cards[cardId];
    const tile = document.createElement("button");
    tile.className = `doom-card-tile${sold ? " doom-sold" : ""}`;
    tile.type = "button";
    tile.dataset["card"] = cardId;
    tile.disabled = sold;
    if (card) tile.appendChild(renderCardToCanvas(card, 190));
    const caption = document.createElement("div");
    caption.className = "doom-tile-caption";
    caption.textContent = sold ? "Sold" : price === null ? (card?.name ?? cardId) : `${price} Clout`;
    tile.appendChild(caption);
    if (!sold) tile.addEventListener("click", onPick);
    return tile;
  }

  function artifactTile(artifactId: string, price: number | null, sold: boolean, onPick: () => void): HTMLElement {
    const artifact = artifactById(data, artifactId);
    const tile = document.createElement("button");
    tile.className = `doom-artifact-tile${sold ? " doom-sold" : ""}`;
    tile.type = "button";
    tile.dataset["artifact"] = artifactId;
    tile.disabled = sold;
    tile.innerHTML = `
      <div class="doom-artifact-glyph">${icon("sparkle", 22)}</div>
      <div class="doom-artifact-name">${escape(artifact?.name ?? artifactId)}</div>
      <div class="muted doom-artifact-text">${escape(artifact?.text ?? "")}</div>
      ${price === null ? "" : `<div class="doom-tile-caption">${sold ? "Sold" : `${price} Clout`}</div>`}`;
    if (!sold) tile.addEventListener("click", onPick);
    return tile;
  }

  function renderPrompt(active: RunState): void {
    const prompt = active.prompts[0];
    if (!prompt) {
      promptHost.setAttribute("hidden", "");
      promptHost.replaceChildren();
      return;
    }
    promptHost.removeAttribute("hidden");

    const panel = document.createElement("div");
    panel.className = "mat-panel r-panel doom-prompt-panel";
    const actions = document.createElement("div");
    actions.className = "row center doom-prompt-actions";

    const addAction = (label: string, choice: RunChoice, id: string, ghost = true): void => {
      const button = document.createElement("button");
      button.className = `btn ${ghost ? "btn-ghost" : "btn-primary"}`;
      button.id = id;
      button.textContent = label;
      button.addEventListener("click", () => choose(choice));
      actions.appendChild(button);
    };

    switch (prompt.kind) {
      case "cardPick": {
        panel.innerHTML = `<div class="t-label">${escape(prompt.title)}</div>
          <p class="muted">${escape(prompt.detail)}</p>`;
        const strip = document.createElement("div");
        strip.className = "doom-tile-strip";
        for (const cardId of prompt.cards) {
          strip.appendChild(cardTile(cardId, null, false, () => choose({ kind: "pickCard", cardId })));
        }
        panel.appendChild(strip);
        if (prompt.skippable) addAction("Take nothing", { kind: "skip" }, "doom-skip");
        break;
      }

      case "artifactPick": {
        panel.innerHTML = `<div class="t-label">${escape(prompt.title)}</div>
          <p class="muted">Artifacts last the whole run and stack.</p>`;
        const strip = document.createElement("div");
        strip.className = "doom-tile-strip";
        for (const artifactId of prompt.artifacts) {
          strip.appendChild(
            artifactTile(artifactId, null, false, () => choose({ kind: "pickArtifact", artifactId }))
          );
        }
        panel.appendChild(strip);
        break;
      }

      case "treasure": {
        panel.innerHTML = `<div class="t-label">Sponsor Drop</div>
          <p class="muted">A box with your name spelled almost correctly.</p>`;
        if (prompt.artifactId) {
          const strip = document.createElement("div");
          strip.className = "doom-tile-strip";
          strip.appendChild(
            artifactTile(prompt.artifactId, null, false, () =>
              choose({ kind: "pickArtifact", artifactId: prompt.artifactId! })
            )
          );
          panel.appendChild(strip);
        }
        addAction(`Take ${prompt.clout} Clout instead`, { kind: "skip" }, "doom-take-clout", prompt.artifactId !== null);
        break;
      }

      case "cardRemove": {
        panel.innerHTML = `<div class="t-label">${escape(prompt.title)}</div>
          <p class="muted">${
            prompt.cost > 0
              ? `Costs ${prompt.cost} Clout, charged when you actually cut something.`
              : "Free. Collab recruits cannot be cut."
          }</p>`;
        panel.appendChild(
          deckRows(active, { mode: "cut", onPick: (index) => choose({ kind: "removeCardAt", index }) })
        );
        addAction("Cancel", { kind: "skip" }, "doom-cancel-remove");
        break;
      }

      case "cardUpgrade": {
        panel.innerHTML = `<div class="t-label">${escape(prompt.title)}</div>
          <p class="muted">${
            prompt.cost > 0
              ? `Costs ${prompt.cost} Clout, charged when you actually Remaster something.`
              : "Free. One copy only — the copy beside it stays as it is."
          }</p>`;
        panel.appendChild(
          deckRows(active, { mode: "upgrade", onPick: (index) => choose({ kind: "upgradeCardAt", index }) })
        );
        addAction("Cancel", { kind: "skip" }, "doom-cancel-upgrade");
        break;
      }

      case "rest": {
        panel.innerHTML = `<div class="t-label">Touch Grass Break</div>
          <h2 class="title">Outside</h2>
          <p class="muted">It is fine out here. There is a bird.</p>`;
        addAction(`Heal ${prompt.heal}`, { kind: "rest", option: "heal" }, "doom-rest-heal", false);
        addAction("Remaster a card instead", { kind: "rest", option: "upgrade" }, "doom-rest-upgrade");
        addAction("Cut a card instead", { kind: "rest", option: "remove" }, "doom-rest-remove");
        break;
      }

      case "event": {
        const event = eventById(data, prompt.eventId);
        panel.innerHTML = `<div class="t-label">Notification</div>
          <h2 class="title">${escape(event?.title ?? "")}</h2>
          <p class="doom-event-text">${escape(event?.text ?? "")}</p>`;
        const list = document.createElement("div");
        list.className = "doom-event-choices";
        (event?.choices ?? []).forEach((option, index) => {
          const button = document.createElement("button");
          button.className = "btn doom-event-choice";
          button.dataset["choice"] = String(index);
          button.innerHTML = `<span class="doom-choice-label">${escape(option.label)}</span>
            <span class="muted doom-choice-detail">${escape(option.detail)}</span>`;
          button.addEventListener("click", () => choose({ kind: "eventChoice", index }));
          list.appendChild(button);
        });
        panel.appendChild(list);
        break;
      }

      case "shop": {
        const price = removalPrice(data, active);
        const discount = artifactTotal(data, active, "shopDiscountPercent");
        panel.innerHTML = `<div class="t-label">Merch Table</div>
          <h2 class="title">Everything is slightly overpriced</h2>
          <p class="muted">You have <strong id="doom-shop-clout">${active.clout}</strong> run-Clout.${
            discount > 0 ? ` Golden Play Button: ${discount}% off.` : ""
          }</p>`;
        const strip = document.createElement("div");
        strip.className = "doom-tile-strip";
        for (const entry of prompt.cards) {
          const sold = prompt.soldCards.includes(entry.cardId);
          strip.appendChild(
            cardTile(entry.cardId, entry.price, sold, () => choose({ kind: "buyCard", cardId: entry.cardId }))
          );
        }
        if (prompt.artifactId) {
          strip.appendChild(
            artifactTile(prompt.artifactId, prompt.artifactPrice, prompt.artifactSold, () =>
              choose({ kind: "buyArtifact" })
            )
          );
        }
        panel.appendChild(strip);
        addAction(`Cut a card (${price})`, { kind: "buyRemoval" }, "doom-buy-removal");
        if (!prompt.upgradeSold) {
          addAction(`Remaster a card (${prompt.upgradePrice})`, { kind: "buyUpgrade" }, "doom-buy-upgrade");
        }
        addAction("Leave", { kind: "leaveShop" }, "doom-leave-shop", false);
        break;
      }
    }

    if (actions.childElementCount > 0) panel.appendChild(actions);
    promptHost.replaceChildren(panel);
  }

  // ---- summary -------------------------------------------------------------

  function renderSummary(active: RunState): void {
    const summary = summarize(data, active);
    /**
     * 09 §11's bonus daily, paid on **clearing** today's seed.
     *
     * Checking the seed is what makes it *the daily* rather than *a* run, and
     * checking `cleared` is what stops a run abandoned in Act 1 from filling
     * the slot. It pays once a day; a second clear of the same seed pays
     * nothing, which `completeDailyDoomscroll` decides rather than this screen.
     */
    const dailyPaid = summary.cleared ? completeDailyDoomscroll(content, active.seed) : null;
    titleEl.textContent = summary.cleared ? "Run cleared" : "Run over";
    metaEl.textContent = "";

    /**
     * A cleared run that stopped short of the gated finale says so, and says how
     * close it was. "You had two of three" is the sentence that decides the next
     * run's routing; "Run cleared" on its own hides that there was more.
     */
    const finaleName = data.acts.find((act) => act.requiresFragments !== undefined)?.name ?? "";
    const missedFinale = summary.cleared && !summary.reachedFinale && summary.fragmentsNeeded > 0;

    const panel = document.createElement("div");
    panel.className = "mat-panel r-panel doom-summary";
    panel.innerHTML = `
      <div class="t-label">${
        summary.reachedFinale ? "You put it back together" : summary.cleared ? "You reached the bottom" : "The feed won"
      }</div>
      <h2 class="title">${
        summary.reachedFinale ? "The First Signal, answered" : summary.cleared ? "Nothing below this" : "Run over"
      }</h2>
      <div class="doom-summary-grid">
        <div><span class="doom-summary-value">${summary.actsCleared}/${data.acts.length}</span><span class="muted">acts</span></div>
        <div><span class="doom-summary-value">${summary.battlesWon}/${summary.fightsEntered}</span><span class="muted">battles won / entered</span></div>
        <div><span class="doom-summary-value">${summary.deckSize}</span><span class="muted">cards ended with</span></div>
        <div><span class="doom-summary-value">${summary.artifacts}</span><span class="muted">artifacts</span></div>
        ${
          summary.fragmentsNeeded > 0
            ? `<div><span class="doom-summary-value">${summary.fragments}/${summary.fragmentsNeeded}</span><span class="muted">Signal Fragments</span></div>`
            : ""
        }
        <div><span class="doom-summary-value">${summary.runClout}</span><span class="muted">run-Clout</span></div>
        <div><span class="doom-summary-value">+${summary.accountClout}</span><span class="muted">Clout banked</span></div>
      </div>
      ${
        missedFinale
          ? `<p class="muted doom-summary-missed">You finished with ${summary.fragments} of ${summary.fragmentsNeeded} Signal Fragments, so <strong>${escape(finaleName)}</strong> stayed shut. One Elite per act opens it — the fights are harder, and that is the price.</p>`
          : ""
      }
      ${
        dailyPaid
          ? `<p class="doom-summary-daily" id="doom-daily-paid">Daily Doomscroll cleared — +${dailyPaid.clout} Clout${
              dailyPaid.xp > 0 ? `, +${dailyPaid.xp} XP` : ""
            }${dailyPaid.drops > 0 ? `, and ${dailyPaid.drops} Merch Drop${dailyPaid.drops === 1 ? "" : "s"} for seven dailies` : ""}.</p>`
          : ""
      }
      <p class="muted">Run-Clout converts at ${data.run.cloutConversion}:1. Every card and artifact you found stays in the run.</p>`;

    const done = document.createElement("button");
    done.className = "btn btn-primary";
    done.id = "doom-collect";
    done.textContent = `Collect ${summary.accountClout} Clout`;
    done.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      // pay first, then clear — finishRun is what removes the run, so a reload
      // between the two would lose the payout rather than duplicate it
      if (summary.accountClout > 0) {
        profileStore.update((draft) => {
          draft.clout += summary.accountClout;
        });
      }
      finishRun({ cleared: summary.cleared, actsCleared: summary.actsCleared, accountClout: summary.accountClout });
      run = null;
      render();
    });
    panel.appendChild(done);
    body.replaceChildren(panel);
    promptHost.setAttribute("hidden", "");
    promptHost.replaceChildren();
  }

  // ---- render --------------------------------------------------------------

  function render(): void {
    if (!run) {
      renderSetup();
      promptHost.setAttribute("hidden", "");
      promptHost.replaceChildren();
      return;
    }
    if (run.status === "won" || run.status === "dead") {
      renderSummary(run);
      return;
    }

    const act = actOf(data, run);
    titleEl.textContent = act.name;
    const node = currentNode(run);
    metaEl.textContent = node
      ? `Floor ${node.floor + 1} of ${run.map.floors.length} · ${NODE_NAME[node.kind]}`
      : `Floor 1 of ${run.map.floors.length} · pick a way down`;

    const layout = document.createElement("div");
    layout.className = "doom-layout";
    layout.appendChild(renderSidebar(run));

    const main = document.createElement("div");
    main.className = "doom-main scroll";
    if (run.status === "battle") {
      const brief = renderBattleBrief(run);
      if (brief) main.appendChild(brief);
    }
    main.appendChild(renderMap(run));
    layout.appendChild(main);

    body.replaceChildren(layout);
    renderPrompt(run);
  }

  root.querySelector("#doom-back")?.addEventListener("click", () => callbacks.onBack());
  render();

  /**
   * Debug handle. The browser verification drives a whole run through this —
   * clicking through fifteen nodes and two boss fights per check would be slower
   * than the game and would only ever exercise one path.
   */
  (window as unknown as { hypeboundRun?: unknown }).hypeboundRun = {
    state: () => run,
    data: () => data,
    reachable: () => (run ? reachableNodeIds(run) : []),
    enter: (id: string) => {
      if (run) commit(enterNode(data, content, run, id));
    },
    choose: (choice: RunChoice) => choose(choice),
    battle: () => (run ? battleFor(data, content, run) : null),
    profileClout: () => getProfile().clout,
    /**
     * Automation only: settle the fight the run is standing on without playing
     * it. The verification uses this to reach the map's later node types — every
     * path down starts with a battle, so without it the only reachable node kind
     * is "battle". It plays one fight for real, through the battle screen's own
     * exit path, before it starts skipping them.
     */
    resolveFight: (won: boolean, health: number) => {
      if (run) commit(resolveBattle(data, content, run, { won, leaderHealth: health }));
    },
    /**
     * Automation only: hand the run a specific artifact. Which artifacts a run
     * is offered is seeded, so a check that wants to prove one particular
     * artifact reaches the board would otherwise be at the mercy of the map.
     */
    grantArtifact: (artifactId: string) => {
      if (!run || run.artifacts.includes(artifactId)) return;
      commit(resolvePrompt(data, content, { ...run, prompts: [{ kind: "artifactPick", title: "debug", artifacts: [artifactId] }] }, { kind: "pickArtifact", artifactId }));
    },
    /**
     * Automation only: Remaster one copy by index, through the ordinary prompt.
     *
     * Same reason as `grantArtifact`: whether a run is *offered* an upgrade is a
     * matter of which nodes the map rolled, and proving a Remastered card
     * reaches the board means putting one in the deck rather than hoping.
     */
    upgradeCardAt: (index: number) => {
      if (!run) return;
      commit(
        resolvePrompt(
          data,
          content,
          { ...run, prompts: [{ kind: "cardUpgrade", title: "debug", cost: 0 }] },
          { kind: "upgradeCardAt", index }
        )
      );
    },
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundRun?: unknown }).hypeboundRun;
    },
    resume: () => {
      run = activeRun();
      render();
    },
  };
}
