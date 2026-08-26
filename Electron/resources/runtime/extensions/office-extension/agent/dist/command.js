import { extname } from "node:path";
import { isSupportedOfficeExtension } from "./edit-policy.js";
export const READ_VERBS = Object.freeze([
    "view",
    "get",
    "query",
    "dump",
    "raw",
    "open",
    "close",
    "save",
    "validate",
]);
export const WRITE_VERBS = Object.freeze([
    "set",
    "add",
    "remove",
    "move",
    "swap",
    "batch",
    "raw-set",
    "add-part",
    "import",
    "merge",
]);
export const CREATE_VERBS = Object.freeze(["create"]);
export const PATHLESS_VERBS = Object.freeze(["help"]);
const READ_SET = new Set(READ_VERBS);
const WRITE_SET = new Set(WRITE_VERBS);
const CREATE_SET = new Set(CREATE_VERBS);
const PATHLESS_SET = new Set(PATHLESS_VERBS);
const KNOWN_VERBS = new Set([...READ_SET, ...WRITE_SET, ...CREATE_SET, ...PATHLESS_SET]);
const TEXT_VERBS = new Set(["view", "raw", "dump"]);
export class CommandParseError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "CommandParseError";
        this.code = code;
    }
}
const CONTROL = /[\u0000-\u001f]/;
export function hasForbiddenChars(value) {
    return CONTROL.test(value);
}
function isWhitespace(ch) {
    return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}
/** Strict string lexer: no shell, fail closed on unterminated quotes or dangling escapes. */
export function tokenizeString(command) {
    const tokens = [];
    let i = 0;
    while (i < command.length) {
        while (i < command.length && isWhitespace(command[i]))
            i += 1;
        if (i >= command.length)
            break;
        const ch = command[i];
        if (ch === '"' || ch === "'") {
            const quote = ch;
            i += 1;
            let token = "";
            let closed = false;
            while (i < command.length) {
                const cur = command[i];
                if (quote === '"' && cur === "\\") {
                    if (i + 1 >= command.length) {
                        throw new CommandParseError("invalid_command", "unterminated escape in double-quoted token");
                    }
                    token += command[i + 1];
                    i += 2;
                    continue;
                }
                if (cur === quote) {
                    closed = true;
                    i += 1;
                    break;
                }
                token += cur;
                i += 1;
            }
            if (!closed)
                throw new CommandParseError("invalid_command", "unterminated quote");
            tokens.push(token);
            continue;
        }
        let token = "";
        while (i < command.length && !isWhitespace(command[i]) && command[i] !== '"' && command[i] !== "'") {
            token += command[i];
            i += 1;
        }
        if (i < command.length && (command[i] === '"' || command[i] === "'")) {
            throw new CommandParseError("invalid_command", "malformed quotes");
        }
        tokens.push(token);
    }
    return tokens;
}
export function tokenizeCommand(command) {
    if (Array.isArray(command)) {
        const tokens = [];
        for (const part of command) {
            if (typeof part !== "string") {
                throw new CommandParseError("invalid_command", "command array entries must be strings");
            }
            if (hasForbiddenChars(part)) {
                throw new CommandParseError("control_chars", "command tokens must not contain NUL or control characters");
            }
            tokens.push(part);
        }
        return tokens;
    }
    if (typeof command !== "string") {
        throw new CommandParseError("invalid_command", "command must be a string or string[]");
    }
    if (hasForbiddenChars(command)) {
        throw new CommandParseError("control_chars", "command must not contain NUL or control characters");
    }
    return tokenizeString(command);
}
export function stripOfficecliPrefix(tokens) {
    if (tokens.length === 0)
        return tokens;
    const base = tokens[0].replace(/\\/g, "/").split("/").pop() ?? tokens[0];
    return /^officecli(?:\.exe)?$/i.test(base) ? tokens.slice(1) : tokens;
}
function parseArgvFlags(tokens) {
    const positionals = [];
    const flags = new Map();
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === "--") {
            positionals.push(...tokens.slice(i + 1));
            break;
        }
        if (token.startsWith("--") && token.length > 2) {
            const eq = token.indexOf("=");
            if (eq !== -1) {
                flags.set(token.slice(2, eq), token.slice(eq + 1));
                continue;
            }
            const name = token.slice(2);
            const next = tokens[i + 1];
            if (next !== undefined && !next.startsWith("-")) {
                flags.set(name, next);
                i += 1;
            }
            else {
                flags.set(name, true);
            }
            continue;
        }
        if (/^-[A-Za-z]$/.test(token)) {
            const name = token.slice(1);
            const next = tokens[i + 1];
            if (next !== undefined && !next.startsWith("-")) {
                flags.set(name, next);
                i += 1;
            }
            else {
                flags.set(name, true);
            }
            continue;
        }
        positionals.push(token);
    }
    return { positionals, flags };
}
export function looksLikePathToken(token) {
    if (!token || token.startsWith("-"))
        return false;
    if (token.startsWith("@"))
        return true;
    if (token.includes("/") || token.includes("\\"))
        return true;
    return isSupportedOfficeExtension(extname(token)) || /\.(json|csv|tsv|tab|png|jpg|jpeg|svg|html|pdf)$/i.test(token);
}
function looksLikeInlineJson(value) {
    const trimmed = value.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
}
/**
 * Exact parity with `parseOfficecliCommand` in office-doc-shot-gate.ts:
 * `view <file> screenshot --grid auto` qualifies; `--page` / `--range` do not.
 */
