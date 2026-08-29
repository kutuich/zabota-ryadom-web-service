import { resolveUploadsDir } from "../config/env";
import type { ObjectStorage } from "./objectStorage";
import { LocalObjectStorage } from "./localObjectStorage";
import { S3ObjectStorage } from "./s3ObjectStorage";

export function createObjectStorage(source: NodeJS.ProcessEnv = process.env): ObjectStorage {
  const provider = resolveStorageProviderName(source);
  if (provider === "local") return new LocalObjectStorage(resolveUploadsDir(source));
  if (provider !== "s3") throw new Error(`Unsupported STORAGE_PROVIDER: ${provider}`);

  const bucket = required(source, "S3_BUCKET");
  const accessKeyId = required(source, "S3_ACCESS_KEY_ID");
  const secretAccessKey = required(source, "S3_SECRET_ACCESS_KEY");
  return new S3ObjectStorage({
    endpoint: source.S3_ENDPOINT?.trim() || undefined,
    region: source.S3_REGION?.trim() || "us-east-1",
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: parseBoolean(source.S3_FORCE_PATH_STYLE, false)
  });
}

export function resolveStorageProviderName(source: NodeJS.ProcessEnv = process.env) {
  const provider = (source.STORAGE_PROVIDER?.trim() || "local").toLowerCase();
  if (provider !== "local" && provider !== "s3") throw new Error(`Unsupported STORAGE_PROVIDER: ${provider}`);
  return provider as "local" | "s3";
}

export const storageProviderName = resolveStorageProviderName();
export const objectStorage = createObjectStorage();

function required(source: NodeJS.ProcessEnv, name: string) {
  const value = source[name]?.trim();
  if (!value) throw new Error(`${name} is required when STORAGE_PROVIDER=s3`);
  return value;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  return ["true", "1"].includes(value.trim().toLowerCase());
}
