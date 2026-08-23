import assert from "node:assert/strict";
import { Writable } from "node:stream";
import type { ArgumentsHost } from "@nestjs/common";
import express from "express";
import type { ErrorEvent } from "@sentry/nestjs";
import { test } from "vitest";
import { createErrorTracker, scrubSentryEvent, type ErrorTracker } from "../observability/error-tracker";
import { createHttpObservabilityMiddleware, resolveRequestId } from "../observability/http-observability.middleware";
import { createStructuredLogger, type LogFields, type StructuredLogger } from "../observability/logger";
import { getCorrelationContext, runWithCorrelationContext } from "../observability/request-context";
import { redactSensitive } from "../observability/redaction";
import { NestHttpExceptionFilter } from "../nest/common/nest-http-exception.filter";
import { checkReadinessDependencies } from "../nest/health/readiness.service";
import { createVisitReconciliationScheduler } from "../services/visitReconciliationScheduler";
import { HttpError } from "../utils/http";

test("structured logger emits correlation fields and centrally redacts sensitive data", () => {
  const chunks: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk.toString()); callback(); } });
  const logger = createStructuredLogger({ environment: "test", level: "info", stream });

  runWithCorrelationContext({ correlationId: "corr-1", requestId: "req-1" }, () => {
    logger.info("auth.test", {
      password: "secret-password",
      authorization: "Bearer secret-token",
      nested: { email: "person@example.test" },
      safe: "Bearer visible-token, person@example.test and +7 (999) 123-45-67 must be scrubbed"
    });
  });

  const record = JSON.parse(chunks.join(""));
  assert.equal(record.level, "info");
  assert.equal(record.msg, "auth.test");
  assert.equal(record.event, "auth.test");
  assert.equal(record.service, "zabota-ryadom-backend");
  assert.equal(record.environment, "test");
  assert.equal(record.requestId, "req-1");
  assert.equal(record.password, "[REDACTED]");
  assert.equal(record.authorization, "[REDACTED]");
  assert.equal(record.nested.email, "[REDACTED]");
  assert.equal(record.safe, "Bearer [REDACTED], [REDACTED] and [REDACTED] must be scrubbed");
  assert.ok(record.timestamp);

  const redacted = redactSensitive({
    body: { privateFile: Buffer.from("private") },
    url: "postgresql://user:password@db.example/app?token=value"
  });
  assert.equal(redacted.body, "[REDACTED]");
  assert.doesNotMatch(redacted.url, /password|token=value/);
});

