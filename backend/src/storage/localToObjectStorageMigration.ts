import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ObjectStorage } from "./objectStorage";
import { normalizeObjectKey } from "./objectStorage";

export const storageMigrationEntrySchema = z.object({
  id: z.string().min(1).max(255),
  kind: z.enum(["performer-documents", "service-message-attachments", "agreement-contracts"]),
  storagePath: z.string().min(1),
  size: z.number().int().nonnegative(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.string().min(1).max(255)
});

export const storageMigrationManifestSchema = z.array(storageMigrationEntrySchema);
export type StorageMigrationEntry = z.infer<typeof storageMigrationEntrySchema>;

export type StorageMigrationResult = StorageMigrationEntry & {
  objectKey: string;
  status: "copied" | "already_verified" | "failed";
  error?: string;
};

export async function migrateLocalObjects(input: {
  sourceRoot: string;
  entries: StorageMigrationEntry[];
  target: ObjectStorage;
}) {
  const results: StorageMigrationResult[] = [];
  await input.target.initialize();
  for (const entry of input.entries) {
    const objectKey = migrationObjectKey(entry);
    try {
      const existing = await input.target.head(objectKey);
      if (existing) {
        const object = await input.target.get(objectKey);
        verifyBytes(entry, object.body);
        results.push({ ...entry, objectKey, status: "already_verified" });
        continue;
      }
      const bytes = await fs.readFile(resolveSourcePath(input.sourceRoot, entry.storagePath));
      verifyBytes(entry, bytes);
      await input.target.put({
        key: objectKey,
        body: bytes,
        contentType: entry.contentType,
        checksum: entry.checksum
      });
      verifyBytes(entry, (await input.target.get(objectKey)).body);
      results.push({ ...entry, objectKey, status: "copied" });
    } catch (error) {
      results.push({
        ...entry,
        objectKey,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown migration error"
      });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    sourceRoot: path.resolve(input.sourceRoot),
    total: results.length,
    copied: results.filter((row) => row.status === "copied").length,
    alreadyVerified: results.filter((row) => row.status === "already_verified").length,
    failed: results.filter((row) => row.status === "failed").length,
    results
  };
}

export function migrationObjectKey(entry: Pick<StorageMigrationEntry, "kind" | "id">) {
  const opaqueId = createHash("sha256").update(`${entry.kind}:${entry.id}`).digest("hex");
  return `${entry.kind}/${opaqueId}`;
}

function resolveSourcePath(rootValue: string, storagePath: string) {
  const root = path.resolve(rootValue);
  const normalized = normalizeObjectKey(storagePath);
  const target = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Source path escapes the source root");
  return target;
}

function verifyBytes(entry: StorageMigrationEntry, bytes: Buffer) {
  if (bytes.length !== entry.size) throw new Error(`Size mismatch: expected ${entry.size}, received ${bytes.length}`);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== entry.checksum) throw new Error(`Checksum mismatch for ${entry.kind}/${entry.id}`);
}
