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
import {
  cloutIcon,
  count,
  countUp,
  disposeBag,
  enter,
  esc,
  fadeOnScroll,
  icon,
  quantify,
  rovingList,
  shortDate,
  unspec,
} from "./data/kit";

export interface InboxCallbacks {
  onBack: () => void;
  onOpen: (screen: MailRoute, param?: string) => void;
}

/**
 * A drawn mark per sender, so the list is not five rows of the word "System".
 *
 * The topic is the only thing distinguishing one message from another before its
 * subject is read, and it was carried by a small grey caption. An icon at the
 * head of the row does that job in the width the unread dot was already taking.
 */
const TOPIC_ICON: Record<MailTopic, Parameters<typeof icon>[0]> = {
  welcome: "profile",
  season: "hype-wave",
  banner: "merch-drop",
  checkin: "campfire",
  returning: "hype-wave",
  news: "info",
  event: "events",
};

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
  `${cloutIcon(15)}<span class="num">${count(reward.amount)}</span> Clout`;

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
  const bag = disposeBag();

  const render = (): void => {
    bag.run();
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

    /**
     * A message row, as a focusable button.
     *
     * It was an `<li>` with a click listener and an `aria-hidden` 6px dot, so an
     * inbox was neither reachable by keyboard nor readable by a screen reader —
     * and read and unread were the same announcement. Now: a real control, a
     * `sr-only` "Unread", and a weight change on the subject so the state
     * survives greyscale as well as a missing colour channel.
     */
    const listRow = (view: MailView): string => {
      const { message } = view;
      const open = message.id === openId;
      return `
        <li>
          <button type="button"
                  class="mail-row d-row mat-panel act d-enter ${view.read ? "" : "unread is-unread"} ${
                    open ? "active is-open" : ""
                  }"
                  data-id="${esc(message.id)}" ${open ? `aria-current="true"` : ""}>
            ${view.read ? "" : `<span class="sr-only">Unread</span>`}
            <span class="mail-topic" aria-hidden="true">${icon(TOPIC_ICON[message.topic], 18)}</span>
            <span class="d-row-body">
              <span class="mail-row-head">
                <span class="mail-sender">${esc(TOPIC_LABEL[message.topic])}</span>
                <span class="mail-date">${esc(shortDate(message.sentAt))}</span>
              </span>
              <span class="d-row-title mail-subject">${esc(message.subject)}</span>
              ${view.claimable ? `<span class="mail-flag">${icon("chest", 12)} Attachment waiting</span>` : ""}
            </span>
            <span class="d-dot" aria-hidden="true"></span>
          </button>
        </li>`;
    };

    const reader = (view: MailView | null): string => {
      if (!view) {
        return `
          <div class="empty d-enter mail-empty">
            ${icon("inbox", 40)}
            <h3 class="t-heading">Nothing in here</h3>
            <p class="t-body">
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
            <span class="mail-reading-mark" aria-hidden="true">${icon(TOPIC_ICON[message.topic], 22)}</span>
            <div class="mail-reading-titles">
              <div class="t-label">${esc(TOPIC_LABEL[message.topic])} · ${esc(shortDate(message.sentAt))}</div>
              <h2 class="mail-reading-subject t-display">${esc(message.subject)}</h2>
            </div>
          </header>
          <div class="mail-reading-body" id="mail-reading-body">
            ${message.body.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}
          </div>
          ${
            message.attachment && message.attachment.length > 0
              ? `<div class="mail-attachment mat-well ${view.claimed ? "claimed" : ""}">
                   <div class="t-label">Attached</div>
                   <div class="mail-attachment-items">
                     ${message.attachment.map((reward) => `<span class="mail-reward">${rewardLabel(reward)}</span>`).join("")}
                   </div>
                   ${
                     view.claimed
                       ? `<span class="mail-taken">${icon("check", 14)} Taken</span>`
                       : `<button type="button" class="mat-hero act r-chip" id="mail-claim">Take it</button>`
                   }
                 </div>`
              : ""
          }
          <footer class="mail-reading-foot">
            <p class="mail-retention">${icon("timer", 13)} ${esc(retentionLine(message, view.claimable, now))}</p>
            <div class="mail-actions">
              ${
                message.link
                  ? `<button type="button" class="mat-hero act r-chip" id="mail-link" data-screen="${esc(
                      message.link.screen
                    )}"
                             ${message.link.param ? `data-param="${esc(message.link.param)}"` : ""}>${esc(
                               message.link.label
                             )} ${icon("chevron-right", 13)}</button>`
                  : ""
              }
              <button type="button" class="mat-chip act r-chip" id="mail-delete"
                      ${
                        view.claimable
                          ? `disabled title="Take the attachment first — it cannot be thrown away by accident"`
                          : ""
                      }>${icon("trash", 13)} Delete</button>
            </div>
          </footer>
        </article>`;
    };

    const profile = getProfile();
    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="inbox-back">${icon("arrow-left", 16)} Back</button>
        <h1 class="title">Inbox</h1>
        <div class="mastery-wallet">
          <div class="currency">${cloutIcon(15)}<span class="currency-value num" id="inbox-clout">${count(
            profile.clout
          )}</span></div>
        </div>
      </header>

      <main class="inbox-body data-body data-wide">
        <section class="mat-panel inbox-list-panel">
          <div class="inbox-list-head">
            <div>
              <div class="t-label">System mail</div>
              <div class="inbox-counts" id="inbox-counts">
                ${quantify(views.length, "message")} ·
                <span id="inbox-unread" class="num">${count(unread)}</span> unread${
                  waiting > 0 ? ` · ${count(waiting)} with something attached` : ""
                }
              </div>
            </div>
            <div class="inbox-list-actions">
              <button type="button" class="mat-chip act r-chip" id="inbox-read-all" ${
                unread === 0 ? "disabled" : ""
              }>${icon("check", 13)} Mark all read</button>
              <button type="button" class="mat-chip act r-chip" id="inbox-clear" ${
                views.every((view) => !view.read || view.claimable) ? "disabled" : ""
              }>${icon("trash", 13)} Clear read</button>
            </div>
          </div>
          <ul class="mail-list" id="mail-list">${views.map(listRow).join("")}</ul>
        </section>

        <section class="mat-panel inbox-reader" id="inbox-reader">${reader(open)}</section>

        <section class="mat-panel inbox-deferred">
          <h3 class="t-heading">Who cannot write to you yet</h3>
          <p class="t-body">
            Offline, the game itself is the only sender. Everyone else is listed here with the
            reason they are silent — listed rather than hidden, because a quiet inbox and a broken
            one look identical from the outside.
          </p>
          <ul class="mail-deferred-list">
            ${[...DEFERRED_SENDERS]
              .map(
                ([sender, reason]) =>
                  `<li class="mat-panel mail-deferred d-enter">${icon("lock", 14)}
                     <span><strong>${esc(sender)}</strong> — ${esc(unspec(reason))}.</span></li>`
              )
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

    enter(root);
    countUp(root);
    bag.add(rovingList(root.querySelector<HTMLElement>("#mail-list"), ".mail-row"));
    bag.add(fadeOnScroll(root.querySelector<HTMLElement>("#mail-list")));
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
      bag.run();
      delete (window as unknown as { hypeboundInbox?: unknown }).hypeboundInbox;
    },
  };
}
