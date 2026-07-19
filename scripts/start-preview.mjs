import { spawn, spawnSync } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

process.env.NODE_ENV ||= "production";
process.env.PORT ||= "4000";
process.env.DATABASE_URL ||= "file:/data/zabota.db";
process.env.DATABASE_URL = stripSurroundingQuotes(process.env.DATABASE_URL);

const databasePath = sqlitePathFromDatabaseUrl(process.env.DATABASE_URL);
if (databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
}

run("npx", ["prisma", "db", "push", "--schema", "backend/prisma/schema.prisma", "--skip-generate"]);

const prisma = new PrismaClient();
const usersCount = await prisma.user.count();
await prisma.$disconnect();

if (usersCount === 0) {
  console.log("Database is empty. Running seed once.");
  run("node", ["backend/dist/prisma/seed.js"]);
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

function sqlitePathFromDatabaseUrl(databaseUrl) {
  if (!databaseUrl.startsWith("file:")) return null;
  const rawPath = databaseUrl.slice("file:".length).split("?")[0];
  return isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);
}

function stripSurroundingQuotes(value) {
  return value.replace(/^["']|["']$/g, "");
}
