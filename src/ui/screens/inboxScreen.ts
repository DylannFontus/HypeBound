/**
 * Inbox — `03-screens-and-navigation.md` §4.5.3.
 *
 * A message list with unread markers on the left, the open message on the right,
 * attachments claimed in place, delete and mark-read, and the retention note the
 * design asks for.
 *
 * Three things this screen is careful about:
 *
 * **The quiet is explained.** An inbox with nothing in it is indistinguishable
 * from an inbox that is broken, so the senders that cannot exist yet are printed
 * with the reason each one is missing. That is the leaderboards screen's rule
 * applied to a screen that is *partly* live: no fake friends, and no silence that
 * could be mistaken for lost mail either.
 *
 * **Nothing claims itself.** §4.2.4 — an attachment sits until it is taken. The
 * button is the only thing that pays.
 *
 * **Retention is stated per message, not in the small print.** A message says
 * when it will clear, and one holding something you have not taken says instead
 * that it is staying put — which is the visible half of the rule that an
 * attachment cannot be lost by not reading your mail.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import type { MailMessage, MailReward, MailRoute, MailTopic } from "../../game/inbox";
import { DEFERRED_SENDERS, RETENTION_DAYS } from "../../game/inbox";
import {
  claimMail,
  deleteMail,
  deleteReadMail,
  getProfile,
  inboxViews,
  markAllMailRead,
  markMailRead,
  type MailView,
} from "../../save/profile";
import { audio } from "../../audio/audio";

export interface InboxCallbacks {
  onBack: () => void;
  onOpen: (screen: MailRoute, param?: string) => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const SENT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

/** What each topic is called on a row, so the sender line is never just "System". */
const TOPIC_LABEL: Record<MailTopic, string> = {
  welcome: "System",
  season: "Hype Wave",
  banner: "Headliner",
  checkin: "Stream Check-In",
  returning: "Hype Wave",
  news: "Announcement",
  event: "Event Hub",
};

const rewardLabel = (reward: MailReward): string =>
  `<span class="currency-icon clout">◈</span>${reward.amount.toLocaleString()} Clout`;

/** "clears in 12 days", or the promise that it will not. */
function retentionLine(message: MailMessage, claimable: boolean, now: number): string {
  if (claimable || message.expiresAt === null) {
    return "Kept until you take what is attached. It will not expire while it still owes you something.";
  }
  const days = Math.max(0, Math.ceil((message.expiresAt - now) / 86_400_000));
  return days <= 1 ? "Clears from your inbox today." : `Clears from your inbox in ${days} days.`;
}