export function isQualifyingScreenshot(verb, positionals, flags) {
    const mode = (positionals[2] ?? "").toLowerCase();
    const grid = flags.get("grid");
    const hasGridAuto = grid === true || (typeof grid === "string" && grid.toLowerCase() === "auto");
    return verb === "view" && mode === "screenshot" && hasGridAuto && !flags.has("page") && !flags.has("range");
}
function pathSpecsFor(verb, positionals, flags) {
    const rest = positionals.slice(1);
    if (PATHLESS_SET.has(verb))
        return [];
    if (verb === "merge") {
        const specs = [];
        if (rest[0])
            specs.push({ raw: rest[0], mustExist: true, requireOfficeExtension: true });
        if (rest[1])
            specs.push({ raw: rest[1], mustExist: false, requireOfficeExtension: true });
        const data = flags.get("data");
        if (typeof data === "string" && !looksLikeInlineJson(data) && looksLikePathToken(data)) {
            specs.push({ raw: data, mustExist: true, requireOfficeExtension: false });
        }
        return specs;
    }
    if (verb === "import") {
        const specs = [];
        if (rest[0])
            specs.push({ raw: rest[0], mustExist: true, requireOfficeExtension: true });
        const source = (typeof flags.get("file") === "string" ? flags.get("file") : undefined) ?? rest[2];
        if (typeof source === "string" && source)
            specs.push({ raw: source, mustExist: true, requireOfficeExtension: false });
        return specs;
    }
    if (verb === "create") {
        return rest[0] ? [{ raw: rest[0], mustExist: false, requireOfficeExtension: true }] : [];
    }
    const specs = rest[0] ? [{ raw: rest[0], mustExist: true, requireOfficeExtension: true }] : [];
    const out = flags.get("out") ?? flags.get("o");
    if (typeof out === "string" && out)
        specs.push({ raw: out, mustExist: false, requireOfficeExtension: false });
    return specs;
}
export function parseOfficeCommand(command) {
    const argv = stripOfficecliPrefix(tokenizeCommand(command));
    if (argv.length === 0)
        throw new CommandParseError("invalid_command", "command is empty");
    for (const token of argv) {
        if (hasForbiddenChars(token)) {
            throw new CommandParseError("control_chars", "command tokens must not contain NUL or control characters");
        }
    }
    const { positionals, flags } = parseArgvFlags(argv);
    const verb = (positionals[0] ?? "").toLowerCase();
    if (!verb)
        throw new CommandParseError("invalid_command", "command is missing a verb");
    if (!KNOWN_VERBS.has(verb)) {
        throw new CommandParseError("unknown_verb", `unknown officecli verb: ${verb}`);
    }
    const isCreate = CREATE_SET.has(verb);
    const isWrite = isCreate || WRITE_SET.has(verb);
    const pathSpecs = pathSpecsFor(verb, positionals, flags);
    if (!PATHLESS_SET.has(verb) && pathSpecs.length === 0) {
        throw new CommandParseError("invalid_command", `verb ${verb} requires a document path`);
    }
    if (verb === "merge" && pathSpecs.filter((spec) => spec.requireOfficeExtension).length < 2) {
        throw new CommandParseError("invalid_command", "merge requires template and output paths");
    }
    return {
        verb,
        argv,
        positionals,
        flags,
        pathSpecs,
        rawTargets: pathSpecs.map((spec) => spec.raw),
        isCreate,
        isWrite,
        isQualifyingScreenshot: isQualifyingScreenshot(verb, positionals, flags),
        asJson: !TEXT_VERBS.has(verb),
    };
}
export function gateKind(parsed) {
    if (parsed.isQualifyingScreenshot)
        return "screenshot";
    if (parsed.isCreate)
        return "create";
    if (parsed.isWrite)
        return "write";
    return "other";
}
