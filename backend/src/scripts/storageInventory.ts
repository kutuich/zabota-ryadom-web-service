import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db/prisma";

async function main() {
  const outputArgument = process.argv.slice(2).find((value) => value.startsWith("--output="));
  if (!outputArgument) throw new Error("--output=... is required");
  const outputPath = path.resolve(outputArgument.slice("--output=".length));
  const [documents, attachments, contracts] = await Promise.all([
    prisma.performerDocument.findMany({ where: { checksum: { not: null }, fileSize: { not: null } } }),
    prisma.serviceMessageAttachment.findMany(),
    prisma.agreementContract.findMany()
  ]);
  const rows = [
    ...documents.flatMap((row) => {
      const storagePath = row.storagePath ?? (row.fileUrl.startsWith("/uploads/") ? row.fileUrl.slice("/uploads/".length) : null);
      return storagePath && row.checksum && row.fileSize !== null ? [{
        id: row.id,
        kind: "performer-documents",
        storagePath,
        size: row.fileSize,
        checksum: row.checksum,
        contentType: row.mimeType ?? "application/octet-stream"
      }] : [];
    }),
    ...attachments.map((row) => ({
      id: row.id,
      kind: "service-message-attachments",
      storagePath: row.storagePath,
      size: row.fileSize,
      checksum: row.checksum,
      contentType: row.mimeType
    })),
    ...contracts.map((row) => ({
      id: row.id,
      kind: "agreement-contracts",
      storagePath: row.storagePath,
      size: row.fileSize,
      checksum: row.checksum,
      contentType: row.mimeType
    }))
  ];
  await fs.writeFile(outputPath, `${JSON.stringify(rows, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ records: rows.length, output: outputPath }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
