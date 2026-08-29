import assert from "node:assert/strict";
import test from "node:test";

import { evaluateProductionAudit } from "../production-audit-policy.mjs";

const rootPackage = {
  devDependencies: { prisma: "^6.1.0" },
};

function approvedReport() {
  return {
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 3,
        critical: 0,
        total: 3,
      },
    },
    vulnerabilities: {
      "@prisma/config": {
        severity: "high",
        via: ["deepmerge-ts"],
      },
      "deepmerge-ts": {
        severity: "high",
        via: [
          {
            source: 1145093,
            name: "deepmerge-ts",
            url: "https://github.com/advisories/GHSA-ggr8-5vv4-36mx",
          },
        ],
      },
      prisma: {
        severity: "high",
        via: ["@prisma/config"],
      },
    },
  };
}

test("accepts only the isolated Prisma migration-tooling baseline", () => {
  assert.deepEqual(evaluateProductionAudit(approvedReport(), rootPackage), []);
});

test("rejects a new high advisory", () => {
  const report = approvedReport();
  report.metadata.vulnerabilities.high = 4;
  report.metadata.vulnerabilities.total = 4;
  report.vulnerabilities.runtimePackage = {
    severity: "high",
    via: [],
  };

  assert.match(
    evaluateProductionAudit(report, rootPackage).join("\n"),
    /new high advisories: runtimePackage/,
  );
});

test("rejects critical advisories and runtime Prisma CLI placement", () => {
  const report = approvedReport();
  report.metadata.vulnerabilities.critical = 1;
  report.metadata.vulnerabilities.total = 4;

  const failures = evaluateProductionAudit(report, {
    dependencies: { prisma: "^6.1.0" },
  }).join("\n");

  assert.match(failures, /unexpected critical advisories/);
  assert.match(failures, /prisma must remain a root devDependency/);
});

test("rejects a changed advisory or dependency chain", () => {
  const report = approvedReport();
  report.vulnerabilities["deepmerge-ts"].via[0].source = 9999999;
  report.vulnerabilities.prisma.via = ["another-package"];

  const failures = evaluateProductionAudit(report, rootPackage).join("\n");
  assert.match(failures, /not the approved GHSA baseline/);
  assert.match(failures, /prisma dependency chain changed/);
});
