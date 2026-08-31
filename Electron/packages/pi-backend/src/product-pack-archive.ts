import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { open as openZip, type Entry, type ZipFile as ReadZipFile } from "yauzl";
import { ZipFile as WriteZipFile } from "yazl";

import {
  PRODUCT_PACK_MANIFEST_FILENAME,
  PRODUCT_PACK_SCHEMA_VERSION,
  isProductPackRelativePath,
  type ProductPackManifest,
} from "./product-pack-manifest.js";
import { EXTENSION_HOST_API_VERSION, EXTENSION_MANIFEST_FILENAME } from "./extension-manifest.js";
import { PRODUCT_PROFILE_MANIFEST_FILENAME, type ProductProfileManifest } from "./profile-manifest.js";

export const PRODUCT_PACK_ARCHIVE_EXTENSION = ".pipiui-pack.zip";
export const PRODUCT_PACK_ARCHIVE_MAX_ENTRIES = 20_000;
export const PRODUCT_PACK_ARCHIVE_MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
export const PRODUCT_PACK_ARCHIVE_MAX_ENTRY_BYTES = 1024 * 1024 * 1024;

const ZIP_EPOCH = new Date("1980-01-01T00:00:00.000Z");
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_DIRECTORY = 0o040000;
const UNIX_SYMLINK = 0o120000;

export type ProductPackArchiveExtension = {
  id: string;
  directory: string;
};

export type ProductPackArchiveWriteInput = {
  destination: string;
  packId: string;
  packName: string;
  profile: ProductProfileManifest;
  extensions: readonly ProductPackArchiveExtension[];
};

export type ProductPackArchiveWriteResult = {
  archivePath: string;
  bytes: number;
  extensionCount: number;
};

function inside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function assertArchivePath(path: string): void {
  if (!isAbsolute(path) || !path.toLowerCase().endsWith(".zip")) {
    throw new Error("Product Pack archive path must be an absolute .zip path");
  }
}

function assertEntryName(name: string): string {
  const normalized = name.endsWith("/") ? name.slice(0, -1) : name;
  if (!normalized || name.includes("\0") || !isProductPackRelativePath(normalized)) {
    throw new Error(`Product Pack archive contains unsafe path '${name}'`);
  }
  return normalized;
}

function unixMode(entry: Entry): number {
  return (entry.externalFileAttributes >>> 16) & 0xffff;
}

function openArchive(path: string): Promise<ReadZipFile> {
  return new Promise((resolveOpen, rejectOpen) => {
    openZip(path, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    }, (error, zip) => {
      if (error) rejectOpen(error);
      else resolveOpen(zip);
    });
  });
}

function openEntry(zip: ReadZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolveStream, rejectStream) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) rejectStream(error);
      else resolveStream(stream);
    });
  });
}

