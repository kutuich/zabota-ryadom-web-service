import path from "node:path";

export const e2eDatabaseUrl = process.env.E2E_DATABASE_URL
  ?? "postgresql://zabota_local:zabota_local_only@127.0.0.1:55432/zabota_e2e?schema=public";

export function assertSafeE2eDatabase(databaseUrl = e2eDatabaseUrl) {
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\//, "");
  const localHost = ["127.0.0.1", "localhost", "postgres"].includes(parsed.hostname);
  if (!localHost || !/(?:^|_)e2e$/.test(databaseName)) {
    throw new Error("E2E_DATABASE_URL must target an explicit local/CI database whose name ends with _e2e.");
  }
  return databaseUrl;
}

export function e2eRuntimeEnv(overrides = {}) {
  const uploadsDir = process.env.E2E_UPLOADS_DIR ?? path.resolve("backend/uploads/e2e");
  return {
    ...process.env,
    NODE_ENV: "test",
    E2E_STATIC_DELIVERY_ENABLED: "true",
    PORT: process.env.E2E_PORT ?? "4400",
    CORS_ORIGIN: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? "4400"}`,
    DATABASE_URL: assertSafeE2eDatabase(),
    JWT_SECRET: process.env.E2E_JWT_SECRET ?? "e2e-only-session-secret-never-use-in-production",
    PAYMENT_PROVIDER: "mock",
    TBANK_TERMINAL_MODE: "test",
    OAUTH_ENABLED: "false",
    VK_ID_ENABLED: "false",
    STORAGE_PROVIDER: "local",
    UPLOADS_DIR: uploadsDir,
    VISIT_RECONCILIATION_ENABLED: "false",
    OPENAPI_JSON_ENABLED: "true",
    SWAGGER_UI_ENABLED: "false",
    SENTRY_ENABLED: "false",
    LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? "warn",
    ...overrides
  };
}
