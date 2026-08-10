import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = process.argv[2];
if (!workspace) throw new Error("usage: SpecialistToolRuntimeHarness.mjs <workspace>");

function atom(id) {
  return `<?xml version="1.0"?>
<feed><entry>
  <id>https://arxiv.org/abs/${id}</id>
  <title>Fixture &amp; Paper</title>
  <author><name>Ada Lovelace</name></author>
  <summary>Fixture abstract.</summary>
  <category term="cs.AI" />
  <arxiv:primary_category term="cs.AI" />
  <published>2025-01-01T00:00:00Z</published>
  <updated>2025-01-02T00:00:00Z</updated>
</entry></feed>`;
}

function html(label) {
  return `<html><body><main><h1>${label}</h1><p>${
    "Readable arXiv fixture prose with enough content to pass the quality gate. ".repeat(5)
  }</p></main></body></html>`;
}

function response(body, options = {}) {
  return new Response(body, {
    status: options.status ?? 200,
    headers: options.headers ?? {},
  });
}

async function installStubModules() {
  await writeFile(join(workspace, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  const typebox = join(workspace, "node_modules", "typebox");
  await mkdir(typebox, { recursive: true });
  await writeFile(
    join(typebox, "package.json"),
    JSON.stringify({ name: "typebox", type: "module", exports: "./index.js" }),
    "utf8",
  );
  await writeFile(
    join(typebox, "index.js"),
    "export const Type = new Proxy({}, { get: (_target, key) => (...args) => ({ kind: String(key), args }) });\n",
    "utf8",
  );

  const pi = join(workspace, "node_modules", "@earendil-works", "pi-coding-agent");
  await mkdir(pi, { recursive: true });
  await writeFile(
    join(pi, "package.json"),
    JSON.stringify({ name: "@earendil-works/pi-coding-agent", type: "module", exports: "./index.js" }),
    "utf8",
  );
  await writeFile(join(pi, "index.js"), "export {};\n", "utf8");
}

async function loadArxivTool() {
  const packageRoot = join(workspace, "packages", "arxiv-fetch");
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const entry = manifest?.pi?.extensions?.[0];
  assert.equal(entry, "./extensions/arxiv-fetch.ts");
  const module = await import(`${pathToFileURL(join(packageRoot, entry)).href}?runtime`);
  const tools = new Map();
  module.default({ registerTool(tool) { tools.set(tool.name, tool); } });
  return tools.get("arxiv_fetch");
}

async function main() {
  await installStubModules();
  const tool = await loadArxivTool();
  assert.ok(tool, "arxiv_fetch must register");
  const scenarios = [];

  let calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.startsWith("https://export.arxiv.org/api/query")) {
      return response(atom("2503.12345v1"), { headers: { "content-type": "application/atom+xml" } });
    }
    if (href === "https://arxiv.org/html/2503.12345v1") {
      return response(html("PDF URL HTML fixture"), { headers: { "content-type": "text/html" } });
    }
    throw new Error(`the retired PDF helper route must not fetch ${href}`);
  };

  const pdfURL = await tool.execute(
    "runtime-pdf",
    { url: "https://arxiv.org/pdf/2503.12345v1" },
  );
  const pdfText = pdfURL.content.map((part) => part.text ?? "").join("");
  assert.equal(pdfURL.isError, undefined);
  assert.match(pdfText, /content_source: arxiv-html/);
  assert.match(pdfText, /PDF URL HTML fixture/);
  assert.equal(calls.some((url) => url.includes("/pdf/")), false);
  scenarios.push("PDF URL uses arXiv HTML without a helper");

  calls = [];
  const unsupported = await tool.execute(
    "runtime-unsupported",
    { url: "https://example.invalid/not-arxiv" },
  );
  assert.equal(unsupported.isError, true);
  assert.match(unsupported.content[0].text, /use fetch_content/);
  const sourceArchive = await tool.execute(
    "runtime-source",
    { url: "https://arxiv.org/e-print/2503.12345" },
  );
  assert.equal(sourceArchive.isError, true);
  assert.match(sourceArchive.content[0].text, /source archives are not fetched/);
  assert.deepEqual(calls, []);
  scenarios.push("unsupported routes fail before networking");

  process.stdout.write(`${JSON.stringify({ ok: true, scenarios })}\n`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
