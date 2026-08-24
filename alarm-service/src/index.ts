import { Hono } from "hono";
import { resumeHook, start } from "workflow/api";
import { restAlarmWorkflow } from "../workflows/rest-alarm.js";
import { hookToken, isAllowedOrigin, normalizeAlarmRequest } from "./validation.mjs";

const app = new Hono();

app.use("/api/*", async (context, next) => {
  const origin = context.req.header("origin") || "";
  if (!isAllowedOrigin(origin)) return context.json({ error: "Otillåtet ursprung." }, 403);
  context.header("access-control-allow-origin", origin);
  context.header("vary", "Origin");
  context.header("access-control-allow-methods", "GET, POST, OPTIONS");
  context.header("access-control-allow-headers", "content-type");
  context.header("access-control-max-age", "86400");
  if (context.req.method === "OPTIONS") return context.body(null, 204);
  await next();
});

app.get("/health", context => context.json({ ok: true, service: "rsg-coach-alarm" }));

app.get("/api/config", context => {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) return context.json({ error: "Notifieringsnyckel saknas." }, 503);
  return context.json({ vapidPublicKey });
});

app.post("/api/rest-alarm", async context => {
  let command;
  try {
    command = normalizeAlarmRequest(await context.req.json());
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : "Ogiltig begäran." }, 400);
  }

  if (command.action === "schedule") {
    const run = await start(restAlarmWorkflow, [{
      timerId: command.timerId,
      endAt: command.endAt,
      exercise: command.exercise,
      subscription: command.subscription
    }]);
    return context.json({ scheduled: true, runId: run.runId }, 202);
  }

  try {
    const result = await resumeHook(
      hookToken(command.timerId),
      command.action === "cancel"
        ? { action: "cancel" }
        : { action: "reschedule", endAt: command.endAt, exercise: command.exercise }
    );
    return command.action === "cancel"
      ? context.json({ cancelled: true, runId: result.runId })
      : context.json({ scheduled: true, runId: result.runId });
  } catch (_) {
    return context.json({ error: "Det aktiva larmet hittades inte ännu." }, 404);
  }
});

app.onError((error, context) => {
  console.error("RSG alarm service error", error);
  return context.json({ error: "Internt fel i larmtjänsten." }, 500);
});

export default app;

