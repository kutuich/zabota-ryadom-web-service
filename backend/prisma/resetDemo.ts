import { execFileSync } from "node:child_process";
import path from "node:path";

execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "prisma",
  "db",
  "push",
  "--schema",
  path.resolve(process.cwd(), "backend/prisma/schema.prisma"),
  "--accept-data-loss"
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
