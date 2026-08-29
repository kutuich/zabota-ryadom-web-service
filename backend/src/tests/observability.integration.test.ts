import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "vitest";
import { createErrorTracker, type ErrorTracker } from "../observability/error-tracker";
import type { LogFields, StructuredLogger } from "../observability/logger";
import { getCorrelationContext } from "../observability/request-context";
import { createNestApplication } from "../nest/bootstrap";

test("Nest observability exposes validated correlation IDs and dependency readiness", async () => {
  const records: Array<{ event: string; fields: LogFields }> = [];
  const record = (event: string, fields: LogFields = {}) => records.push({ event, fields: { ...getCorrelationContext(), ...fields } });
  const logger: StructuredLogger = {
    debug: record,
    info: record,
    warn: record,
    error: record
  };
  let flushed = false;
  const disabledTracker: ErrorTracker = {
    enabled: false,
    captureException: () => undefined,
    flush: async () => { flushed = true; return true; }
  };
  assert.equal(createErrorTracker({}).enabled, false);

  const app = await createNestApplication({ startScheduler: false, exposeOpenApi: false, logger, errorTracker: disabledTracker });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    let response = await fetch(`${baseUrl}/api/health`, { headers: { "x-request-id": "integration.valid-1" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-id"), "integration.valid-1");
    assert.deepEqual(await response.json(), { status: "ok", service: "zabota-ryadom-web-service" });

    response = await fetch(`${baseUrl}/api/ready`, { headers: { "x-request-id": "invalid id" } });
    assert.equal(response.status, 200);
    assert.notEqual(response.headers.get("x-request-id"), "invalid id");
    assert.deepEqual(await response.json(), {
      status: "ready",
      service: "zabota-ryadom-web-service",
      checks: { postgres: "ok", objectStorage: "skipped" }
    });

    await new Promise((resolve) => setImmediate(resolve));
    const requestLog = records.find((record) => record.event === "http.request.completed" && record.fields.path === "/api/health");
    assert.equal(requestLog?.fields.requestId, "integration.valid-1");
  } finally {
    await app.close();
  }
  assert.equal(flushed, true);
});