export function createInboxScreen(content: ContentIndex, callbacks: InboxCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen inbox-screen";

  /** Which message is open. Null until the first render picks the newest. */
  let openId: string | null = null;

  const render = (): void => {
    const now = Date.now();
    let views = inboxViews(content, now);

    if (openId !== null && !views.some((view) => view.message.id === openId)) openId = null;
    if (openId === null) openId = views[0]?.message.id ?? null;

    /**
     * Whatever is showing has been read. Without this the newest message is
     * displayed in full and still counted unread, so the lobby badge would
     * outlive the thing it is pointing at. Done before the counts are taken, so
     * the header never disagrees with the list under it.
     */
    if (openId !== null && !views.find((view) => view.message.id === openId)?.read) {
      markMailRead(content, openId, now);
      views = inboxViews(content, now);
    }

    const unread = views.filter((view) => !view.read).length;
    const waiting = views.filter((view) => view.claimable).length;
    const open: MailView | null = views.find((view) => view.message.id === openId) ?? null;

    const listRow = (view: MailView): string => {
      const { message } = view;
      return `
        <li class="mail-row ${view.read ? "" : "unread"} ${message.id === openId ? "active" : ""}"
            data-id="${esc(message.id)}">
          <span class="mail-dot" aria-hidden="true"></span>
          <span class="mail-row-body">
            <span class="mail-row-head">
              <span class="mail-sender">${esc(TOPIC_LABEL[message.topic])}</span>
              <span class="mail-date muted">${SENT.format(new Date(message.sentAt))}</span>
            </span>
            <span class="mail-subject">${esc(message.subject)}</span>
            ${view.claimable ? `<span class="mail-flag">Attachment waiting</span>` : ""}
          </span>
        </li>`;
    };

    const reader = (view: MailView | null): string => {
      if (!view) {
        return `
          <div class="mail-empty">
            <h2 class="profile-section-title">Nothing in here</h2>
            <p class="muted">
              Mail clears itself after ${RETENTION_DAYS} days, so an empty inbox means the last
              month has been quiet rather than that something went missing. Anything holding a
              reward stays until you take it.
            </p>
          </div>`;
      }
      const { message } = view;
      return `
        <article class="mail-reading" data-id="${esc(message.id)}">
          <header class="mail-reading-head">
            <div class="eyebrow">${esc(TOPIC_LABEL[message.topic])} · ${SENT.format(new Date(message.sentAt))}</div>
            <h2 class="mail-reading-subject">${esc(message.subject)}</h2>
          </header>
          <div class="mail-reading-body">
            ${message.body.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}
          </div>
          ${
            message.attachment && message.attachment.length > 0
              ? `<div class="mail-attachment ${view.claimed ? "claimed" : ""}">
                   <div class="eyebrow">Attached</div>
                   <div class="mail-attachment-items">
                     ${message.attachment.map((reward) => `<span class="mail-reward">${rewardLabel(reward)}</span>`).join("")}
                   </div>
                   ${
                     view.claimed
                       ? `<span class="muted">Taken.</span>`
                       : `<button class="btn btn-primary" id="mail-claim">Take it</button>`
                   }
                 </div>`
              : ""
          }
          <footer class="mail-reading-foot">
            <p class="faint">${esc(retentionLine(message, view.claimable, now))}</p>
            <div class="mail-actions">
              ${
                message.link
                  ? `<button class="btn btn-ghost" id="mail-link" data-screen="${esc(message.link.screen)}"
                             ${message.link.param ? `data-param="${esc(message.link.param)}"` : ""}>${esc(message.link.label)} →</button>`
                  : ""
              }
              <button class="btn btn-ghost" id="mail-delete"
                      ${view.claimable ? 'disabled title="Take the attachment first — it cannot be thrown away by accident"' : ""}>Delete</button>
            </div>
          </footer>
        </article>`;
    };

    const profile = getProfile();
    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="inbox-back">← Back</button>
        <h1 class="title">Inbox</h1>
        <div class="mastery-wallet">
          <div class="currency"><span class="currency-icon clout">◈</span><span class="currency-value" id="inbox-clout">${profile.clout.toLocaleString()}</span></div>
        </div>
      </header>

      <main class="inbox-body">
        <section class="panel panel-chrome inbox-list-panel">
          <div class="inbox-list-head">
            <div>
              <div class="eyebrow">System mail</div>
              <div class="muted" id="inbox-counts">
                ${views.length} message${views.length === 1 ? "" : "s"} ·
                <span id="inbox-unread">${unread}</span> unread${waiting > 0 ? ` · ${waiting} with something attached` : ""}
              </div>
            </div>
            <div class="inbox-list-actions">
              <button class="btn btn-ghost btn-sm" id="inbox-read-all" ${unread === 0 ? "disabled" : ""}>Mark all read</button>
              <button class="btn btn-ghost btn-sm" id="inbox-clear" ${views.every((view) => !view.read || view.claimable) ? "disabled" : ""}>Clear read</button>
            </div>
          </div>
          <ul class="mail-list" id="mail-list">${views.map(listRow).join("")}</ul>
        </section>

        <section class="panel panel-chrome inbox-reader" id="inbox-reader">${reader(open)}</section>

        <section class="panel panel-chrome inbox-deferred">
          <h3 class="profile-section-title">Who cannot write to you yet</h3>
          <p class="muted">
            Offline, the game itself is the only sender. These are the others §4.5.3 describes,
            and why each one is silent — listed rather than hidden, because a quiet inbox and a
            broken one look identical from the outside.
          </p>
          <ul class="mail-deferred-list">
            ${[...DEFERRED_SENDERS]
              .map(([sender, reason]) => `<li><strong>${esc(sender)}</strong><span class="muted"> — ${esc(reason)}.</span></li>`)
              .join("")}
          </ul>
        </section>
      </main>`;

    root.querySelector("#inbox-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });

    for (const row of root.querySelectorAll<HTMLElement>(".mail-row")) {
      row.addEventListener("click", () => {
        const id = row.dataset["id"];
        if (!id) return;
        openId = id;
        audio.play("sfx.ui.hover");
        markMailRead(content, id);
        render();
      });
    }

    root.querySelector("#inbox-read-all")?.addEventListener("click", () => {
      if (markAllMailRead(content) > 0) audio.play("sfx.ui.click");
      render();
    });
    root.querySelector("#inbox-clear")?.addEventListener("click", () => {
      if (deleteReadMail(content) > 0) audio.play("sfx.ui.click");
      render();
    });
    root.querySelector("#mail-claim")?.addEventListener("click", () => {
      if (openId && claimMail(content, openId)) audio.play("sfx.ui.confirm");
      render();
    });
    root.querySelector("#mail-delete")?.addEventListener("click", () => {
      if (openId && deleteMail(content, openId)) audio.play("sfx.ui.click");
      render();
    });
    root.querySelector("#mail-link")?.addEventListener("click", (event) => {
      const target = event.currentTarget as HTMLElement;
      const screen = target.dataset["screen"] as MailRoute | undefined;
      if (screen) callbacks.onOpen(screen, target.dataset["param"]);
    });
  };

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundInbox?: unknown }).hypeboundInbox = {
    list: () =>
      inboxViews(content).map((view) => ({
        id: view.message.id,
        topic: view.message.topic,
        subject: view.message.subject,
        body: view.message.body,
        sentAt: view.message.sentAt,
        expiresAt: view.message.expiresAt,
        read: view.read,
        claimed: view.claimed,
        claimable: view.claimable,
        attachment: view.message.attachment ?? [],
      })),
    unread: () => inboxViews(content).filter((view) => !view.read).length,
    open: (id: string) => {
      openId = id;
      markMailRead(content, id);
      render();
      return id;
    },
    claim: (id: string) => {
      const grant = claimMail(content, id);
      render();
      return grant;
    },
    remove: (id: string) => {
      const gone = deleteMail(content, id);
      render();
      return gone;
    },
    readAll: () => {
      const count = markAllMailRead(content);
      render();
      return count;
    },
    clearRead: () => {
      const count = deleteReadMail(content);
      render();
      return count;
    },
    deferred: () => [...DEFERRED_SENDERS].map(([sender, reason]) => ({ sender, reason })),
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundInbox?: unknown }).hypeboundInbox;
    },
  };
}
