import webPush from "web-push";
import { createHook, FatalError, sleep } from "workflow";
import { hookToken } from "../src/validation.mjs";

type PushSubscriptionJSON = {
  endpoint: string;
  expirationTime: null;
  keys: { p256dh: string; auth: string };
};

type RestAlarmInput = {
  timerId: string;
  endAt: number;
  exercise: string;
  subscription: PushSubscriptionJSON;
};

type RestAlarmCommand =
  | { action: "reschedule"; endAt: number; exercise: string }
  | { action: "cancel" };

async function sendRestPush(input: RestAlarmInput) {
  "use step";

  if (process.env.REST_ALARM_DRY_RUN === "1") {
    return { delivered: false, dryRun: true };
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new FatalError("VAPID-nycklar saknas.");

  webPush.setVapidDetails(
    "https://jnyskg-ai.github.io/rsgiggaren1/",
    publicKey,
    privateKey
  );

  try {
    const response = await webPush.sendNotification(
      input.subscription,
      JSON.stringify({
        type: "rest-complete",
        timerId: input.timerId,
        exercise: input.exercise
      }),
      {
        TTL: 60,
        urgency: "high",
        topic: input.timerId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32)
      }
    );
    return { delivered: true, statusCode: response.statusCode };
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number }).statusCode || 0);
    if ([400, 401, 403, 404, 410].includes(statusCode)) {
      throw new FatalError(`Push-prenumerationen avvisades (${statusCode}).`);
    }
    throw error;
  }
}

export async function restAlarmWorkflow(initial: RestAlarmInput) {
  "use workflow";

  using commands = createHook<RestAlarmCommand>({ token: hookToken(initial.timerId) });
  const conflict = await commands.getConflict();
  if (conflict) return { status: "duplicate", runId: conflict.runId };

  const iterator = commands[Symbol.asyncIterator]();
  let current = initial;

  while (true) {
    const result = await Promise.race([
      sleep(new Date(current.endAt)).then(() => ({ action: "elapsed" as const })),
      iterator.next().then(next => next.done ? ({ action: "cancel" as const }) : next.value)
    ]);

    if (result.action === "cancel") return { status: "cancelled" };
    if (result.action === "reschedule") {
      current = { ...current, endAt: result.endAt, exercise: result.exercise };
      continue;
    }

    await sendRestPush(current);
    return { status: "delivered" };
  }
}

