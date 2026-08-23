import { spawnSync } from "node:child_process";
import { assertSafeE2eDatabase, e2eRuntimeEnv } from "./e2e-environment.mjs";

const env = e2eRuntimeEnv();
assertSafeE2eDatabase(env.DATABASE_URL);

run("npx", ["prisma", "migrate", "reset", "--schema", "backend/prisma/schema.prisma", "--force", "--skip-seed"], env);
run("npm", ["run", "db:generate"], env);
run("npm", ["run", "db:seed"], env);
run("npm", ["run", "build", "-w", "backend"], env);
run("npm", ["run", "build", "-w", "frontend"], { ...env, VITE_ENABLE_MOCK_PAYMENT_UI: "true" });

function run(command, args, commandEnv) {
  const result = spawnSync(command, args, { env: commandEnv, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
