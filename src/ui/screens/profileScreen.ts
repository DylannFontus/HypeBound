/**
 * The player profile — identity, and where cosmetics are worn.
 *
 * `03-screens-and-navigation.md` §4.5.4: *"Avatar portrait + profile frame +
 * equipped title (all editable via cosmetic picker); account level and XP;
 * faction mastery bars; lifetime headline stats."*
 *
 * Until now the lobby's player chip led to Settings, because there was nothing
 * to show — no title, no frame, nothing to wear. This screen is the other half
 * of the cosmetics layer: the tracks grant, and this is where a player finds out
 * what they were granted and puts it on.
 *
 * The parts of §4.5.4 that need the server (profile visibility, other players'
 * profiles, add friend / challenge / block) are absent rather than stubbed, in
 * keeping with how every other online feature is treated.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import type { Cosmetic, CosmeticKind } from "../../game/cosmetics";
import { WEARABLE_KINDS } from "../../game/cosmetics";
import {
  achievementBoard,
  achievementsUnclaimed,
  equipCosmetic,
  emoteWheel,
  factionMastery,
  getProfile,
  myCosmetics,
  wearing,
  xpForLevel,
} from "../../save/profile";
import { drawEmblem, hexToRgb } from "../cosmetics/emblem";
import { audio } from "../../audio/audio";

export interface ProfileCallbacks {
  onBack: () => void;
  onMastery: () => void;
  onCollection: () => void;
  onAchievements: () => void;
  onHistory: () => void;
  onStats: () => void;
  onGallery: () => void;
  onLeaderboards: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const SLOT_LABEL: Record<CosmeticKind, string> = {
  cardBack: "Card back",
  title: "Title",
  frame: "Profile frame",
  badge: "Badge",
  emote: "Emotes",
};

/** Draw a frame's crest ring into a canvas — the avatar's border. */
function paintFrame(canvas: HTMLCanvasElement, frame: Cosmetic | null): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  const [r, g, b] = hexToRgb(frame?.color ?? "#8f8aa8");

  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.9)`;
  ctx.lineWidth = size * 0.035;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
  ctx.stroke();

  if (!frame) return;
  // the faction's own emblem, small, behind the initial
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.12)`;
  ctx.lineWidth = size * 0.012;
  drawEmblem(ctx, frame.emblem ?? "diamond", size / 2, size / 2, size / 260);
}

