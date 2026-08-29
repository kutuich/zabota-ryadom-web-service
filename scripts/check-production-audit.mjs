import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

import {
  evaluateProductionAudit,
  summarizeProductionAudit,
} from "./production-audit-policy.mjs";

const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

if (!audit.stdout) {
  console.error(audit.stderr || "npm audit produced no JSON output");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  console.error("Unable to parse npm audit JSON output");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const rootPackage = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const failures = evaluateProductionAudit(report, rootPackage);

console.log(summarizeProductionAudit(report));

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  "approved exception: prisma -> @prisma/config -> deepmerge-ts (GHSA-ggr8-5vv4-36mx)",
);
