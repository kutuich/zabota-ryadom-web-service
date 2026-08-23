import fs from "node:fs/promises";
import path from "node:path";
import { storageMigrationManifestSchema, migrateLocalObjects } from "../storage/localToObjectStorageMigration";
import { S3ObjectStorage } from "../storage/s3ObjectStorage";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRoot = requiredArg(args, "source-root");
  const manifestPath = requiredArg(args, "manifest");
  const reportPath = requiredArg(args, "report");
  const endpoint = requiredArg(args, "target-endpoint");
  const bucket = requiredArg(args, "target-bucket");
  if (process.env.NODE_ENV === "production" && args.get("confirm-production-copy") !== "true") {
    throw new Error("Production copy requires --confirm-production-copy=true; source deletion and DB cutover are never performed");
  }
  const manifest = storageMigrationManifestSchema.parse(JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf8")));
  const target = new S3ObjectStorage({
    endpoint,
    bucket,
    region: args.get("target-region") || "us-east-1",
    accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: args.get("force-path-style") === "true"
  });
  const report = await migrateLocalObjects({ sourceRoot, entries: manifest, target });
  await fs.mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
  await fs.writeFile(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ total: report.total, copied: report.copied, alreadyVerified: report.alreadyVerified, failed: report.failed, report: path.resolve(reportPath) }));
  if (report.failed) process.exitCode = 1;
}

function parseArgs(values: string[]) {
  const result = new Map<string, string>();
  for (const value of values) {
    if (!value.startsWith("--") || !value.includes("=")) throw new Error(`Arguments must use --name=value syntax: ${value}`);
    const [name, ...rest] = value.slice(2).split("=");
    result.set(name, rest.join("="));
  }
  return result;
}

function requiredArg(args: Map<string, string>, name: string) {
  const value = args.get(name)?.trim();
  if (!value) throw new Error(`--${name}=... is required`);
  return value;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be supplied through the environment`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
