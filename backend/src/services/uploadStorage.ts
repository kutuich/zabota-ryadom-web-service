import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { env, resolveUploadsDir } from "../config/env";
import { HttpError } from "../utils/http";

export const uploadsRoot = resolveUploadsDir({ ...process.env, UPLOADS_DIR: env.uploadsDir });

const allowedDocumentMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

const maxDocumentBytes = 5 * 1024 * 1024;

export async function savePerformerDocumentFile(input: {
  performerId: string;
  type: "self_employed" | "criminal_record";
  fileName: string;
  fileData: string;
}, storageRoot = uploadsRoot) {
  const match = input.fileData.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new HttpError(400, "Файл нужно передать в формате data URL", "document_file_invalid");
  }

  const mimeType = match[1];
  if (!allowedDocumentMimeTypes.has(mimeType)) {
    throw new HttpError(400, "Можно загрузить PDF или изображение документа", "document_file_type_invalid");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || !matchesDocumentSignature(mimeType, buffer)) {
    throw new HttpError(400, "Содержимое файла не соответствует его типу", "document_file_signature_invalid");
  }
  if (buffer.length > maxDocumentBytes) {
    throw new HttpError(400, "Размер файла не должен превышать 5 МБ", "document_file_too_large");
  }

  const storedFileName = `${input.type}-${Date.now()}-${sanitizeFileName(input.fileName)}`;
  const relativeDir = path.join("performer-documents", input.performerId);
  const absoluteDir = resolveStoragePath(storageRoot, relativeDir);
  await fs.mkdir(absoluteDir, { recursive: true });
  const storagePath = path.join(relativeDir, storedFileName);
  await fs.writeFile(resolveStoragePath(storageRoot, storagePath), buffer, { flag: "wx" });

  return {
    storagePath,
    originalFileName: path.basename(input.fileName),
    mimeType,
    size: buffer.length,
    checksum: createHash("sha256").update(buffer).digest("hex")
  };
}

export function resolvePerformerDocumentPath(document: { storagePath?: string | null; fileUrl: string }, storageRoot = uploadsRoot) {
  if (document.storagePath) return resolveStoragePath(storageRoot, document.storagePath);
  const prefix = "/uploads/";
  if (!document.fileUrl.startsWith(prefix)) {
    throw new HttpError(404, "Файл документа не найден", "performer_document_file_missing");
  }
  return resolveStoragePath(storageRoot, document.fileUrl.slice(prefix.length));
}

export async function ensureUploadsRoot(storageRoot = uploadsRoot) {
  await fs.mkdir(path.resolve(storageRoot), { recursive: true });
}

export function resolveStoragePath(storageRoot: string, ...segments: string[]) {
  const root = path.resolve(storageRoot);
  const target = path.resolve(root, ...segments);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HttpError(400, "Недопустимый путь файла", "document_storage_path_invalid");
  }
  return target;
}

function sanitizeFileName(fileName: string) {
  const base = path.basename(fileName).replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "");
  return base.slice(0, 120) || "document.pdf";
}

function matchesDocumentSignature(mimeType: string, buffer: Buffer) {
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (["image/heic", "image/heif"].includes(mimeType)) return buffer.subarray(4, 8).toString("ascii") === "ftyp";
  return false;
}
