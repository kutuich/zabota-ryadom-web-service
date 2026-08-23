import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test, vi } from "vitest";
import { createNestApplication } from "../nest/bootstrap";
import { NEST_ROUTE_OWNERSHIP } from "../nest/domains/domain-modules";
import { visitReconciliationScheduler } from "../services/visitReconciliationScheduler";

test("NestJS controllers preserve migrated API contracts without a legacy bridge", async () => {
  const app = await createNestApplication({ startScheduler: false });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    let response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "zabota-ryadom-web-service" });
    assert.ok(response.headers.get("x-request-id"));

    response = await fetch(`${baseUrl}/api/ready`);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { status: string }).status, "ready");

    response = await fetch(`${baseUrl}/api/legal/documents`);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(await response.json()));

    response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneOrEmail: "client@zabota.local", password: "password123" })
    });
    assert.equal(response.status, 200);
    const login = await response.json() as { token: string };

    response = await fetch(`${baseUrl}/api/balance/me`, { headers: { authorization: `Bearer ${login.token}` } });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/api/admin/users`);
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { code: string }).code, "auth_required");

    response = await fetch(`${baseUrl}/api/performer-documents/not-owned/download`);
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { code: string }).code, "auth_required");

    response = await fetch(`${baseUrl}/api/auth/oauth/vk/start`, { redirect: "manual" });
    assert.notEqual(response.status, 302, "Disabled VK ID must not call or redirect to the provider");

    response = await fetch(`${baseUrl}/api/openapi.json`);
    assert.equal(response.status, 200);
    const openApi = await response.json() as { openapi: string; paths: Record<string, unknown> };
    assert.match(openApi.openapi, /^3\./);
    assert.equal(Object.keys(openApi.paths).length, 200);

    response = await fetch(`${baseUrl}/api/docs`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /swagger-ui/i);

    const ownedRoutes = Object.values(NEST_ROUTE_OWNERSHIP).flat();
    assert.equal(new Set(ownedRoutes).size, ownedRoutes.length);
    const registeredApiRoutes = expressRouteInventory(app)
      .filter((route) => route.path.startsWith("/api/") && !route.path.startsWith("/api/docs") && route.path !== "/api/openapi.json");
    assert.equal(registeredApiRoutes.length, 224, "222 application API routes plus health and readiness must be registered");
    const registeredApiKeys = registeredApiRoutes.map((route) => `${route.method} ${route.path}`);
    assert.equal(new Set(registeredApiKeys).size, registeredApiKeys.length, "NestJS must not register duplicate API routes");
  } finally {
    await app.close();
  }
});

test("NestJS lifecycle starts and stops the single-instance scheduler", async () => {
  const start = vi.spyOn(visitReconciliationScheduler, "start").mockImplementation(() => undefined);
  const stop = vi.spyOn(visitReconciliationScheduler, "stop").mockImplementation(() => undefined);
  const app = await createNestApplication();
  try {
    assert.equal(start.mock.calls.length, 1);
  } finally {
    await app.close();
  }
  assert.equal(stop.mock.calls.length, 1);
  start.mockRestore();
  stop.mockRestore();
});

function expressRouteInventory(app: Awaited<ReturnType<typeof createNestApplication>>) {
  const server = app.getHttpAdapter().getInstance() as {
    _router?: { stack?: Array<{ route?: { path: string | string[]; methods: Record<string, boolean> } }> };
  };
  return (server._router?.stack ?? []).flatMap((layer) => {
    if (!layer.route) return [];
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    const methods = Object.entries(layer.route.methods)
      .filter(([, enabled]) => enabled)
      .map(([method]) => method.toUpperCase());
    return paths.flatMap((path) => methods.map((method) => ({ method, path })));
  });
}
