import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ObjectStorage, PutObjectInput, StoredObject, StoredObjectMetadata } from "./objectStorage";
import { normalizeObjectKey, ObjectStorageNotFoundError } from "./objectStorage";

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  async initialize() {
    await fs.mkdir(path.resolve(this.root), { recursive: true });
  }

  async put(input: PutObjectInput) {
    const key = normalizeObjectKey(input.key);
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, input.body, { flag: "wx" });
    const metadata: StoredObjectMetadata = {
      key,
      size: input.body.length,
      contentType: input.contentType,
      checksum: input.checksum
    };
    await fs.writeFile(this.metadataPath(target), JSON.stringify(metadata), { flag: "wx" });
    return metadata;
  }

  async get(key: string): Promise<StoredObject> {
    const normalized = normalizeObjectKey(key);
    const target = this.resolve(normalized);
    let body: Buffer;
    try {
      body = await fs.readFile(target);
    } catch (error: any) {
      if (error?.code === "ENOENT") throw new ObjectStorageNotFoundError(normalized);
      throw error;
    }
    const sidecar = await this.readMetadata(target);
    return {
      key: normalized,
      body,
      size: body.length,
      contentType: sidecar?.contentType ?? "application/octet-stream",
      checksum: sidecar?.checksum ?? createHash("sha256").update(body).digest("hex")
    };
  }

  async head(key: string) {
    try {
      const object = await this.get(key);
      const { body: _body, ...metadata } = object;
      return metadata;
    } catch (error) {
      if (error instanceof ObjectStorageNotFoundError) return null;
      throw error;
    }
  }

  async exists(key: string) {
    return (await this.head(key)) !== null;
  }

  async delete(key: string) {
    const target = this.resolve(normalizeObjectKey(key));
    await Promise.all([
      fs.rm(target, { force: true }),
      fs.rm(this.metadataPath(target), { force: true })
    ]);
  }

  private resolve(key: string) {
    const root = path.resolve(this.root);
    const target = path.resolve(root, ...key.split("/"));
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid object storage key");
    return target;
  }

  private metadataPath(target: string) {
    return `${target}.storage-metadata.json`;
  }

  private async readMetadata(target: string): Promise<StoredObjectMetadata | null> {
    try {
      return JSON.parse(await fs.readFile(this.metadataPath(target), "utf8"));
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
}