async function extractArchive(archivePath: string, destination: string): Promise<void> {
  assertArchivePath(archivePath);
  const archiveInfo = await lstat(archivePath);
  if (!archiveInfo.isFile() || archiveInfo.isSymbolicLink()) {
    throw new Error("Product Pack archive must be a real file");
  }
  const zip = await openArchive(archivePath);
  const names = new Set<string>();
  let entries = 0;
  let uncompressedBytes = 0;
  try {
    await new Promise<void>((resolveArchive, rejectArchive) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        rejectArchive(error);
      };
      zip.once("error", fail);
      zip.once("end", () => {
        if (settled) return;
        settled = true;
        resolveArchive();
      });
      zip.on("entry", entry => {
        void (async () => {
          entries += 1;
          if (entries > PRODUCT_PACK_ARCHIVE_MAX_ENTRIES) throw new Error("Product Pack archive has too many entries");
          if (entry.uncompressedSize > PRODUCT_PACK_ARCHIVE_MAX_ENTRY_BYTES) throw new Error(`Product Pack archive entry is too large: ${entry.fileName}`);
          uncompressedBytes += entry.uncompressedSize;
          if (uncompressedBytes > PRODUCT_PACK_ARCHIVE_MAX_UNCOMPRESSED_BYTES) throw new Error("Product Pack archive expands beyond the size limit");
          if (entry.isEncrypted()) throw new Error(`Product Pack archive entry is encrypted: ${entry.fileName}`);
          const entryName = assertEntryName(entry.fileName);
          if (names.has(entryName)) throw new Error(`Product Pack archive contains duplicate path '${entryName}'`);
          names.add(entryName);
          const mode = unixMode(entry);
          const type = mode & UNIX_FILE_TYPE_MASK;
          if (type === UNIX_SYMLINK) throw new Error(`Product Pack archive contains a symbolic link: ${entry.fileName}`);
          const isDirectory = entry.fileName.endsWith("/") || type === UNIX_DIRECTORY;
          if (!isDirectory && type !== 0 && type !== UNIX_REGULAR_FILE) {
            throw new Error(`Product Pack archive contains a special file: ${entry.fileName}`);
          }
          const output = resolve(destination, entryName);
          if (!inside(destination, output)) throw new Error(`Product Pack archive path escapes extraction root: ${entry.fileName}`);
          if (isDirectory) {
            await mkdir(output, { recursive: true });
          } else {
            await mkdir(dirname(output), { recursive: true });
            const stream = await openEntry(zip, entry);
            try {
              await pipeline(stream, createWriteStream(output, { flags: "wx", mode: mode ? mode & 0o777 : 0o600 }));
              await chmod(output, mode ? mode & 0o777 : 0o600);
            } catch (error) {
              await rm(output, { force: true }).catch(() => undefined);
              throw error;
            }
          }
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  await access(join(destination, PRODUCT_PACK_MANIFEST_FILENAME));
}

async function walkFiles(root: string): Promise<Array<{ path: string; relativePath: string; mode: number }>> {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`extension export source must be a real directory: ${root}`);
  const jail = await realpath(root);
  const files: Array<{ path: string; relativePath: string; mode: number }> = [];
  const walk = async (directory: string, prefix: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const entryInfo = await lstat(path);
      if (entryInfo.isSymbolicLink()) throw new Error(`extension export source contains a symbolic link: ${path}`);
      const real = await realpath(path);
      if (!inside(jail, real)) throw new Error(`extension export source escapes its package root: ${path}`);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entryInfo.isDirectory()) await walk(path, relativePath);
      else if (entryInfo.isFile()) files.push({ path, relativePath, mode: entryInfo.mode & 0o777 });
      else throw new Error(`extension export source contains a special file: ${path}`);
    }
  };
  await walk(jail, "");
  return files;
}

export async function writeProductPackArchive(input: ProductPackArchiveWriteInput): Promise<ProductPackArchiveWriteResult> {
  assertArchivePath(input.destination);
  const parent = dirname(input.destination);
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error("Product Pack archive parent must be a real directory");
  try {
    const existing = await lstat(input.destination);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error("Product Pack archive destination must be a file path");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const manifest: ProductPackManifest = {
    schemaVersion: PRODUCT_PACK_SCHEMA_VERSION,
    id: input.packId,
    name: input.packName,
    profile: `profile/${PRODUCT_PROFILE_MANIFEST_FILENAME}`,
    extensions: input.extensions
      .map(extension => ({ id: extension.id, path: `extensions/${extension.id}` }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  const zip = new WriteZipFile();
  zip.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), PRODUCT_PACK_MANIFEST_FILENAME, { mtime: ZIP_EPOCH, mode: 0o100644 });
  zip.addBuffer(Buffer.from(`${JSON.stringify(input.profile, null, 2)}\n`), `profile/${PRODUCT_PROFILE_MANIFEST_FILENAME}`, { mtime: ZIP_EPOCH, mode: 0o100644 });
  for (const extension of [...input.extensions].sort((left, right) => left.id.localeCompare(right.id))) {
    for (const file of await walkFiles(extension.directory)) {
      const archivePath = `extensions/${extension.id}/${file.relativePath}`;
      if (file.relativePath === EXTENSION_MANIFEST_FILENAME) {
        const manifest = JSON.parse(await readFile(file.path, "utf8")) as Record<string, unknown>;
        if (typeof manifest.hostApi !== "string" || !manifest.hostApi.trim()) {
          manifest.hostApi = `^${EXTENSION_HOST_API_VERSION}`;
        }
        zip.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), archivePath, { mtime: ZIP_EPOCH, mode: UNIX_REGULAR_FILE | file.mode });
      } else {
        zip.addFile(file.path, archivePath, { mtime: ZIP_EPOCH, mode: UNIX_REGULAR_FILE | file.mode });
      }
    }
  }
  const temporary = join(parent, `.${basename(input.destination)}-${process.pid}-${randomUUID()}.tmp`);
  try {
    const output = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
    const writing = pipeline(zip.outputStream as Readable, output);
    zip.end();
    await writing;
    await rename(temporary, input.destination);
    const written = await stat(input.destination);
    return { archivePath: input.destination, bytes: written.size, extensionCount: input.extensions.length };
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function installFromProductPackArchive<T>(
  archivePath: string,
  installDirectory: (directory: string) => Promise<T>,
): Promise<T> {
  const extractionRoot = await mkdtemp(join(tmpdir(), "pipiui-product-pack-"));
  try {
    await extractArchive(archivePath, extractionRoot);
    return await installDirectory(extractionRoot);
  } finally {
    await rm(extractionRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
