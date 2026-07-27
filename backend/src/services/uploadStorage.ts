import fs from "node:fs/promises";
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
  if (buffer.length > maxDocumentBytes) {
    throw new HttpError(400, "Размер файла не должен превышать 5 МБ", "document_file_too_large");
  }

  const storedFileName = `${input.type}-${Date.now()}-${sanitizeFileName(input.fileName)}`;
  const relativeDir = path.join("performer-documents", input.performerId);
  const absoluteDir = resolveStoragePath(storageRoot, relativeDir);
  await fs.mkdir(absoluteDir, { recursive: true });
  await fs.writeFile(resolveStoragePath(storageRoot, relativeDir, storedFileName), buffer);

  return {
    fileUrl: `/uploads/performer-documents/${input.performerId}/${storedFileName}`,
    mimeType,
    size: buffer.length
  };
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
