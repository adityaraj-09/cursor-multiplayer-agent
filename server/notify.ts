/**
 * Optional outbound notifications for collaboration events.
 *
 * Configure either or both:
 * - SLACK_WEBHOOK_URL — Slack incoming webhook
 * - NOTIFY_WEBHOOK_URL — generic JSON webhook (email bridges, Zapier, etc.)
 */

export type NotifyKind =
  | "invite_created"
  | "drive_requested"
  | "run_finished"
  | "member_role_changed"
  | "org_transferred"
  | "org_deleted";

export interface NotifyPayload {
  kind: NotifyKind;
  title: string;
  text: string;
  roomId?: string;
  orgId?: string;
  actorUserId?: string;
  meta?: Record<string, unknown>;
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
