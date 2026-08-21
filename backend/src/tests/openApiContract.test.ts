import assert from "node:assert/strict";
import { test } from "vitest";
import { createNestApplication } from "../nest/bootstrap";
import { buildOpenApiDocument, documentedApiOperations } from "../nest/openapi/openapi";
import { resolveBooleanFlag } from "../config/env";

test("OpenAPI covers every runtime API route and preserves representative contracts", async () => {
  assert.equal(resolveBooleanFlag("OPENAPI_JSON_ENABLED", false, {}), false);
  assert.equal(resolveBooleanFlag("OPENAPI_JSON_ENABLED", false, { OPENAPI_JSON_ENABLED: "true" }), true);
  assert.equal(resolveBooleanFlag("SWAGGER_UI_ENABLED", true, { SWAGGER_UI_ENABLED: "false" }), false);
  const app = await createNestApplication({ startScheduler: false, exposeOpenApi: false });
  try {
    const document = buildOpenApiDocument(app);
    const documented = documentedApiOperations(document);
    const documentedKeys = documented.map(({ method, path }) => `${method} ${path}`);
    const runtime = expressRouteInventory(app)
      .filter(({ path }) => path.startsWith("/api/"))
      .map(({ method, path }) => `${method} ${path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`);

    assert.equal(runtime.length, 221);
    assert.equal(documented.length, 221);
    assert.equal(new Set(runtime).size, runtime.length, "runtime routes must not contain duplicates");
    assert.equal(new Set(documentedKeys).size, documentedKeys.length, "OpenAPI operations must not contain duplicates");
    assert.deepEqual([...documentedKeys].sort(), [...runtime].sort(), "every runtime API route must have an OpenAPI operation");

    for (const { path, operation } of documented) {
      assert.ok(operation.responses && Object.keys(operation.responses).some((status) => /^2\d\d$/.test(status) || status === "302"), `${path} needs a success response`);
      assert.ok(Array.isArray(operation.security), `${path} needs explicit public/protected security metadata`);
      for (const name of [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])) {
        assert.ok(operation.parameters?.some((parameter) => !("$ref" in parameter) && parameter.in === "path" && parameter.name === name && parameter.required), `${path} needs path parameter ${name}`);
      }
    }

    const loginBody = document.paths["/api/auth/login"].post?.requestBody;
    assert.ok(loginBody && !("$ref" in loginBody));
    const loginSchema = loginBody.content["application/json"]?.schema;
    assert.ok(loginSchema && !("$ref" in loginSchema));
    assert.deepEqual(loginSchema.required, ["phoneOrEmail", "password"]);
    assert.equal(loginSchema.properties?.phoneOrEmail && !("$ref" in loginSchema.properties.phoneOrEmail) ? loginSchema.properties.phoneOrEmail.minLength : undefined, 3);

    const healthResponse = document.paths["/api/health"].get?.responses?.["200"];
    assert.ok(healthResponse && !("$ref" in healthResponse));
    const healthSchema = healthResponse.content?.["application/json"]?.schema;
    assert.ok(healthSchema && !("$ref" in healthSchema));
    assert.deepEqual(healthSchema.required, ["status", "service"]);

    const fileOperation = document.paths["/api/performer-documents/{id}/download"].get;
    assert.deepEqual(fileOperation?.security, [{ bearerAuth: [] }]);
    const fileResponse = fileOperation?.responses?.["200"];
    assert.ok(fileResponse && !("$ref" in fileResponse));
    const fileSchema = fileResponse.content?.["application/octet-stream"]?.schema;
    assert.ok(fileSchema && !("$ref" in fileSchema));
    assert.equal(fileSchema.format, "binary");

    assert.deepEqual(document.paths["/api/public/bootstrap"].get?.security, []);
    assert.deepEqual(document.paths["/api/admin/users"].get?.security, [{ bearerAuth: [] }]);
    const webhookResponse = document.paths["/api/payments/tbank/webhook"].post?.responses?.["200"];
    assert.ok(webhookResponse && !("$ref" in webhookResponse));
    assert.equal(webhookResponse.content?.["text/plain"]?.schema && !("$ref" in webhookResponse.content["text/plain"].schema)
      ? webhookResponse.content["text/plain"].schema.type
      : undefined, "string");
    assert.equal(document.components?.securitySchemes?.bearerAuth && !("$ref" in document.components.securitySchemes.bearerAuth)
      ? document.components.securitySchemes.bearerAuth.scheme
      : undefined, "bearer");
  } finally {
    await app.close();
  }
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
