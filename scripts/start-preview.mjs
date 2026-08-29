import { spawn, spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

process.env.NODE_ENV ||= "production";
process.env.PORT ||= "4000";

const loggerModule = await import("../backend/dist/src/observability/logger.js");
const appLogger = loggerModule.appLogger ?? loggerModule.default?.appLogger;
if (!appLogger) throw new Error("Structured runtime logger is unavailable. Build the backend before startup.");
if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL is required. Apply PostgreSQL migrations before application startup.");
}
process.env.DATABASE_URL = stripSurroundingQuotes(process.env.DATABASE_URL);
if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
  throw new Error("DATABASE_URL must point to PostgreSQL. SQLite is supported only as an explicit migration source.");
}

run("node", ["backend/dist/src/scripts/bootstrapCityDirectory.js"]);

const prisma = new PrismaClient();
const usersCount = await prisma.user.count();
await prisma.$disconnect();

if (usersCount === 0) {
  if (process.env.SEED_DEMO_DATA === "true") {
    appLogger.info("application.seed_demo.started");
    run("node", ["backend/dist/prisma/seed.js"]);
  } else if (hasProductionAdminEnv()) {
    appLogger.info("application.production_admin_bootstrap.started");
    run("node", ["scripts/bootstrap-production-admin.mjs"]);
  } else {
    appLogger.warn("application.empty_database.bootstrap_skipped");
  }
} else {
  appLogger.info("application.database_seed_skipped", { usersCount });
}

const server = spawn("node", ["backend/dist/src/index.js"], {
  env: process.env,
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.kill(signal);
  });
}

server.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function run(command, args) {
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function stripSurroundingQuotes(value) {
  return value.replace(/^["']|["']$/g, "");
}

function hasProductionAdminEnv() {
  return Boolean(
    process.env.PRODUCTION_ADMIN_EMAIL?.trim()
    && process.env.PRODUCTION_ADMIN_PASSWORD?.trim()
    && process.env.PRODUCTION_ADMIN_PHONE?.trim()
  );
}
