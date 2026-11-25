import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/server/config/env";

/**
 * Object-storage abstraction for original documents.
 *
 * Keys are generated server-side (`<ownerId>/<uuid>`) and are never derived
 * from the uploaded filename, which rules out path traversal via user input.
 * A production deployment would add an S3/GCS implementation of this interface.
 */
export interface DocumentStorage {
  put(ownerId: string, data: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}\/[0-9a-f-]{36}$/;

export class LocalDiskStorage implements DocumentStorage {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  private resolveKey(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key");
    const full = path.resolve(this.root, key);
    // Defence in depth: the resolved path must remain inside the storage root.
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(ownerId: string, data: Buffer): Promise<string> {
    const safeOwner = ownerId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
    const key = `${safeOwner}/${randomUUID()}`;
    const full = this.resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    // `wx` fails if the file already exists – keys are never silently overwritten.
    await writeFile(full, data, { flag: "wx", mode: 0o600 });
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    const full = this.resolveKey(key);
    await rm(full, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }
}

let storage: DocumentStorage | undefined;

export function getStorage(): DocumentStorage {
  if (!storage) {
    const env = getEnv();
    switch (env.STORAGE_DRIVER) {
      case "local":
        storage = new LocalDiskStorage(env.STORAGE_LOCAL_DIR);
        break;
    }
  }
  return storage;
}

/** Test hook. */
export function setStorage(custom: DocumentStorage | undefined): void {
  storage = custom;
}
