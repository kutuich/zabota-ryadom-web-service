import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import type { ObjectStorage, PutObjectInput, StoredObjectMetadata } from "./objectStorage";
import { normalizeObjectKey, ObjectStorageNotFoundError } from "./objectStorage";

export type S3ObjectStorageConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3ObjectStorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  async initialize() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
  }

  async put(input: PutObjectInput) {
    const key = normalizeObjectKey(input.key);
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: input.body,
      ContentLength: input.body.length,
      ContentType: input.contentType,
      ChecksumSHA256: Buffer.from(input.checksum, "hex").toString("base64"),
      Metadata: { sha256: input.checksum },
      IfNoneMatch: "*"
    }));
    const stored = await this.head(key);
    if (!stored || stored.size !== input.body.length || stored.checksum !== input.checksum) {
      throw new Error(`Object verification failed after upload: ${key}`);
    }
    return stored;
  }

  async get(key: string) {
    const normalized = normalizeObjectKey(key);
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: normalized, ChecksumMode: "ENABLED" }));
      if (!response.Body) throw new ObjectStorageNotFoundError(normalized);
      const body = Buffer.from(await response.Body.transformToByteArray());
      const checksum = decodeChecksum(response.ChecksumSHA256) || response.Metadata?.sha256 || "";
      return {
        key: normalized,
        body,
        size: response.ContentLength ?? body.length,
        contentType: response.ContentType ?? "application/octet-stream",
        checksum
      };
    } catch (error) {
      if (isNotFound(error)) throw new ObjectStorageNotFoundError(normalized);
      throw error;
    }
  }

  async head(key: string): Promise<StoredObjectMetadata | null> {
    const normalized = normalizeObjectKey(key);
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: normalized, ChecksumMode: "ENABLED" }));
      const providerChecksum = decodeChecksum(response.ChecksumSHA256);
      const metadataChecksum = response.Metadata?.sha256 ?? "";
      if (providerChecksum && metadataChecksum && providerChecksum !== metadataChecksum) {
        throw new Error(`Object checksum metadata mismatch: ${normalized}`);
      }
      return {
        key: normalized,
        size: response.ContentLength ?? 0,
        contentType: response.ContentType ?? "application/octet-stream",
        checksum: providerChecksum || metadataChecksum
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async exists(key: string) {
    return (await this.head(key)) !== null;
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: normalizeObjectKey(key) }));
  }
}

function isNotFound(error: any) {
  return error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey" || error?.name === "NotFound";
}

function decodeChecksum(value: string | undefined) {
  return value ? Buffer.from(value, "base64").toString("hex") : "";
}
