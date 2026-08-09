import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = process.argv[2];
if (!workspace) throw new Error("usage: SpecialistToolRuntimeHarness.mjs <workspace>");

const extensionsDirectory = join(workspace, "extensions");
const packagesDirectory = join(workspace, "packages");
const temporaryDirectory = join(workspace, "tmp");
process.env.TMPDIR = temporaryDirectory;

const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const nativeDateNow = Date.now;
let logicalNow;
let accelerateArxivThrottle = false;
let fastTimerCount = 0;
const fakeTimers = new Set();

Date.now = () => logicalNow ?? nativeDateNow();
globalThis.setTimeout = (callback, milliseconds = 0, ...args) => {
  const delay = Number(milliseconds) || 0;
  const shouldAccelerateThrottle = accelerateArxivThrottle && delay > 0 && delay <= 3_000;
  const shouldFastForward = fastTimerCount > 0 && delay >= 1_000;
  if (!shouldAccelerateThrottle && !shouldFastForward) {
    return nativeSetTimeout(callback, milliseconds, ...args);
  }
  if (shouldFastForward) fastTimerCount -= 1;
  const handle = { pipiuiSpecialistRuntimeTimer: true, cancelled: false };
  fakeTimers.add(handle);
  queueMicrotask(() => {
    if (handle.cancelled) return;
    if (shouldAccelerateThrottle && logicalNow !== undefined) logicalNow += delay;
    callback(...args);
  });
  return handle;
};
globalThis.clearTimeout = (handle) => {
  if (handle && handle.pipiuiSpecialistRuntimeTimer) {
    handle.cancelled = true;
    fakeTimers.delete(handle);
    return;
  }
  nativeClearTimeout(handle);
};

async function withAcceleratedArxivClock(operation) {
  const priorNow = logicalNow;
  const priorThrottle = accelerateArxivThrottle;
  logicalNow = nativeDateNow() + 3_600_000;
  accelerateArxivThrottle = true;
  try {
    await operation();
  } finally {
    logicalNow = priorNow;
    accelerateArxivThrottle = priorThrottle;
  }
}

function armFastTimers(count) {
  fastTimerCount = count;
}

async function writeJSON(path, value) {
  await writeFile(path, JSON.stringify(value), "utf8");
}

async function installStubModules() {
  await mkdir(temporaryDirectory, { recursive: true });
  await writeJSON(join(workspace, "package.json"), { type: "module" });

  const typeboxDirectory = join(workspace, "node_modules", "typebox");
  await mkdir(typeboxDirectory, { recursive: true });
  await writeJSON(join(typeboxDirectory, "package.json"), {
    name: "typebox",
    type: "module",
    exports: "./index.js",
  });
  await writeFile(
    join(typeboxDirectory, "index.js"),
    `export const Type = new Proxy({}, { get(_target, key) { return (...args) => ({ kind: String(key), args }); } });\n`,
    "utf8",
  );

  const agentDirectory = join(workspace, "node_modules", "@earendil-works", "pi-coding-agent");
  await mkdir(agentDirectory, { recursive: true });
  await writeJSON(join(agentDirectory, "package.json"), {
    name: "@earendil-works/pi-coding-agent",
    type: "module",
    exports: "./index.js",
  });
  await writeFile(join(agentDirectory, "index.js"), "export {};\n", "utf8");
}

function mockResponse(body, options = {}) {
  const response = new Response(body, {
    status: options.status ?? 200,
    statusText: options.statusText ?? "",
    headers: options.headers ?? {},
  });
  const hasBodyOverride = Object.prototype.hasOwnProperty.call(options, "body");
  return {
    get ok() { return response.ok; },
    get status() { return response.status; },
    get statusText() { return response.statusText; },
    get headers() { return response.headers; },
    get body() { return hasBodyOverride ? options.body : response.body; },
    get url() { return options.url ?? "https://fixture.invalid/final"; },
    text: () => response.text(),
    json: () => response.json(),
    arrayBuffer: options.arrayBuffer ?? (() => response.arrayBuffer()),
  };
}

function chunkedBody(chunks, state = {}) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      state.pulls = (state.pulls ?? 0) + 1;
      if (index >= chunks.length) {
        state.closed = true;
        controller.close();
        return;
      }
      state.chunks = (state.chunks ?? 0) + 1;
      controller.enqueue(chunks[index++]);
    },
    cancel(reason) {
      state.cancelled = true;
      state.cancelReason = reason;
    },
  }, { highWaterMark: 0 });
}

let fetchResponder = async (url) => {
  throw new Error(`unexpected network request: ${url}`);
};
const fetchCalls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
  fetchCalls.push({ url, init, at: Date.now() });
  return fetchResponder(url, init);
};

class FakeChild extends EventEmitter {
  constructor(plan, call) {
    super();
    this.plan = plan;
    this.call = call;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdinInput = "";
    this.stdinReady = Promise.resolve();
    this.killSignals = [];
    this.closed = false;
    this.stdin = {
      end: (input) => {
        this.stdinInput += input === undefined ? "" : String(input);
        try {
          this.stdinReady = Promise.resolve(plan.onStdin?.(this.stdinInput, this.call, this));
        } catch (error) {
          this.stdinReady = Promise.reject(error);
        }
      },
    };
  }

  emitClose(code) {
    if (this.closed) return;
    this.closed = true;
    this.emit("close", code);
  }

