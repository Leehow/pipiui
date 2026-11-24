import { randomUUID } from "node:crypto";
import {
  closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync, realpathSync,
  renameSync, unlinkSync, writeFileSync, type Stats,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

function sameFile(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino; }

/** Atomic replacement after the loader has checked the extension's declared write root. */
export function replaceConfinedDataFile(projectRoot: string, target: string, content: string): void {
  const jail = realpathSync(projectRoot);
  const jailStat = lstatSync(jail);
  const parent = dirname(resolve(target));
  const rel = relative(jail, parent);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("write escaped project");
  const parentStat = lstatSync(parent);
  function checkBoundary(): void {
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || realpathSync(parent) !== parent ||
        realpathSync(projectRoot) !== jail || !sameFile(lstatSync(jail), jailStat) ||
        !sameFile(lstatSync(parent), parentStat)) throw new Error("write directory changed");
  }
  function targetMode(): number {
    try {
      const stat = lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
      return stat.mode & 0o777;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0o600;
      throw error;
    }
  }
  checkBoundary();
  const mode = targetMode();
  const temp = join(parent, `${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  let owned: Stats | undefined;
  try {
    // Exclusive creation rejects both regular-file collisions and symlinks. Never truncate a pathname.
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    owned = fstatSync(fd);
    if (!owned.isFile() || owned.nlink !== 1) throw new Error("unsafe temporary file");
    checkBoundary();
    writeFileSync(fd, content, { encoding: "utf8" });
    fchmodSync(fd, mode);
    closeSync(fd); fd = undefined;
    checkBoundary();
    targetMode();
    if (!sameFile(lstatSync(temp), owned)) throw new Error("temporary file changed");
    renameSync(temp, target);
    owned = undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
    // A failed exclusive open owns nothing. A replaced directory/path is also not ours to remove.
    if (owned) {
      try {
        checkBoundary();
        if (sameFile(lstatSync(temp), owned)) unlinkSync(temp);
      } catch { /* Leave a displaced or replaced pathname untouched. */ }
    }
  }
}
