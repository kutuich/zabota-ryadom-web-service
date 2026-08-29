import crypto from "node:crypto";
import path from "node:path";
import { objectStorage } from "../storage/storageProvider";
import { HttpError } from "../utils/http";

export const SERVICE_ATTACHMENT_MAX_FILES = 5;
export const SERVICE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

const allowedExtensions = new Map([
  [".pdf", ["application/pdf"]],
  [".jpg", ["image/jpeg"]],
  [".jpeg", ["image/jpeg"]],
  [".png", ["image/png"]],
  [".webp", ["image/webp"]],
  [".docx", ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
  [".xlsx", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]]
]);

export type ServiceAttachmentUpload = {
  fileName: string;
  mimeType: string;
  fileData: string;
  attachmentType?: string;
};

export type PreparedServiceAttachment = {
  originalFileName: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  attachmentType: string;
  checksum: string;
  buffer: Buffer;
};

export function prepareServiceAttachments(files: ServiceAttachmentUpload[] = []) {
  if (files.length > SERVICE_ATTACHMENT_MAX_FILES) {
    throw new HttpError(400, "К сообщению можно прикрепить не более 5 файлов", "service_attachment_count_exceeded");
  }
  return files.map(prepareServiceAttachment);
}

export async function savePreparedServiceAttachments(input: {
  userId: string;
  messageId: string;
  files: PreparedServiceAttachment[];
}) {
  const saved: Array<PreparedServiceAttachment & { storagePath: string }> = [];
  try {
    for (const file of input.files) {
      const storagePath = `service-message-attachments/${crypto.randomUUID()}`;
      await objectStorage.put({
        key: storagePath,
        body: file.buffer,
        contentType: file.mimeType,
        checksum: file.checksum
      });
      saved.push({ ...file, storagePath });
    }
    return saved;
  } catch (error) {
    await removeSavedServiceAttachments(saved.map((file) => file.storagePath));
    throw error;
  }
}

export async function removeSavedServiceAttachments(storagePaths: string[]) {
  await Promise.all(storagePaths.map(async (storagePath) => {
    try { await objectStorage.delete(storagePath); } catch { /* best-effort rollback */ }
  }));
}

function prepareServiceAttachment(file: ServiceAttachmentUpload): PreparedServiceAttachment {
  const originalFileName = path.basename(file.fileName || "").slice(0, 255);
  const extension = path.extname(originalFileName).toLocaleLowerCase();
  const allowedMimes = allowedExtensions.get(extension);
  if (!originalFileName || !allowedMimes || !allowedMimes.includes(file.mimeType)) {
    throw new HttpError(400, "Разрешены PDF, JPG, PNG, WEBP, DOCX и XLSX", "service_attachment_type_invalid");
  }
  const encoded = file.fileData.includes(",") ? file.fileData.slice(file.fileData.indexOf(",") + 1) : file.fileData;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new HttpError(400, "Файл имеет неверный формат", "service_attachment_data_invalid");
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > SERVICE_ATTACHMENT_MAX_BYTES) {
    throw new HttpError(400, "Размер файла должен быть не более 10 МБ", "service_attachment_size_invalid");
  }
  if (!matchesSignature(extension, buffer)) {
    throw new HttpError(400, "Содержимое файла не соответствует его типу", "service_attachment_signature_invalid");
  }
  return {
    originalFileName,
    fileName: `${safeBaseName(path.basename(originalFileName, extension))}-${crypto.randomUUID()}${extension}`,
    mimeType: file.mimeType,
    fileSize: buffer.length,
    attachmentType: file.attachmentType ?? "other",
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
    buffer
  };
}

function matchesSignature(extension: string, buffer: Buffer) {
  if (extension === ".pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if ([".jpg", ".jpeg"].includes(extension)) return buffer[0] === 0xff && buffer[1] === 0xd8;
  if (extension === ".png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === ".webp") return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  return buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function safeBaseName(value: string) {
  return value.normalize("NFKC").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "attachment";
}
