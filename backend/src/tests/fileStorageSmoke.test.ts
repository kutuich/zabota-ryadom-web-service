import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { test } from "vitest";
import { prisma } from "../db/prisma";
import { createNestApplication } from "../nest/bootstrap";
import { acceptLatestLegalDocuments, requiredDocumentTypesForFeature } from "../services/legalService";
import { hashPassword } from "../services/passwordService";
import { objectStorage } from "../storage/storageProvider";

const enabled = process.env.FILE_STORAGE_SMOKE === "true";

test.runIf(enabled)("PostgreSQL and S3 protected file smoke", async () => {
  const endpoint = requiredEnv("S3_ENDPOINT");
  const region = process.env.S3_REGION ?? "us-east-1";
  const bucket = requiredEnv("S3_BUCKET");
  const credentials = {
    accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY")
  };
  const s3 = new S3Client({ endpoint, region, forcePathStyle: true, credentials });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));

  const suffix = randomUUID();
  const password = "Storage-smoke-password-22";
  const performer = await prisma.user.create({
    data: {
      role: "performer",
      rolesJson: JSON.stringify(["performer"]),
      email: `storage-performer-${suffix}@example.test`,
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      displayName: "Storage smoke performer"
    }
  });
  const client = await prisma.user.create({
    data: {
      role: "client",
      rolesJson: JSON.stringify(["client"]),
      email: `storage-client-${suffix}@example.test`,
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      displayName: "Storage smoke client"
    }
  });
  const app = await createNestApplication({ startScheduler: false, exposeOpenApi: false });
  await app.listen(0, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  let documentId: string | undefined;
  try {
    await acceptLatestLegalDocuments({
      userId: performer.id,
      documentTypes: requiredDocumentTypesForFeature("performer", "upload_helper_document"),
      source: "storage_smoke"
    });
    const performerToken = await login(baseUrl, performer.email!, password);
    const clientToken = await login(baseUrl, client.email!, password);
    const bytes = Buffer.from("%PDF-1.4\nprotected S3 smoke document");
    let response = await fetch(`${baseUrl}/api/performer-documents`, {
      method: "POST",
      headers: { authorization: `Bearer ${performerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ type: "self_employed", fileName: "proof.pdf", fileData: `data:application/pdf;base64,${bytes.toString("base64")}` })
    });
    if (response.status !== 201) assert.fail(`Expected upload 201, received ${response.status}: ${await response.text()}`);
    const uploaded = await response.json() as { id: string; fileUrl: string; checksum: string };
    documentId = uploaded.id;
    const row = await prisma.performerDocument.findUniqueOrThrow({ where: { id: uploaded.id } });
    assert.match(row.storagePath ?? "", /^performer-documents\/[0-9a-f-]{36}$/);
    assert.equal(await objectStorage.exists(row.storagePath!), true);

    response = await fetch(`${baseUrl}${uploaded.fileUrl}`, { headers: { authorization: `Bearer ${performerToken}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.match(response.headers.get("content-disposition") ?? "", /attachment/);

    response = await fetch(`${baseUrl}${uploaded.fileUrl}`, { headers: { authorization: `Bearer ${clientToken}` } });
    assert.equal(response.status, 403);
    response = await fetch(`${baseUrl}${uploaded.fileUrl}`);
    assert.equal(response.status, 401);

    await objectStorage.delete(row.storagePath!);
    response = await fetch(`${baseUrl}${uploaded.fileUrl}`, { headers: { authorization: `Bearer ${performerToken}` } });
    assert.equal(response.status, 404);
    assert.equal((await response.json() as { code: string }).code, "performer_document_file_missing");
  } finally {
    await app.close();
    if (documentId) await prisma.performerDocument.deleteMany({ where: { id: documentId } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [performer.id, client.id] } } });
    await prisma.userConsentAuditLog.deleteMany({ where: { userId: { in: [performer.id, client.id] } } });
    await prisma.userConsent.deleteMany({ where: { userId: { in: [performer.id, client.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [performer.id, client.id] } } });
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    s3.destroy();
  }
});

async function login(baseUrl: string, phoneOrEmail: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneOrEmail, password })
  });
  if (response.status !== 200) assert.fail(`Expected login 200, received ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { token: string }).token;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for file storage smoke`);
  return value;
}
