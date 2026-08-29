import { spawn } from "node:child_process";
import { e2eRuntimeEnv } from "./e2e-environment.mjs";

const child = spawn(process.execPath, ["backend/dist/src/index.js"], {
  env: e2eRuntimeEnv(),
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