test("HTTP middleware validates request IDs, preserves valid IDs and logs no bodies", async () => {
  const records: Array<Record<string, unknown>> = [];
  const logger = memoryLogger(records);
  const app = express();
  app.use(createHttpObservabilityMiddleware(logger));
  app.get("/context", (_req, res) => res.json(getCorrelationContext()));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    let response = await fetch(`http://127.0.0.1:${address.port}/context`, { headers: { "x-request-id": "client.valid-1" } });
    assert.equal(response.headers.get("x-request-id"), "client.valid-1");
    assert.equal((await response.json() as { requestId: string }).requestId, "client.valid-1");

    response = await fetch(`http://127.0.0.1:${address.port}/context`, { headers: { "x-request-id": "invalid id" } });
    const generated = response.headers.get("x-request-id");
    assert.ok(generated && generated !== "invalid id");
    assert.match(generated, /^[0-9a-f-]{36}$/);
    assert.notEqual(resolveRequestId(["not", "a", "string"]), "not");

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(records.filter((record) => record.event === "http.request.completed").length, 2);
    assert.ok(records.every((record) => !("body" in record)));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("readiness checks required dependencies without mutating object storage", async () => {
  let storageChecks = 0;
  const ready = await checkReadinessDependencies({
    postgres: async () => 1,
    objectStorage: async () => { storageChecks += 1; },
    objectStorageRequired: true,
    timeoutMs: 50
  });
  assert.deepEqual(ready.checks, { postgres: "ok", objectStorage: "ok" });
  assert.equal(ready.status, "ready");
  assert.equal(storageChecks, 1);

  const notReady = await checkReadinessDependencies({
    postgres: async () => { throw new Error("database unavailable"); },
    objectStorage: async () => { storageChecks += 1; },
    objectStorageRequired: false,
    timeoutMs: 50
  });
  assert.deepEqual(notReady.checks, { postgres: "error", objectStorage: "skipped" });
  assert.equal(notReady.status, "not_ready");
  assert.equal(storageChecks, 1);
});

test("Sentry adapter is disabled without a DSN and scrubs events before sending", () => {
  let initialized = false;
  const sdk = {
    init: () => { initialized = true; },
    captureException: () => "event-id",
    flush: async () => true,
    withScope: () => undefined
  };
  const tracker = createErrorTracker({ SENTRY_ENABLED: "true" }, sdk as never);
  assert.equal(tracker.enabled, false);
  assert.equal(initialized, false);

  const event = scrubSentryEvent({
    user: { email: "person@example.test", ip_address: "127.0.0.1" },
    request: {
      method: "POST",
      url: "https://service.test/api/auth/login?token=secret",
      headers: { authorization: "Bearer secret" },
      cookies: { session: "secret" },
      data: { password: "secret" }
    },
    extra: { accessToken: "secret", safe: "ok" },
    exception: { values: [{ type: "Error", value: "Bearer secret" }] }
  } as unknown as ErrorEvent);
  assert.equal(event.user, undefined);
  assert.deepEqual(event.request, { method: "POST", url: "https://service.test/api/auth/login" });
  assert.equal(event.extra?.accessToken, "[REDACTED]");
  assert.equal(event.extra?.safe, "ok");
  assert.equal(event.exception?.values?.[0]?.value, "Bearer [REDACTED]");
});

test("Sentry adapter enables only by configuration and attaches correlation tags", async () => {
  let initOptions: Record<string, unknown> | undefined;
  let captured = 0;
  const tags: Record<string, string> = {};
  const sdk = {
    init: (options: Record<string, unknown>) => { initOptions = options; },
    captureException: () => { captured += 1; return "event-id"; },
    flush: async () => true,
    withScope: (callback: (scope: { setTag(key: string, value: string): void }) => void) => callback({
      setTag: (key, value) => { tags[key] = value; }
    })
  };
  const tracker = createErrorTracker({
    SENTRY_ENABLED: "true",
    SENTRY_DSN: "https://public-key@errors.example.test/1",
    SENTRY_ENVIRONMENT: "test",
    SENTRY_RELEASE: "stage10-test"
  }, sdk as never);
  assert.equal(tracker.enabled, true);
  assert.equal(initOptions?.sendDefaultPii, false);
  assert.equal(initOptions?.tracesSampleRate, 0);
  assert.equal(initOptions?.defaultIntegrations, false);
  assert.deepEqual(initOptions?.integrations, []);

  tracker.captureException(new Error("unexpected"), {
    event: "http.request.unhandled_error",
    requestId: "request-sentry-1"
  });
  assert.equal(captured, 1);
  assert.equal(tags.requestId, "request-sentry-1");
  assert.equal(tags.event, "http.request.unhandled_error");
  assert.equal(await tracker.flush(), true);
});

test("exception filter captures unexpected 5xx but ignores expected 4xx", () => {
  const captures: unknown[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const tracker = fakeTracker(captures);
  const filter = new NestHttpExceptionFilter(memoryLogger(logs), tracker);

  const expected = responseHost();
  filter.catch(new HttpError(401, "Authentication required", "auth_required"), expected.host);
  assert.equal(expected.statusCode, 401);
  assert.equal(captures.length, 0);

  const explicitServerError = responseHost();
  filter.catch(new HttpError(502, "Provider unavailable", "provider_unavailable"), explicitServerError.host);
  assert.equal(explicitServerError.statusCode, 502);
  assert.equal(captures.length, 0, "controlled public HttpError must not be reported as an unexpected crash");

  const unexpected = responseHost();
  filter.catch(new Error("database failed with password=hidden"), unexpected.host);
  assert.equal(unexpected.statusCode, 500);
  assert.deepEqual(unexpected.body, { error: "Внутренняя ошибка сервера", code: "internal_error" });
  assert.equal(captures.length, 1);
  assert.equal(logs.at(-1)?.requestId, "request-filter-1");
  assert.doesNotMatch(JSON.stringify(logs), /password=hidden/);
});

test("background reconciliation correlates start, result and failure", async () => {
  const logs: Array<Record<string, unknown>> = [];
  const captures: unknown[] = [];
  const scheduler = createVisitReconciliationScheduler({
    enabled: true,
    runOnStartup: false,
    logger: memoryLogger(logs),
    errorTracker: fakeTracker(captures),
    audit: (async () => undefined) as never,
    reconcile: async () => ({ checked: 3, closed: 2, skippedDisputed: 1 })
  });
  await scheduler.runOnce("manual");
  const started = logs.find((record) => record.event === "job.visit_reconciliation.started");
  const completed = logs.find((record) => record.event === "job.visit_reconciliation.completed");
  assert.ok(started?.jobId);
  assert.equal(completed?.jobId, started.jobId);
  assert.equal(completed?.closed, 2);

  const failing = createVisitReconciliationScheduler({
    enabled: true,
    runOnStartup: false,
    logger: memoryLogger(logs),
    errorTracker: fakeTracker(captures),
    reconcile: async () => { throw new Error("reconciliation failed"); }
  });
  await assert.rejects(failing.runOnce("manual"), /reconciliation failed/);
  assert.equal(captures.length, 1);
  assert.ok((captures[0] as { context: { jobId?: string } }).context.jobId);
});

function memoryLogger(records: Array<Record<string, unknown>>): StructuredLogger {
  const write = (level: string, event: string, fields: LogFields = {}) => {
    records.push({ level, event, ...getCorrelationContext(), ...redactSensitive(fields) });
  };
  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields)
  };
}

function fakeTracker(captures: unknown[]): ErrorTracker {
  return {
    enabled: true,
    captureException: (error, context) => { captures.push({ error, context }); },
    flush: async () => true
  };
}

function responseHost() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(value: number) { statusCode = value; return this; },
    json(value: unknown) { body = value; return this; }
  };
  const request = { requestId: "request-filter-1", method: "GET", path: "/api/test" };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request
    })
  } as unknown as ArgumentsHost;
  return {
    host,
    get statusCode() { return statusCode; },
    get body() { return body; }
  };
}
