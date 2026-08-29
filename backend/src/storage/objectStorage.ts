export type StoredObjectMetadata = {
  key: string;
  size: number;
  contentType: string;
  checksum: string;
};

export type StoredObject = StoredObjectMetadata & {
  body: Buffer;
};

export type PutObjectInput = {
  key: string;
  body: Buffer;
  contentType: string;
  checksum: string;
};

export interface ObjectStorage {
  initialize(): Promise<void>;
  put(input: PutObjectInput): Promise<StoredObjectMetadata>;
  get(key: string): Promise<StoredObject>;
  head(key: string): Promise<StoredObjectMetadata | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export class ObjectStorageNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Stored object was not found: ${key}`);
    this.name = "ObjectStorageNotFoundError";
  }
}

export function normalizeObjectKey(key: string) {
  const normalized = key.replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  if (!normalized || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid object storage key");
  }
  return normalized;
}