  emitPlanOutput() {
    if (this.closed) return;
    if (this.plan.stdout !== undefined) {
      this.stdout.emit("data", Buffer.from(String(this.plan.stdout)));
    }
    if (this.plan.stderr !== undefined) {
      this.stderr.emit("data", Buffer.from(String(this.plan.stderr)));
    }
    this.emitClose(this.plan.code ?? 0);
  }

  kill(signal) {
    this.killSignals.push(signal);
    try {
      this.plan.onKill?.(signal, this.call, this);
    } catch (error) {
      queueMicrotask(() => this.emit("error", error));
    }
    if (this.plan.closeOnKill !== false) {
      queueMicrotask(() => this.emitClose(this.plan.killCode ?? null));
    }
    return true;
  }
}

const spawnPlans = [];
const spawnCalls = [];
const unsafeGitCloneEnvironmentNames = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
]);
globalThis.__pipiuiSpecialistToolSpawn = (command, args = [], options = {}) => {
  const plan = spawnPlans.shift();
  assert.ok(plan, `unexpected spawn: ${command} ${args.join(" ")}`);
  const call = { command, args: [...args], options, child: undefined };
  const child = new FakeChild(plan, call);
  call.child = child;
  spawnCalls.push(call);
  queueMicrotask(async () => {
    try {
      await plan.setup?.(call);
      await child.stdinReady;
      if (!plan.hang) child.emitPlanOutput();
    } catch (error) {
      child.emit("error", error);
    }
  });
  return child;
};

function planSpawn(...plans) {
  spawnPlans.push(...plans);
}

function resetRuntime() {
  fetchCalls.length = 0;
  spawnCalls.length = 0;
  spawnPlans.length = 0;
  fetchResponder = async (url) => {
    throw new Error(`unexpected network request: ${url}`);
  };
  fastTimerCount = 0;
  delete process.env.PIPIUI_PDF_HELPER;
  for (const name of Object.keys(process.env)) {
    if (
      unsafeGitCloneEnvironmentNames.has(name)
      || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name)
      || name.startsWith("GIT_HTTP_")
    ) {
      delete process.env[name];
    }
  }
}

function textOf(result) {
  assert.ok(result && Array.isArray(result.content), "tool must return text content");
  return result.content.map((part) => part.text ?? "").join("");
}

function expectError(result, expression) {
  assert.equal(result.isError, true, `expected error result, got: ${textOf(result)}`);
  assert.match(textOf(result), expression);
}

async function assertNoTemporaryDirectories(prefix) {
  const names = await readdir(temporaryDirectory);
  assert.deepEqual(
    names.filter((name) => name.startsWith(prefix)),
    [],
    `temporary ${prefix} directories must be removed`,
  );
}

async function makeExecutableHelper(name = "fixture-pdf-helper") {
  const helper = join(workspace, name);
  await writeFile(helper, "fixture helper", "utf8");
  await chmod(helper, 0o755);
  return helper;
}

function helperSuccess(markdown = "fixture PDF markdown") {
  return JSON.stringify({
    ok: true,
    markdown,
    metadata: {
      pageCount: 3,
      selectedPages: [1, 3],
      textPages: [1],
      ocrPages: [3],
      warnings: ["fixture warning"],
      truncated: false,
    },
  });
}

function arxivAtom({ requested, resolved = requested, title = "Fixture &amp; Paper", summary = "Abstract &lt; with entity", authors = ["Ada Lovelace"], category = "cs.AI" }) {
  return `<?xml version="1.0"?>
<feed><entry>
  <id>http://arxiv.org/abs/${resolved}</id>
  <title>${title}</title>
  ${authors.map((author) => `<author><name>${author}</name></author>`).join("")}
  <summary>${summary}</summary>
  <category term="${category}" />
  <arxiv:primary_category term="${category}" />
  <published>2025-01-01T00:00:00Z</published>
  <updated>2025-01-02T00:00:00Z</updated>
  <arxiv:doi>10.1000/fixture</arxiv:doi>
  <link href="https://arxiv.org/abs/${resolved}" />
</entry></feed>`;
}

function arxivHTML(label) {
  return `<html><head><title>${label}</title></head><body><main><h1>${label}</h1><p>${
    "Readable arXiv fixture prose with mathematical context and implementation details. ".repeat(6)
  }</p></main></body></html>`;
}

