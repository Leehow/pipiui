import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-document-read-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  return createPiHostBackend({ agentDir });
}

describe("explicit Markdown document reads", () => {
  it("returns the real requested Markdown file without scanning a project", async () => {
    const backend = await fixture();
    const path = join(root, "notes.markdown");
    await writeFile(path, "# Real document\n\nLoaded from disk.\n");

    expect(await backend.handle("listDocuments", [])).toEqual([]);
    expect(await backend.handle("readDocument", [path])).toMatchObject({
      id: path,
      name: "notes.markdown",
      path,
      kind: "markdown",
      content: "# Real document\n\nLoaded from disk.\n",
    });
    await backend.close();
  });

  it("rejects missing, relative, non-Markdown, non-file, and oversized inputs", async () => {
    const backend = await fixture();
    const directory = join(root, "folder.md");
    const text = join(root, "notes.txt");
    const oversized = join(root, "large.md");
    await mkdir(directory);
    await writeFile(text, "plain");
    await writeFile(oversized, Buffer.alloc(2 * 1024 * 1024 + 1));

    await expect(backend.handle("readDocument", [""])).rejects.toThrow("document path is required");
    await expect(backend.handle("readDocument", ["relative.md"])).rejects.toThrow("must be absolute");
    await expect(backend.handle("readDocument", [text])).rejects.toThrow("only .md and .markdown");
    await expect(backend.handle("readDocument", [directory])).rejects.toThrow("not a regular file");
    await expect(backend.handle("readDocument", [join(root, "missing.md")])).rejects.toThrow("does not exist");
    await expect(backend.handle("readDocument", [oversized])).rejects.toThrow("too large");
    await backend.close();
  });
});
