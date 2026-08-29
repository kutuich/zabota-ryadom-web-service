const ALLOWED_HIGH_PACKAGES = new Set([
  "@prisma/config",
  "deepmerge-ts",
  "prisma",
]);

const EXPECTED_ADVISORY = {
  source: 1145093,
  url: "https://github.com/advisories/GHSA-ggr8-5vv4-36mx",
};

function getVulnerabilityCounts(report) {
  return report?.metadata?.vulnerabilities ?? {};
}

function viaNames(vulnerability) {
  return (vulnerability?.via ?? []).map((entry) =>
    typeof entry === "string" ? entry : entry.name,
  );
}

export function evaluateProductionAudit(report, rootPackage) {
  const failures = [];
  const vulnerabilities = report?.vulnerabilities;
  const counts = getVulnerabilityCounts(report);

  if (!vulnerabilities || typeof vulnerabilities !== "object") {
    return ["npm audit output does not contain a vulnerabilities object"];
  }

  for (const severity of ["critical", "moderate", "low", "info"]) {
    if ((counts[severity] ?? 0) > 0) {
      failures.push(`unexpected ${severity} advisories: ${counts[severity]}`);
    }
  }

  const highPackages = Object.entries(vulnerabilities)
    .filter(([, vulnerability]) => vulnerability.severity === "high")
    .map(([name]) => name)
    .sort();

  const unexpectedHigh = highPackages.filter(
    (name) => !ALLOWED_HIGH_PACKAGES.has(name),
  );
  const missingHigh = [...ALLOWED_HIGH_PACKAGES].filter(
    (name) => !highPackages.includes(name),
  );

  if (unexpectedHigh.length > 0) {
    failures.push(`new high advisories: ${unexpectedHigh.join(", ")}`);
  }
  if (missingHigh.length > 0) {
    failures.push(
      `approved baseline changed; review and update it explicitly: ${missingHigh.join(", ")}`,
    );
  }
  if ((counts.high ?? 0) !== ALLOWED_HIGH_PACKAGES.size) {
    failures.push(
      `expected ${ALLOWED_HIGH_PACKAGES.size} high advisories, received ${counts.high ?? 0}`,
    );
  }

  const deepmergeAdvisory = (vulnerabilities["deepmerge-ts"]?.via ?? []).find(
    (entry) => typeof entry === "object" && entry.source === EXPECTED_ADVISORY.source,
  );
  if (deepmergeAdvisory?.url !== EXPECTED_ADVISORY.url) {
    failures.push("deepmerge-ts advisory is not the approved GHSA baseline");
  }

  if (
    JSON.stringify(viaNames(vulnerabilities["@prisma/config"])) !==
    JSON.stringify(["deepmerge-ts"])
  ) {
    failures.push("@prisma/config dependency chain changed");
  }
  if (
    JSON.stringify(viaNames(vulnerabilities.prisma)) !==
    JSON.stringify(["@prisma/config"])
  ) {
    failures.push("prisma dependency chain changed");
  }

  if (
    !rootPackage?.devDependencies?.prisma ||
    rootPackage?.dependencies?.prisma
  ) {
    failures.push("prisma must remain a root devDependency, not a runtime dependency");
  }

  for (const packageName of ["@prisma/config", "deepmerge-ts"]) {
    if (
      rootPackage?.dependencies?.[packageName] ||
      rootPackage?.devDependencies?.[packageName]
    ) {
      failures.push(`${packageName} must remain transitive`);
    }
  }

  return failures;
}

export function summarizeProductionAudit(report) {
  const counts = getVulnerabilityCounts(report);
  return `production audit: ${counts.total ?? 0} total (${counts.high ?? 0} high, ${counts.critical ?? 0} critical)`;
}
