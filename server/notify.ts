/**
 * Optional outbound notifications for collaboration events.
 *
 * Configure either or both:
 * - SLACK_WEBHOOK_URL — Slack incoming webhook (global fallback)
 * - NOTIFY_WEBHOOK_URL — generic JSON webhook (email bridges, Zapier, etc.)
 *
 * Rooms may also store a per-room Slack webhook (encrypted) used by
 * {@link notifyReviewFlag}.
 */

export type NotifyKind =
  | "invite_created"
  | "drive_requested"
  | "run_finished"
  | "member_role_changed"
  | "org_transferred"
  | "org_deleted"
  | "review_flagged";

export interface NotifyPayload {
  kind: NotifyKind;
  title: string;
  text: string;
  roomId?: string;
  orgId?: string;
  actorUserId?: string;
  meta?: Record<string, unknown>;
}

export interface ReviewFlagNotifyInput {
  /** Per-room Slack webhook; falls back to SLACK_WEBHOOK_URL when omitted. */
  webhookUrl?: string;
  roomId: string;
  roomName: string;
  actorName: string;
  note?: string;
  pingId: string;
  joinUrl: string;
  targetSummary?: string;
}

function slackWebhook(): string {
  return process.env.SLACK_WEBHOOK_URL?.trim() || "";
}

function genericWebhook(): string {
  return process.env.NOTIFY_WEBHOOK_URL?.trim() || "";
}

export function notificationsConfigured(): boolean {
  return Boolean(slackWebhook() || genericWebhook());
}

export function envSlackWebhookConfigured(): boolean {
  return Boolean(slackWebhook());
}

async function postJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`notify webhook ${res.status}: ${text.slice(0, 200)}`);
  }
}

function slackReviewBlocks(input: ReviewFlagNotifyInput) {
  const noteLine = input.note?.trim()
    ? `\n>${input.note.trim().replace(/\n/g, "\n>")}`
    : "";
  const who = input.targetSummary?.trim()
    ? ` · ${input.targetSummary.trim()}`
    : "";
  const mrkdwn = `*${input.actorName}* flagged *${input.roomName}* for review${who}${noteLine}`;
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: mrkdwn,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open & acknowledge", emoji: true },
          url: input.joinUrl,
          style: "primary",
          action_id: "steer_ack_review",
        },
      ],
    },
  ];
}

/** Fire-and-forget; never throws to callers. */
export function notifyEvent(payload: NotifyPayload): void {
  const slack = slackWebhook();
  const generic = genericWebhook();
  if (!slack && !generic) return;

  void (async () => {
    try {
      const tasks: Promise<void>[] = [];
      if (slack) {
        tasks.push(
          postJson(slack, {
            text: `*${payload.title}*\n${payload.text}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*${payload.title}*\n${payload.text}`,
                },
              },
            ],
          }),
        );
      }
      if (generic) {
        tasks.push(
          postJson(generic, {
            ...payload,
            ts: Date.now(),
            source: "steer",
          }),
        );
      }
      await Promise.allSettled(tasks);
    } catch (err) {
      console.warn(
        "[notify]",
        err instanceof Error ? err.message : err,
      );
    }
  })();
}

/**
 * Notify Slack (room webhook or env fallback) + generic webhook that a
 * session was flagged for human review. Fire-and-forget.
 */
export function notifyReviewFlag(input: ReviewFlagNotifyInput): void {
  const slack = input.webhookUrl?.trim() || slackWebhook();
  const generic = genericWebhook();
  if (!slack && !generic) return;

  const title = `Review needed: ${input.roomName}`;
  const text = `${input.actorName} flagged the session for review.${
    input.note?.trim() ? ` ${input.note.trim()}` : ""
  } ${input.joinUrl}`;

  void (async () => {
    try {
      const tasks: Promise<void>[] = [];
      if (slack) {
        tasks.push(
          postJson(slack, {
            text: `${title}\n${text}`,
            blocks: slackReviewBlocks(input),
          }),
        );
      }
      if (generic) {
        tasks.push(
          postJson(generic, {
            kind: "review_flagged" satisfies NotifyKind,
            title,
            text,
            roomId: input.roomId,
            pingId: input.pingId,
            joinUrl: input.joinUrl,
            actorName: input.actorName,
            note: input.note,
            ts: Date.now(),
            source: "steer",
          }),
        );
      }
      await Promise.allSettled(tasks);
    } catch (err) {
      console.warn(
        "[notify:review]",
        err instanceof Error ? err.message : err,
      );
    }
  })();
}