async function main() {
  await installStubModules();

  const registered = [];
  const pi = {
    registerTool(tool) {
      registered.push(tool);
    },
  };

  async function loadExtension(path) {
    const module = await import(`${pathToFileURL(path).href}?specialist-runtime`);
    assert.equal(typeof module.default, "function", `${path} must default-export an extension factory`);
    await module.default(pi);
  }

  async function loadPackage(path) {
    const manifest = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    const entries = manifest?.pi?.extensions;
    assert.ok(Array.isArray(entries) && entries.length > 0, `${path} must declare Pi extension entries`);
    for (const entry of entries) await loadExtension(join(path, entry));
  }

  await loadExtension(join(extensionsDirectory, "pipiui-websearch.ts"));
  await loadExtension(join(extensionsDirectory, "pipiui-pdf-extract.ts"));
  await loadPackage(join(packagesDirectory, "github-fetch"));
  await loadPackage(join(packagesDirectory, "arxiv-fetch"));

  const tools = new Map(registered.map((tool) => [tool.name, tool]));
  async function execute(name, params, context = {}) {
    const tool = tools.get(name);
    assert.ok(tool, `tool ${name} was not registered`);
    return tool.execute("specialist-runtime-test", params, undefined, undefined, context);
  }

  const completed = [];
  async function scenario(name, operation) {
    resetRuntime();
    await operation();
    assert.equal(spawnPlans.length, 0, `${name} left an unused spawn plan`);
    completed.push(name);
  }

  await scenario("registration uniqueness and recoverable specialist routing", async () => {
    const names = registered.map((tool) => tool.name);
    assert.deepEqual([...names].sort(), ["arxiv_fetch", "github_fetch", "pdf_extract", "web_fetch", "web_search"]);
    assert.equal(new Set(names).size, names.length, "all loaded extensions must register unique tool names");
    assert.equal(names.filter((name) => name === "web_fetch").length, 1);

    const githubIssue = await execute("github_fetch", { url: "https://github.com/acme/repo/issues/1" });
    expectError(githubIssue, /Use web_fetch/);
    const nonArxiv = await execute("arxiv_fetch", { url: "https://example.test/not-a-paper" });
    expectError(nonArxiv, /unsupported URL: use web_fetch/);
    assert.equal(fetchCalls.length, 0);
    assert.equal(spawnCalls.length, 0);
  });

  await scenario("web_fetch HTML RSC text JSON limits and HTTP boundaries", async () => {
    fetchResponder = async (url) => {
      if (url === "https://example.test/article") {
        return mockResponse(
          "<html><head><title>Fixture Article</title></head><body><nav>hidden chrome</nav><article><h1>Headline</h1><p>Useful &amp; readable prose.</p><ul><li>first</li><li>second</li></ul></article></body></html>",
          { headers: { "content-type": "text/html" } },
        );
      }
      if (url === "https://example.test/rsc") {
        return mockResponse(
          "<html><head><title>RSC Fixture</title></head><body><script>self.__next_f.push([1,\"RSC fallback prose survives server component payload extraction.\"]);</script></body></html>",
          { headers: { "content-type": "text/html" } },
        );
      }
      if (url === "https://example.test/plain") {
        return mockResponse("plain text fixture", { headers: { "content-type": "text/plain" } });
      }
      if (url === "https://example.test/data.json") {
        return mockResponse('{"answer":42}', { headers: { "content-type": "application/json" } });
      }
      if (url === "https://example.test/long") {
        return mockResponse("x".repeat(1_400), { headers: { "content-type": "text/plain" } });
      }
      if (url === "https://example.test/oversize") {
        return mockResponse("not read", {
          headers: {
            "content-type": "text/plain",
            "content-length": String(5 * 1024 * 1024 + 1),
          },
        });
      }
      throw new Error(`unexpected web_fetch URL ${url}`);
    };

    const html = textOf(await execute("web_fetch", { url: "https://example.test/article" }));
    assert.match(html, /# Fixture Article/);
    assert.match(html, /# Headline/);
    assert.match(html, /Useful & readable prose\./);
    assert.match(html, /- first/);
    assert.doesNotMatch(html, /hidden chrome/);

    const rsc = textOf(await execute("web_fetch", { url: "https://example.test/rsc" }));
    assert.match(rsc, /RSC fallback prose survives/);
    assert.doesNotMatch(rsc, /self\.__next_f/);

    assert.equal(textOf(await execute("web_fetch", { url: "https://example.test/plain" })), "plain text fixture");
    assert.equal(textOf(await execute("web_fetch", { url: "https://example.test/data.json" })), '{"answer":42}');

    const limited = textOf(await execute("web_fetch", {
      url: "https://example.test/long",
      max_length: 1_000,
    }));
    assert.match(limited, /\[truncated\]$/);
    assert.ok(limited.length <= 1_020, `web_fetch limit was not applied: ${limited.length}`);

    const fetchCount = fetchCalls.length;
    expectError(await execute("web_fetch", { url: "file:///private/fixture.html" }), /absolute HTTP\(S\)/);
    assert.equal(fetchCalls.length, fetchCount, "invalid schemes must not be fetched");
    expectError(await execute("web_fetch", { url: "https://example.test/oversize" }), /response exceeds/);
  });

  await scenario("web_search force and parameter compatibility", async () => {
    const search = tools.get("web_search");
    const schema = search.parameters;
    const properties = schema.args[0];
    assert.ok(properties.query && properties.max_results && properties.force, "web_search parameter shape changed");

    const skipped = await execute(
      "web_search",
      { query: "native search should skip" },
      { model: { provider: "openai-codex", id: "fixture" } },
    );
    expectError(skipped, /skipped/);
    assert.equal(fetchCalls.length, 0);

    fetchResponder = async (url, init) => {
      assert.equal(url, "https://api.firecrawl.dev/v2/search");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), { query: "swift XCTest", limit: 3 });
      return mockResponse(JSON.stringify({
        success: true,
        data: { web: [{ title: "Fixture result", url: "https://fixture.test", description: "A snippet" }] },
      }), { headers: { "content-type": "application/json" } });
    };
    const result = textOf(await execute(
      "web_search",
      { query: "swift XCTest", max_results: 3, force: true },
      { model: { provider: "openai-codex", id: "fixture" } },
    ));
    assert.match(result, /Fixture result/);
    assert.match(result, /https:\/\/fixture\.test/);
  });

  await scenario("github Contents API base64 and bounded fallback", async () => {
    process.env.GH_TOKEN = "fixture-token";
    fetchResponder = async (url, init) => {
      assert.match(url, /^https:\/\/api\.github\.com\/repos\/acme\/repo\/contents\/README\.md\?ref=main$/);
      assert.equal(init.headers.Authorization, "Bearer fixture-token");
      return mockResponse(JSON.stringify({
        type: "file",
        encoding: "base64",
        content: Buffer.from("# Fixture README\nbase64 body", "utf8").toString("base64"),
      }), { headers: { "content-type": "application/json" } });
    };
    const blob = textOf(await execute("github_fetch", {
      url: "https://github.com/acme/repo/blob/main/README.md",
    }));
    assert.match(blob, /GitHub file: acme\/repo/);
    assert.match(blob, /# Fixture README/);
    assert.match(blob, /base64 body/);
    assert.equal(spawnCalls.length, 0);

    fetchCalls.length = 0;
    fetchResponder = async (url) => {
      if (url.startsWith("https://api.github.com/")) {
        return mockResponse("rate limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
      }
      assert.equal(url, "https://github.com/acme/repo/blob/main/README.md");
      return mockResponse("<html><title>Fallback</title><main>Fallback GitHub page text.</main></html>", {
        headers: { "content-type": "text/html" },
      });
    };
    const fallback = textOf(await execute("github_fetch", {
      url: "https://github.com/acme/repo/blob/main/README.md",
    }));
    assert.match(fallback, /Fallback GitHub page text/);
    assert.equal(fetchCalls.length, 2, "specialized failure must use one generic fallback");
  });

  await scenario("github clone arguments jail timeout and cleanup", async () => {
    const inheritedPath = process.env.PATH;
    const inheritedHome = process.env.HOME;
    Object.assign(process.env, {
      GH_TOKEN: "clone-token-must-not-reach-git",
      GITHUB_TOKEN: "clone-github-token-must-not-reach-git",
      GIT_ASKPASS: join(workspace, "malicious-git-askpass"),
      SSH_ASKPASS: join(workspace, "malicious-ssh-askpass"),
      GIT_SSH: join(workspace, "malicious-git-ssh"),
      GIT_SSH_COMMAND: "malicious-git-ssh-command",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "!malicious-credential-helper",
      GIT_CONFIG_KEY_1: "http.extraHeader",
      GIT_CONFIG_VALUE_1: "Authorization: Bearer leaked",
      GIT_CONFIG_PARAMETERS: "credential.helper=!malicious-credential-helper",
      GIT_CONFIG_SYSTEM: join(workspace, "malicious-system-gitconfig"),
      GIT_CONFIG_GLOBAL: join(workspace, "malicious-global-gitconfig"),
      GIT_CONFIG_NOSYSTEM: "0",
      GIT_HTTP_PROXY: "http://malicious-proxy.invalid:8080",
      GIT_HTTP_EXTRAHEADER: "Authorization: Bearer leaked",
    });
    const forbiddenGitEnvironmentNames = [
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "GIT_ASKPASS",
      "SSH_ASKPASS",
      "GIT_SSH",
      "GIT_SSH_COMMAND",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
      "GIT_CONFIG_KEY_1",
      "GIT_CONFIG_VALUE_1",
      "GIT_CONFIG_PARAMETERS",
      "GIT_CONFIG_SYSTEM",
    ];
    let checkout;
    planSpawn({
      async setup(call) {
        assert.equal(call.command, "git");
        assert.deepEqual(call.args.slice(0, 4), ["clone", "--depth", "1", "--single-branch"]);
        assert.equal(call.args.at(-2), "https://github.com/acme/repo.git");
        checkout = call.args.at(-1);
        assert.equal(call.options.shell, false);
        assert.deepEqual(call.options.stdio, ["ignore", "ignore", "pipe"]);
        assert.equal(call.options.env.PATH, inheritedPath, "git must retain PATH");
        assert.equal(call.options.env.HOME, inheritedHome, "git must retain HOME");
        for (const name of forbiddenGitEnvironmentNames) {
          assert.equal(Object.prototype.hasOwnProperty.call(call.options.env, name), false,
            `git clone must not inherit ${name}`);
        }
        assert.equal(Object.keys(call.options.env).some((name) => name.startsWith("GIT_HTTP_")), false,
          "git clone must not inherit GIT_HTTP_* overrides");
        assert.equal(call.options.env.GIT_TERMINAL_PROMPT, "0");
        assert.equal(call.options.env.GCM_INTERACTIVE, "Never");
        assert.equal(call.options.env.GIT_CONFIG_NOSYSTEM, "1");
        assert.equal(call.options.env.GIT_CONFIG_GLOBAL, "/dev/null");
        await mkdir(join(checkout, "src"), { recursive: true });
        await writeFile(join(checkout, "README.md"), "# Clone fixture\nNo repository code runs.", "utf8");
        await writeFile(join(checkout, "package.json"), '{"scripts":{"postinstall":"exit 99"}}', "utf8");
      },
    });
    const cloned = textOf(await execute("github_fetch", { url: "https://github.com/acme/repo" }));
    assert.match(cloned, /Clone fixture/);
    assert.ok(checkout);
    assert.equal(existsSync(checkout), false, "throwaway clone must be removed after collection");
    assert.deepEqual(spawnCalls.map((call) => call.command), ["git"], "repository code must never execute");
    await assertNoTemporaryDirectories("pipiui-github-");

    const secret = join(workspace, "path-jail-secret.txt");
    await writeFile(secret, "PATH JAIL SECRET", "utf8");
    fetchResponder = async (url) => {
      assert.equal(url, "https://github.com/acme/repo/tree/main/escape");
      return mockResponse("<main>Safe generic fallback after jailed clone.</main>", {
        headers: { "content-type": "text/html" },
      });
    };
    // Git tries the longest ambiguous ref first. Make that branch absent, then
    // make the legitimate `main` candidate contain an escape symlink. Both
    // candidates must fail before the one generic fallback is allowed.
    planSpawn(
      { code: 1, stderr: "ambiguous ref clone fails" },
      {
        async setup(call) {
          const directory = call.args.at(-1);
          await mkdir(directory, { recursive: true });
          await symlink(secret, join(directory, "escape"));
        },
      },
    );
    const jailed = textOf(await execute("github_fetch", {
      url: "https://github.com/acme/repo/tree/main/escape",
    }));
    assert.match(jailed, /Safe generic fallback/);
    assert.doesNotMatch(jailed, /PATH JAIL SECRET/);
    await assertNoTemporaryDirectories("pipiui-github-");

    fetchCalls.length = 0;
    fetchResponder = async (url) => {
      assert.equal(url, "https://github.com/acme/repo");
      return mockResponse("<main>Timed clone fallback.</main>", { headers: { "content-type": "text/html" } });
    };
    armFastTimers(2);
    planSpawn({ hang: true });
    const timedOut = textOf(await execute("github_fetch", { url: "https://github.com/acme/repo" }));
    assert.match(timedOut, /Timed clone fallback/);
    assert.ok(spawnCalls.at(-1).child.killSignals.includes("SIGTERM"), "clone timeout must terminate git");
    await assertNoTemporaryDirectories("pipiui-github-");
  });

  await scenario("arxiv IDs metadata HTML fallbacks PDF helper and throttle", async () => {
    await withAcceleratedArxivClock(async () => {
      fetchResponder = async (url) => {
        if (url.startsWith("https://export.arxiv.org/api/query?id_list=")) {
          const requested = new URL(url).searchParams.get("id_list");
          if (requested === "2401.12345v2") {
            return mockResponse(arxivAtom({
              requested,
              resolved: "2401.12345v2",
              title: "New &amp; Versioned",
              summary: "New summary &lt; entity",
            }), { headers: { "content-type": "application/atom+xml" } });
          }
          if (requested === "hep-th/9901001v3") {
            return mockResponse(arxivAtom({
              requested,
              resolved: "hep-th/9901001v3",
              title: "Legacy &amp; Versioned",
            }), { headers: { "content-type": "application/atom+xml" } });
          }
        }
        if (url === "https://arxiv.org/html/2401.12345v2") {
          return mockResponse(arxivHTML("Official HTML fixture"), { headers: { "content-type": "text/html" } });
        }
        if (url === "https://arxiv.org/html/hep-th%2F9901001v3") {
          return mockResponse(arxivHTML("Legacy official HTML fixture"), { headers: { "content-type": "text/html" } });
        }
        throw new Error(`unexpected arXiv request ${url}`);
      };

      const modern = textOf(await execute("arxiv_fetch", { url: "https://arxiv.org/abs/2401.12345v2" }));
      assert.match(modern, /# New & Versioned/);
      assert.match(modern, /requested_version: 2401\.12345v2/);
      assert.match(modern, /resolved_version: 2401\.12345v2/);
      assert.match(modern, /New summary < entity/);
      assert.match(modern, /content_source: arxiv-html/);

      const legacy = textOf(await execute("arxiv_fetch", { url: "https://arxiv.org/abs/hep-th/9901001v3" }));
      assert.match(legacy, /# Legacy & Versioned/);
      assert.match(legacy, /requested_version: hep-th\/9901001v3/);
      assert.match(legacy, /resolved_version: hep-th\/9901001v3/);
      assert.match(legacy, /content_source: arxiv-html/);

      const atomCalls = fetchCalls.filter((call) => call.url.startsWith("https://export.arxiv.org/api/query"));
      assert.equal(atomCalls.length, 2);
      assert.ok(atomCalls[1].at - atomCalls[0].at >= 3_000, "Atom requests must obey the shared throttle");

      fetchResponder = async (url) => {
        if (url.startsWith("https://export.arxiv.org/api/query")) {
          return mockResponse(arxivAtom({ requested: "2501.12345", resolved: "2501.12345" }), {
            headers: { "content-type": "application/atom+xml" },
          });
        }
        if (url === "https://arxiv.org/html/2501.12345") return mockResponse("offline", { status: 503 });
        if (url === "https://ar5iv.labs.arxiv.org/html/2501.12345") {
          return mockResponse(arxivHTML("ar5iv fallback fixture"), { headers: { "content-type": "text/html" } });
        }
        throw new Error(`unexpected ar5iv request ${url}`);
      };
      const ar5iv = textOf(await execute("arxiv_fetch", { url: "https://arxiv.org/html/2501.12345" }));
      assert.match(ar5iv, /content_source: ar5iv/);
      assert.match(ar5iv, /ar5iv does not guarantee the requested version/);

      fetchResponder = async (url) => {
        if (url.startsWith("https://export.arxiv.org/api/query")) {
          return mockResponse(arxivAtom({ requested: "2502.12345", resolved: "2502.12345" }), {
            headers: { "content-type": "application/atom+xml" },
          });
        }
        if (url === "https://arxiv.org/html/2502.12345" || url === "https://ar5iv.labs.arxiv.org/html/2502.12345") {
          return mockResponse("unavailable", { status: 503 });
        }
        throw new Error(`unexpected abstract-only request ${url}`);
      };
      const abstractOnly = textOf(await execute("arxiv_fetch", { url: "https://arxiv.org/abs/2502.12345" }));
      assert.match(abstractOnly, /content_source: abstract-only/);
      assert.match(abstractOnly, /## Abstract/);

      // Advance the observable clock after Atom metadata: the shared 30s
      // deadline must prevent official HTML/ar5iv/PDF follow-ups, not reset
      // a fresh per-route budget.
      fetchCalls.length = 0;
      fetchResponder = async (url) => {
        if (url.startsWith("https://export.arxiv.org/api/query")) {
          logicalNow += 30_001;
          return mockResponse(arxivAtom({ requested: "2502.54321", resolved: "2502.54321" }), {
            headers: { "content-type": "application/atom+xml" },
          });
        }
        throw new Error(`shared budget must prevent follow-up request ${url}`);
      };
      const exhaustedBudget = textOf(await execute("arxiv_fetch", { url: "https://arxiv.org/abs/2502.54321" }));
      assert.match(exhaustedBudget, /content_source: abstract-only/);
      assert.equal(fetchCalls.length, 1, "arXiv routes must share one elapsed budget");

      const helper = await makeExecutableHelper("arxiv-helper");
      process.env.PIPIUI_PDF_HELPER = helper;
      let arxivPDFPayload;
      let arxivPDFStream;
      fetchResponder = async (url) => {
        if (url.startsWith("https://export.arxiv.org/api/query")) {
          return mockResponse(arxivAtom({ requested: "2503.12345v1", resolved: "2503.12345v1" }), {
            headers: { "content-type": "application/atom+xml" },
          });
        }
        if (url === "https://arxiv.org/pdf/2503.12345v1") {
          const body = Buffer.from("%PDF-1.7\\nfixture arXiv PDF", "utf8");
          arxivPDFStream = {};
          return mockResponse(null, {
            body: chunkedBody([body.subarray(0, 2), body.subarray(2)], arxivPDFStream),
            url: "https://arxiv.org/pdf/2503.12345v1",
            headers: { "content-type": "application/pdf" },
            arrayBuffer: async () => { throw new Error("streaming PDF path must not call arrayBuffer"); },
          });
        }
        throw new Error(`unexpected PDF request ${url}`);
      };
      planSpawn({
        async onStdin(input, call) {
          assert.equal(call.command, helper);
          assert.equal(call.options.shell, false);
          arxivPDFPayload = JSON.parse(input);
          assert.equal((await readFile(arxivPDFPayload.path)).subarray(0, 5).toString(), "%PDF-");
        },
        stdout: helperSuccess("arXiv helper markdown"),
      });
      const pdf = textOf(await execute("arxiv_fetch", { url: "https://arxiv.org/pdf/2503.12345v1" }));
      assert.match(pdf, /content_source: pdfkit/);
      assert.match(pdf, /arXiv helper markdown/);
      assert.equal(existsSync(dirname(arxivPDFPayload.path)), false, "arXiv PDF temp directory must be removed");
      assert.equal(arxivPDFStream.closed, true, "normal arXiv PDF stream must be read through completion");
      assert.match(pdf, /requested_version: 2503\.12345v1/);

      let bodylessArrayBufferCalls = 0;
      let bodylessPDFPayload;
      fetchResponder = async (url) => {
        if (url.startsWith("https://export.arxiv.org/api/query")) {
          return mockResponse(arxivAtom({ requested: "2503.12346", resolved: "2503.12346" }), {
            headers: { "content-type": "application/atom+xml" },
          });
        }
        if (url === "https://arxiv.org/pdf/2503.12346") {
          const body = Buffer.from("%PDF-1.7\\nbodyless fallback PDF", "utf8");
          return mockResponse(null, {
            body: null,
            url: "https://arxiv.org/pdf/2503.12346",
            headers: { "content-type": "application/pdf", "content-length": String(body.length) },
            arrayBuffer: async () => {
              bodylessArrayBufferCalls += 1;
              return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
            },
          });
        }
        throw new Error(`unexpected bodyless PDF request ${url}`);
      };
      planSpawn({
        async onStdin(input) {
          bodylessPDFPayload = JSON.parse(input);
          assert.equal((await readFile(bodylessPDFPayload.path)).subarray(0, 5).toString(), "%PDF-");
        },
        stdout: helperSuccess("bodyless fallback helper markdown"),
      });
      const bodylessPDF = textOf(await execute("arxiv_fetch", { url: "https://arxiv.org/pdf/2503.12346" }));
      assert.match(bodylessPDF, /content_source: pdfkit/);
      assert.match(bodylessPDF, /bodyless fallback helper markdown/);
      assert.equal(bodylessArrayBufferCalls, 1, "bounded no-body fallback must use the response reader fallback once");
      assert.equal(existsSync(dirname(bodylessPDFPayload.path)), false, "bodyless PDF temp directory must be removed");

      let unboundedFallbackRead = false;
      fetchResponder = async (url) => {
        if (url.startsWith("https://export.arxiv.org/api/query")) {
          return mockResponse(arxivAtom({ requested: "2503.12347", resolved: "2503.12347" }), {
            headers: { "content-type": "application/atom+xml" },
          });
        }
        if (url === "https://arxiv.org/pdf/2503.12347") {
          return mockResponse(null, {
            body: null,
            url: "https://arxiv.org/pdf/2503.12347",
            headers: { "content-type": "application/pdf" },
            arrayBuffer: async () => {
              unboundedFallbackRead = true;
              return Buffer.from("%PDF-1.7\\nshould not be read");
            },
          });
        }
        if (url === "https://arxiv.org/html/2503.12347" || url === "https://ar5iv.labs.arxiv.org/html/2503.12347") {
          return mockResponse("unavailable", { status: 503 });
        }
        throw new Error(`unexpected unbounded PDF request ${url}`);
      };
      const unboundedFallback = textOf(await execute("arxiv_fetch", { url: "https://arxiv.org/pdf/2503.12347" }));
      assert.match(unboundedFallback, /PDF unavailable: PDF response body is unavailable without a bounded content-length/);
      assert.match(unboundedFallback, /content_source: abstract-only/);
      assert.equal(unboundedFallbackRead, false, "unbounded no-body fallback must not aggregate arrayBuffer");
      await assertNoTemporaryDirectories("pipiui-arxiv-");

      const oversizedPDFStream = {};
      const oversizedChunk = new Uint8Array(50 * 1024 * 1024);
      oversizedChunk.set(Buffer.from("%PDF-1.7\\n"));
      fetchResponder = async (url) => {
        if (url.startsWith("https://export.arxiv.org/api/query")) {
          return mockResponse(arxivAtom({ requested: "2503.12348", resolved: "2503.12348" }), {
            headers: { "content-type": "application/atom+xml" },
          });
        }
        if (url === "https://arxiv.org/pdf/2503.12348") {
          return mockResponse(null, {
            body: chunkedBody([Buffer.from("%PDF-1.7\\n"), oversizedChunk, Buffer.from("must remain unread")], oversizedPDFStream),
            url: "https://arxiv.org/pdf/2503.12348",
            headers: { "content-type": "application/pdf" },
            arrayBuffer: async () => { throw new Error("chunked PDF must not call arrayBuffer"); },
          });
        }
        if (url === "https://arxiv.org/html/2503.12348" || url === "https://ar5iv.labs.arxiv.org/html/2503.12348") {
          return mockResponse("unavailable", { status: 503 });
        }
        throw new Error(`unexpected oversized PDF request ${url}`);
      };
      const spawnCountBeforeOversize = spawnCalls.length;
      const oversizedPDF = textOf(await execute("arxiv_fetch", { url: "https://arxiv.org/pdf/2503.12348" }));
      assert.match(oversizedPDF, /PDF unavailable: PDF exceeds 50 MB cap/);
      assert.match(oversizedPDF, /content_source: abstract-only/);
      assert.equal(oversizedPDFStream.chunks, 2, "stream must stop before reading the chunk after the cap breach");
      assert.equal(oversizedPDFStream.cancelled, true, "oversized stream must be cancelled");
      assert.equal(spawnCalls.length, spawnCountBeforeOversize, "oversized PDF must not reach the helper");
      await assertNoTemporaryDirectories("pipiui-arxiv-");

      for (const { id, finalURL, expectedError } of [
        { id: "2503.12349", finalURL: "http://arxiv.org/pdf/2503.12349", expectedError: /final PDF URL must remain HTTPS/ },
        { id: "2503.12350", finalURL: "https://redirect.invalid/pdf/2503.12350", expectedError: /final PDF URL host is not official arXiv/ },
        { id: "2503.12351", finalURL: "https://arxiv.org/abs/2503.12351", expectedError: /final PDF URL is not the requested official PDF/ },
      ]) {
        fetchResponder = async (url) => {
          if (url.startsWith("https://export.arxiv.org/api/query")) {
            assert.equal(new URL(url).searchParams.get("id_list"), id);
            return mockResponse(arxivAtom({ requested: id, resolved: id }), {
              headers: { "content-type": "application/atom+xml" },
            });
          }
          if (url === `https://arxiv.org/pdf/${id}`) {
            return mockResponse("%PDF-1.7\\nredirected fixture", {
              url: finalURL,
              headers: { "content-type": "application/pdf" },
            });
          }
          if (url === `https://arxiv.org/html/${id}` || url === `https://ar5iv.labs.arxiv.org/html/${id}`) {
            return mockResponse("unavailable", { status: 503 });
          }
          throw new Error(`unexpected redirect PDF request ${url}`);
        };
        const spawnCountBeforeRedirect = spawnCalls.length;
        const rejectedRedirect = textOf(await execute("arxiv_fetch", { url: `https://arxiv.org/pdf/${id}` }));
        assert.match(rejectedRedirect, expectedError);
        assert.match(rejectedRedirect, /content_source: abstract-only/);
        assert.equal(spawnCalls.length, spawnCountBeforeRedirect, "invalid final PDF redirect must not reach the helper");
        await assertNoTemporaryDirectories("pipiui-arxiv-");
      }

      delete process.env.PIPIUI_PDF_HELPER;
      fetchResponder = async (url) => {
        if (url.startsWith("https://export.arxiv.org/api/query")) {
          return mockResponse(arxivAtom({ requested: "2504.12345", resolved: "2504.12345" }), {
            headers: { "content-type": "application/atom+xml" },
          });
        }
        if (url === "https://arxiv.org/html/2504.12345" || url === "https://ar5iv.labs.arxiv.org/html/2504.12345") {
          return mockResponse("unavailable", { status: 503 });
        }
        throw new Error(`helper-missing must not fetch ${url}`);
      };
      const missingHelper = textOf(await execute("arxiv_fetch", { url: "https://arxiv.org/pdf/2504.12345" }));
      assert.match(missingHelper, /PDF unavailable: local PDF helper unavailable/);
      assert.match(missingHelper, /content_source: abstract-only/);

      process.env.PIPIUI_PDF_HELPER = helper;
      fetchResponder = async (url) => {
        if (url.startsWith("https://export.arxiv.org/api/query")) {
          return mockResponse(arxivAtom({ requested: "2505.12345", resolved: "2505.12345" }), {
            headers: { "content-type": "application/atom+xml" },
          });
        }
        if (url === "https://arxiv.org/pdf/2505.12345") {
          const body = Buffer.from("%PDF-1.7\\nfailed helper PDF", "utf8");
          return mockResponse(body, {
            url: "https://arxiv.org/pdf/2505.12345",
            headers: { "content-type": "application/pdf", "content-length": String(body.length) },
          });
        }
        if (url === "https://arxiv.org/html/2505.12345" || url === "https://ar5iv.labs.arxiv.org/html/2505.12345") {
          return mockResponse("unavailable", { status: 503 });
        }
        throw new Error(`unexpected helper-failure request ${url}`);
      };
      planSpawn({
        stdout: JSON.stringify({ ok: false, error: { message: "fixture helper failed" } }),
        code: 1,
      });
      const failedHelper = textOf(await execute("arxiv_fetch", { url: "https://arxiv.org/pdf/2505.12345" }));
      assert.match(failedHelper, /PDF unavailable: fixture helper failed/);
      assert.match(failedHelper, /content_source: abstract-only/);
      await assertNoTemporaryDirectories("pipiui-arxiv-");

      fetchCalls.length = 0;
      expectError(await execute("arxiv_fetch", { url: "https://arxiv.org/e-print/2506.12345" }), /source archives are not fetched/);
      assert.equal(fetchCalls.length, 0, "source archives must be rejected before networking");
    });
  });

  await scenario("pdf_extract local URL helpers validation limits and cleanup", async () => {
    const helper = await makeExecutableHelper("pdf-extract-helper");
    process.env.PIPIUI_PDF_HELPER = helper;
    const localPDF = join(workspace, "local.pdf");
    await writeFile(localPDF, "%PDF-1.7\nlocal fixture", "utf8");

    let localPayload;
    planSpawn({
      onStdin(input, call) {
        assert.equal(call.command, helper);
        assert.deepEqual(call.args, []);
        assert.equal(call.options.shell, false);
        assert.deepEqual(call.options.stdio, ["pipe", "pipe", "pipe"]);
        localPayload = JSON.parse(input);
      },
      stdout: helperSuccess("local helper markdown"),
    });
    const localResult = await execute("pdf_extract", {
      source: localPDF,
      mode: "ocr",
      pages: [3, 1, 3],
      max_length: 17,
    });
    assert.equal(textOf(localResult), "local helper markdown");
    assert.deepEqual(localPayload, {
      path: await realpath(localPDF),
      mode: "ocr",
      pages: [1, 3],
      max_length: 17,
    });
    assert.equal(localResult.details.pageCount, 3);

    let downloadedPayload;
    fetchResponder = async (url) => {
      assert.equal(url, "https://pdf.fixture/paper.pdf");
      const body = Buffer.from("%PDF-1.7\\ndownloaded fixture", "utf8");
      return mockResponse(body, {
        headers: { "content-type": "application/pdf", "content-length": String(body.length) },
        url,
      });
    };
    planSpawn({
      async onStdin(input) {
        downloadedPayload = JSON.parse(input);
        assert.equal((await readFile(downloadedPayload.path)).subarray(0, 5).toString(), "%PDF-");
      },
      stdout: helperSuccess("downloaded helper markdown"),
    });
    const downloaded = textOf(await execute("pdf_extract", { source: "https://pdf.fixture/paper.pdf" }));
    assert.equal(downloaded, "downloaded helper markdown");
    assert.equal(existsSync(dirname(downloadedPayload.path)), false, "download temp directory must be removed");

    fetchResponder = async (url) => {
      assert.equal(url, "https://pdf.fixture/not-pdf");
      return mockResponse("not a PDF", {
        headers: { "content-type": "application/pdf", "content-length": "9" },
        url,
      });
    };
    expectError(await execute("pdf_extract", { source: "https://pdf.fixture/not-pdf" }), /%PDF-/);
    await assertNoTemporaryDirectories("pipiui-pdf-");

    fetchResponder = async (url) => {
      assert.equal(url, "https://pdf.fixture/too-large");
      return mockResponse("ignored", {
        headers: {
          "content-type": "application/pdf",
          "content-length": String(50 * 1024 * 1024 + 1),
        },
        url,
      });
    };
    expectError(await execute("pdf_extract", { source: "https://pdf.fixture/too-large" }), /50 MB limit/);
    await assertNoTemporaryDirectories("pipiui-pdf-");

    delete process.env.PIPIUI_PDF_HELPER;
    expectError(await execute("pdf_extract", { source: localPDF }), /PIPIUI_PDF_HELPER is not set/);

    process.env.PIPIUI_PDF_HELPER = helper;
    planSpawn({
      stdout: JSON.stringify({ ok: false, error: { message: "fixture helper failed" } }),
      code: 1,
    });
    expectError(await execute("pdf_extract", { source: localPDF }), /fixture helper failed/);

    planSpawn({ stdout: "not JSON", code: 0 });
    expectError(await execute("pdf_extract", { source: localPDF }), /invalid JSON/);
    assert.deepEqual(spawnCalls.map((call) => call.command), [helper, helper, helper, helper]);
    await assertNoTemporaryDirectories("pipiui-pdf-");
  });

  process.stdout.write(`${JSON.stringify({ ok: true, scenarios: completed })}\n`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
