import { spawn, spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

process.env.NODE_ENV ||= "production";
process.env.PORT ||= "4000";
if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL is required. PostgreSQL schema changes are applied with prisma migrate deploy.");
}
process.env.DATABASE_URL = stripSurroundingQuotes(process.env.DATABASE_URL);
if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
  throw new Error("DATABASE_URL must point to PostgreSQL. SQLite is supported only as an explicit migration source.");
}

run("npx", ["prisma", "migrate", "deploy", "--schema", "backend/prisma/schema.prisma"]);
run("node", ["backend/dist/src/scripts/bootstrapCityDirectory.js"]);

const prisma = new PrismaClient();
const usersCount = await prisma.user.count();
await prisma.$disconnect();

if (usersCount === 0) {
  if (process.env.SEED_DEMO_DATA === "true") {
    console.log("Database is empty and SEED_DEMO_DATA=true. Running demo seed once.");
    run("node", ["backend/dist/prisma/seed.js"]);
  } else if (hasProductionAdminEnv()) {
    console.log("Database is empty. Creating production administrator from environment.");
    run("node", ["scripts/bootstrap-production-admin.mjs"]);
  } else {
    console.log("Database is empty. Demo seed is disabled and production administrator env is incomplete. Skipping seed.");
  }
} else {
  console.log(`Database already has ${usersCount} users. Skipping seed.`);
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
