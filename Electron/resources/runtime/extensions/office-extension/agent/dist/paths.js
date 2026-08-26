import { lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { isSupportedOfficeExtension } from "./edit-policy.js";
export class PathValidationError extends Error {
    code = "path_rejected";
    reason;
    input;
    constructor(reason, input, message) {
        super(message);
        this.name = "PathValidationError";
        this.reason = reason;
        this.input = input;
    }
}
const CONTROL = /[\u0000-\u001f]/;
function hasDotDotSegment(value) {
    return value.split(/[\\/]+/).includes("..");
}
export function containedBy(root, target) {
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
    return target === root || target.startsWith(prefix);
}
/**
 * Reject any symlink on the lexical walk from project root to the target.
 * Residual race: a component can still be replaced between this last check and
 * the SDK process opening the path; that is irreducible without OS file-handle
 * passing, which @officecli/sdk@0.1.2 does not expose.
 */
async function assertNoSymlinkComponents(absolute, root, mustExist) {
    const rel = relative(root, absolute);
    if (!rel || rel === ".")
        return;
    if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new PathValidationError("absolute_outside", absolute, "absolute path is outside the project root");
    }
    let acc = root;
    const parts = rel.split(/[\\/]+/).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
        acc = join(acc, parts[i]);
        let st;
        try {
            st = await lstat(acc);
        }
        catch {
            if (!mustExist && i === parts.length - 1)
                return;
            throw new PathValidationError(i === parts.length - 1 ? "not_a_file" : "missing_parent", absolute, "path component does not exist");
        }
        if (st.isSymbolicLink()) {
            throw new PathValidationError("symlink_escape", absolute, "symlink components are not allowed");
        }
    }
}
export async function validateDocumentPath(input, projectRoot, options) {
    if (typeof input !== "string" || input.length === 0) {
        throw new PathValidationError("empty", input, "document path is empty");
    }
    if (CONTROL.test(input)) {
        throw new PathValidationError("control_chars", input, "document path contains NUL or control characters");
    }
    const stripped = input.startsWith("@") ? input.slice(1) : input;
    if (!stripped)
        throw new PathValidationError("empty", input, "document path is empty");
    if (CONTROL.test(stripped)) {
        throw new PathValidationError("control_chars", input, "document path contains NUL or control characters");
    }
    if (stripped.startsWith("~")) {
        throw new PathValidationError("home_expansion", input, "home-directory paths are not allowed");
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(stripped) && !/^[a-zA-Z]:[\\/]/.test(stripped)) {
        throw new PathValidationError("url_shape", input, "URL document paths are not allowed");
    }
    if (hasDotDotSegment(stripped)) {
        throw new PathValidationError("traversal", input, "path traversal is not allowed");
    }
    const root = resolve(projectRoot);
    const absolute = normalize(isAbsolute(stripped) ? stripped : resolve(root, stripped));
    if (!containedBy(root, absolute)) {
        throw new PathValidationError("absolute_outside", input, "absolute path is outside the project root");
    }
    const requireOfficeExtension = options.requireOfficeExtension !== false;
    const extension = extname(absolute).toLowerCase();
    if (requireOfficeExtension && !isSupportedOfficeExtension(extension)) {
        throw new PathValidationError("unsupported_extension", input, `unsupported office extension: ${extension || "(none)"}`);
    }
    let realRoot;
    try {
        realRoot = await realpath(root);
    }
    catch {
        throw new PathValidationError("missing_parent", input, "project root is not a resolvable directory");
    }
    await assertNoSymlinkComponents(absolute, root, options.mustExist);
    if (options.mustExist) {
        let st;
        try {
            st = await lstat(absolute);
        }
        catch {
            throw new PathValidationError("not_a_file", input, "document path does not exist");
        }
        if (st.isDirectory()) {
            throw new PathValidationError("is_directory", input, "document path is a directory");
        }
        if (st.isSymbolicLink()) {
            throw new PathValidationError("symlink_escape", input, "symlink components are not allowed");
        }
        if (!st.isFile()) {
            throw new PathValidationError("not_a_file", input, "document path is not a regular file");
        }
        let realFile;
        try {
            realFile = await realpath(absolute);
        }
        catch {
            throw new PathValidationError("not_a_file", input, "document path is not a regular file");
        }
        if (!containedBy(realRoot, realFile)) {
            throw new PathValidationError("symlink_escape", input, "symlink escapes the project root");
        }
        return {
            input,
            absolute: realFile,
            extension: extname(realFile).toLowerCase() || extension,
            mustExist: true,
            requireOfficeExtension,
        };
    }
    const parent = dirname(absolute);
    let realParent;
    try {
        realParent = await realpath(parent);
    }
    catch {
        throw new PathValidationError("missing_parent", input, "parent directory does not exist");
    }
    if (!containedBy(realRoot, realParent)) {
        throw new PathValidationError("symlink_escape", input, "parent symlink escapes the project root");
    }
    const parentSt = await stat(realParent);
    if (!parentSt.isDirectory()) {
        throw new PathValidationError("missing_parent", input, "parent path is not a directory");
    }
    try {
        const existing = await lstat(absolute);
        if (existing.isDirectory()) {
            throw new PathValidationError("is_directory", input, "document path is a directory");
        }
        if (existing.isSymbolicLink()) {
            throw new PathValidationError("symlink_escape", input, "symlink components are not allowed");
        }
    }
    catch (error) {
        if (error instanceof PathValidationError)
            throw error;
    }
    return {
        input,
        absolute: join(realParent, basename(absolute)),
        extension,
        mustExist: false,
        requireOfficeExtension,
    };
}
export async function recheckValidatedPath(previous, projectRoot) {
    const again = await validateDocumentPath(previous.input, projectRoot, {
        mustExist: previous.mustExist,
        requireOfficeExtension: previous.requireOfficeExtension,
    });
    if (again.absolute !== previous.absolute) {
        throw new PathValidationError("toctou", previous.input, "path changed between validation and use");
    }
    return again;
}
