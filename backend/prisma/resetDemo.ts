import { execFileSync } from "node:child_process";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for demo reset");
const target = new URL(databaseUrl);
const database = target.pathname.replace(/^\//, "");
if (!['postgresql:', 'postgres:'].includes(target.protocol)
  || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(target.hostname)
  || !/(demo|test|smoke|rehearsal)/i.test(database)) {
  throw new Error("db:reset-demo разрешён только для loopback PostgreSQL demo/test/smoke/rehearsal database");
}

execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "prisma",
  "migrate",
  "reset",
  "--schema",
  path.resolve(process.cwd(), "backend/prisma/schema.prisma"),
  "--force",
  "--skip-seed"
], { stdio: "inherit" });

async function main() {
  const { disconnectDemoPrisma, seedDemoDatabase } = await import("./demoData");

  try {
    await seedDemoDatabase({ reset: true });
  } finally {
    await disconnectDemoPrisma();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