/** A card back, drawn small for the preview. `null` draws the house design. */
function paintBack(canvas: HTMLCanvasElement, back: Cosmetic | null, color: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const emblem = back?.emblem ?? "diamond";
  const [r, g, b] = hexToRgb(color);
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, `rgb(${Math.round(r * 0.34)}, ${Math.round(g * 0.34)}, ${Math.round(b * 0.42)})`);
  grad.addColorStop(1, "#0b0518");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.6)`;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.18)`;
  ctx.lineWidth = 1.5;
  drawEmblem(ctx, emblem, canvas.width / 2, canvas.height / 2, canvas.width / 200);
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.35)`;
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
}

export function createProfileScreen(content: ContentIndex, callbacks: ProfileCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen profile-screen";

  /** which slot's picker is open, or null */
  let picking: CosmeticKind | null = null;

  const render = (): void => {
    const profile = getProfile();
    const owned = myCosmetics(content);
    const title = wearing(content, "title");
    const frame = wearing(content, "frame");
    const badge = wearing(content, "badge");
    const back = wearing(content, "cardBack");
    const emotes = emoteWheel(content);
    const tracks = factionMastery(content).filter((track) => track.xp > 0);

    const board = achievementBoard(content);
    const points = board.points;
    const unclaimed = achievementsUnclaimed(content);

    const xpNeeded = xpForLevel(profile.accountLevel);
    const winRate =
      profile.stats.matchesPlayed > 0 ? Math.round((profile.stats.wins / profile.stats.matchesPlayed) * 100) : 0;

    const slotRow = (kind: CosmeticKind, worn: Cosmetic | null): string => {
      const count = owned.filter((cosmetic) => cosmetic.kind === kind).length;
      return `
        <li class="profile-slot ${picking === kind ? "open" : ""}" data-slot="${kind}">
          <div class="profile-slot-head">
            <span class="profile-slot-label">${SLOT_LABEL[kind]}</span>
            <span class="profile-slot-worn">${worn ? esc(worn.name) : "<span class='muted'>Default</span>"}</span>
            <button class="btn btn-ghost profile-slot-toggle" data-slot="${kind}">
              ${count === 0 ? "None earned" : picking === kind ? "Close" : `Change (${count})`}
            </button>
          </div>
          ${
            picking === kind
              ? `<div class="profile-picker">
                   <button class="btn btn-ghost profile-option ${worn === null ? "active" : ""}" data-slot="${kind}" data-id="">
                     Default
                   </button>
                   ${owned
                     .filter((cosmetic) => cosmetic.kind === kind)
                     .map(
                       (cosmetic) => `
                         <button class="btn btn-ghost profile-option ${worn?.id === cosmetic.id ? "active" : ""}"
                                 data-slot="${kind}" data-id="${esc(cosmetic.id)}" title="${esc(cosmetic.source)}">
                           <span class="profile-swatch" style="--c:${esc(cosmetic.color)}"></span>
                           ${esc(cosmetic.name)}
                         </button>`
                     )
                     .join("")}
                 </div>`
              : ""
          }
        </li>`;
    };

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="profile-back">← Back</button>
        <h1 class="title">Profile</h1>
      </header>

      <main class="profile-body">
        <section class="panel panel-chrome profile-identity">
          <div class="profile-avatar-wrap">
            <canvas class="profile-frame-canvas" id="profile-frame" width="220" height="220"></canvas>
            <div class="profile-avatar" style="--c:${esc(frame?.color ?? "#8f8aa8")}">
              ${esc(profile.displayName.charAt(0).toUpperCase())}
            </div>
            ${badge ? `<span class="profile-badge" style="--c:${esc(badge.color)}" title="${esc(badge.source)}">${esc(badge.name.charAt(0))}</span>` : ""}
          </div>
          <div class="profile-identity-text">
            <h2 class="profile-name">${esc(profile.displayName)}</h2>
            <p class="profile-title ${title ? "" : "muted"}" id="profile-title">
              ${title ? esc(title.name) : "No title equipped"}
            </p>
            <div class="profile-level">
              <span>Level ${profile.accountLevel}</span>
              <span class="profile-xp"><span style="width:${Math.min(100, (profile.accountXp / xpNeeded) * 100)}%"></span></span>
              <span class="muted">${profile.accountXp} / ${xpNeeded} XP</span>
            </div>
          </div>
          <dl class="profile-stats">
            <div><dt>Matches</dt><dd>${profile.stats.matchesPlayed}</dd></div>
            <div><dt>Wins</dt><dd>${profile.stats.wins}</dd></div>
            <div><dt>Win rate</dt><dd>${winRate}%</dd></div>
            <div><dt>Cards</dt><dd>${Object.keys(profile.collection).length}</dd></div>
            <div><dt>Points</dt><dd>${points}</dd></div>
          </dl>
          <div class="profile-links">
            <button class="btn btn-ghost" id="profile-achievements">
              Achievements${unclaimed > 0 ? ` <span class="mastery-badge">${unclaimed}</span>` : ""} →
            </button>
            <button class="btn btn-ghost" id="profile-history">Match history →</button>
            <button class="btn btn-ghost" id="profile-stats">Statistics →</button>
            <button class="btn btn-ghost" id="profile-gallery">Characters →</button>
            <button class="btn btn-ghost" id="profile-leaderboards">Leaderboards →</button>
          </div>
        </section>

        <section class="panel panel-chrome profile-cosmetics">
          <h3 class="profile-section-title">Cosmetics</h3>
          <p class="muted profile-hint">
            Earned by playing — Faction and Leader Mastery, and the Bias Board. Nothing here can be bought.
          </p>
          <ul class="profile-slots">
            ${slotRow("title", title)}
            ${slotRow("frame", frame)}
            ${slotRow("badge", badge)}
            ${slotRow("cardBack", back)}
          </ul>
          <div class="profile-back-preview">
            <canvas id="profile-back-canvas" width="120" height="168"></canvas>
            <p class="muted">${back ? `Your cards show the ${esc(back.name)}.` : "Your cards show the house back."}</p>
          </div>
        </section>

        <section class="panel panel-chrome profile-emotes">
          <h3 class="profile-section-title">Emote wheel <span class="muted">${emotes.length}</span></h3>
          <p class="muted profile-hint">
            The six you start with are never taken away. Mastery adds to the wheel rather than replacing it.
          </p>
          <ul class="profile-emote-list">
            ${emotes.map((phrase) => `<li class="profile-emote">${esc(phrase)}</li>`).join("")}
          </ul>
        </section>

        <section class="panel panel-chrome profile-mastery">
          <h3 class="profile-section-title">Faction Mastery</h3>
          ${
            tracks.length === 0
              ? `<p class="muted">Play a match and the faction you played it with appears here.</p>`
              : `<ul class="profile-tracks">
                   ${tracks
                     .map(
                       (track) => `
                         <li class="profile-track">
                           <span class="profile-track-name">${esc(track.name)}</span>
                           <span class="profile-track-bar"><span style="width:${track.maxed ? 100 : Math.min(100, (track.intoRank / Math.max(1, track.toNext)) * 100)}%"></span></span>
                           <span class="muted">Rank ${track.rank}</span>
                         </li>`
                     )
                     .join("")}
                 </ul>`
          }
          <button class="btn btn-ghost" id="profile-mastery">Open Mastery →</button>
        </section>
      </main>`;

    const frameCanvas = root.querySelector<HTMLCanvasElement>("#profile-frame");
    if (frameCanvas) paintFrame(frameCanvas, frame);
    const backCanvas = root.querySelector<HTMLCanvasElement>("#profile-back-canvas");
    // the preview shows the house design when nothing is worn, so the panel is
    // never an empty rectangle captioned "your cards show the house back"
    if (backCanvas) paintBack(backCanvas, back, back?.color ?? "#b56cff");

    root.querySelector("#profile-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#profile-mastery")?.addEventListener("click", () => callbacks.onMastery());
    root.querySelector("#profile-achievements")?.addEventListener("click", () => callbacks.onAchievements());
    root.querySelector("#profile-history")?.addEventListener("click", () => callbacks.onHistory());
    root.querySelector("#profile-stats")?.addEventListener("click", () => callbacks.onStats());
    root.querySelector("#profile-gallery")?.addEventListener("click", () => callbacks.onGallery());
    root.querySelector("#profile-leaderboards")?.addEventListener("click", () => callbacks.onLeaderboards());

    for (const button of root.querySelectorAll<HTMLElement>(".profile-slot-toggle")) {
      button.addEventListener("click", () => {
        const kind = button.dataset["slot"] as CosmeticKind;
        picking = picking === kind ? null : kind;
        audio.play("sfx.ui.hover");
        render();
      });
    }
    for (const option of root.querySelectorAll<HTMLElement>(".profile-option")) {
      option.addEventListener("click", () => {
        const kind = option.dataset["slot"] as CosmeticKind;
        const id = option.dataset["id"] ?? "";
        if (equipCosmetic(content, kind, id === "" ? null : id)) audio.play("sfx.ui.click");
        picking = null;
        render();
      });
    }
  };

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundProfile?: unknown }).hypeboundProfile = {
    owned: () => myCosmetics(content).map((cosmetic) => ({ id: cosmetic.id, kind: cosmetic.kind, name: cosmetic.name })),
    wearing: () =>
      Object.fromEntries(
        WEARABLE_KINDS.map((kind) => [kind, wearing(content, kind)?.id ?? null])
      ),
    equip: (kind: CosmeticKind, id: string | null) => {
      const ok = equipCosmetic(content, kind, id);
      render();
      return ok;
    },
    emotes: () => emoteWheel(content),
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundProfile?: unknown }).hypeboundProfile;
    },
  };
}
