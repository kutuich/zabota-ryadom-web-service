import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { LocalObjectStorage } from "../storage/localObjectStorage";
import { migrateLocalObjects, migrationObjectKey } from "../storage/localToObjectStorageMigration";
import { ObjectStorageNotFoundError } from "../storage/objectStorage";
import { S3ObjectStorage } from "../storage/s3ObjectStorage";

describe("object storage contract", () => {
  test("local adapter preserves bytes, metadata, checksum, existence and delete behavior", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zabota-object-storage-"));
    const storage = new LocalObjectStorage(root);
    const body = Buffer.from("protected file contents");
    const checksum = createHash("sha256").update(body).digest("hex");
    try {
      await storage.initialize();
      const stored = await storage.put({ key: "documents/opaque-id", body, contentType: "text/plain", checksum });
      assert.deepEqual(stored, { key: "documents/opaque-id", size: body.length, contentType: "text/plain", checksum });
      assert.equal(await storage.exists(stored.key), true);
      assert.deepEqual(await storage.get(stored.key), { ...stored, body });
      await assert.rejects(
        storage.put({ key: stored.key, body, contentType: "text/plain", checksum }),
        /EEXIST/
      );
      await storage.delete(stored.key);
      assert.equal(await storage.exists(stored.key), false);
      await assert.rejects(storage.get(stored.key), ObjectStorageNotFoundError);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("local adapter rejects traversal keys", async () => {
    const storage = new LocalObjectStorage(await fs.mkdtemp(path.join(os.tmpdir(), "zabota-object-storage-")));
    await assert.rejects(
      storage.put({ key: "../outside", body: Buffer.from("x"), contentType: "text/plain", checksum: "0".repeat(64) }),
      /Invalid object storage key/
    );
  });
});

const s3Enabled = process.env.S3_TEST_ENABLED === "true";
const s3Endpoint = process.env.S3_ENDPOINT ?? "http://127.0.0.1:59000";
const s3Region = process.env.S3_REGION ?? "us-east-1";
const s3AccessKey = process.env.S3_ACCESS_KEY_ID ?? "zabota-local-test";
const s3SecretKey = process.env.S3_SECRET_ACCESS_KEY ?? "zabota-local-test-secret";
const bucket = `zabota-test-${randomUUID()}`;
const client = new S3Client({
  endpoint: s3Endpoint,
  region: s3Region,
  forcePathStyle: true,
  credentials: { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey }
});

describe.runIf(s3Enabled)("S3-compatible adapter integration", () => {
  const storage = new S3ObjectStorage({
    endpoint: s3Endpoint,
    region: s3Region,
    bucket,
    accessKeyId: s3AccessKey,
    secretAccessKey: s3SecretKey,
    forcePathStyle: true
  });

  beforeAll(async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    await storage.initialize();
  });

  afterAll(async () => {
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    client.destroy();
  });

  test("uploads, verifies, downloads and deletes a private object", async () => {
    const body = Buffer.from("S3 protected file contents");
    const checksum = createHash("sha256").update(body).digest("hex");
    const stored = await storage.put({ key: "tests/opaque-object", body, contentType: "text/plain", checksum });
    assert.equal(stored.size, body.length);
    assert.equal(stored.checksum, checksum);
    assert.equal(await storage.exists(stored.key), true);
    assert.deepEqual((await storage.get(stored.key)).body, body);
    await assert.rejects(storage.put({ key: stored.key, body, contentType: "text/plain", checksum }));
    await assert.rejects(storage.put({ key: "tests/bad-checksum", body, contentType: "text/plain", checksum: "0".repeat(64) }));
    assert.equal(await storage.exists("tests/bad-checksum"), false);
    await storage.delete(stored.key);
    assert.equal(await storage.exists(stored.key), false);
    await assert.rejects(storage.get(stored.key), ObjectStorageNotFoundError);
  });

  test("rehearses repeatable local-to-S3 migration and rejects a checksum mismatch", async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zabota-storage-migration-"));
    const body = Buffer.from("legacy protected object");
    const checksum = createHash("sha256").update(body).digest("hex");
    const entry = {
      id: "legacy-record-id",
      kind: "performer-documents" as const,
      storagePath: "legacy/path/document.pdf",
      size: body.length,
      checksum,
      contentType: "application/pdf"
    };
    await fs.mkdir(path.join(sourceRoot, "legacy/path"), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, entry.storagePath), body);
    try {
      const first = await migrateLocalObjects({ sourceRoot, entries: [entry], target: storage });
      assert.deepEqual({ copied: first.copied, alreadyVerified: first.alreadyVerified, failed: first.failed }, { copied: 1, alreadyVerified: 0, failed: 0 });
      const second = await migrateLocalObjects({ sourceRoot, entries: [entry], target: storage });
      assert.deepEqual({ copied: second.copied, alreadyVerified: second.alreadyVerified, failed: second.failed }, { copied: 0, alreadyVerified: 1, failed: 0 });
      const invalid = await migrateLocalObjects({ sourceRoot, entries: [{ ...entry, id: "bad-record", checksum: "0".repeat(64) }], target: storage });
      assert.equal(invalid.failed, 1);
      assert.match(invalid.results[0].error ?? "", /Checksum mismatch/);
    } finally {
      await storage.delete(migrationObjectKey(entry));
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }
  });
});
