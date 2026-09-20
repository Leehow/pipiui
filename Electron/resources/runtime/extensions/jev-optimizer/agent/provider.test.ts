import assert from "node:assert/strict";
import { test } from "node:test";
import { createJevOptimizer } from "./index.js";
import {
  CHANNEL_DISCOVER,
  CHANNEL_PROVIDE,
  CHANNEL_WITHDRAW,
  JEV_PROVIDER,
} from "./protocol.js";
import type {
  EventBus,
  JevDeps,
  JevExtensionAPI,
  RerankCandidate,
  RerankOffer,
  RerankWithdraw,
} from "./types.js";

function createBus(): EventBus {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  return {
    on(channel, handler) {
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
      }
      set.add(handler);
      return () => set!.delete(handler);
    },
    emit(channel, data) {
      for (const handler of [...(listeners.get(channel) ?? [])]) handler(data);
    },
  };
}

function fakePi(bus: EventBus) {
  const hooks = new Map<string, Array<() => void>>();
  const tools: unknown[] = [];
  const providers: unknown[] = [];
  const pi: JevExtensionAPI & {
    tools: unknown[];
    providers: unknown[];
    shutdown: () => void;
  } = {
    events: bus,
    tools,
    providers,
    registerTool(tool) {
      tools.push(tool);
    },
    registerProvider(name) {
      providers.push(name);
    },
    on(event, handler) {
      const list = hooks.get(event) ?? [];
      list.push(handler as () => void);
      hooks.set(event, list);
    },
    shutdown() {
      for (const handler of hooks.get("session_shutdown") ?? []) handler();
    },
  };
  return pi;
}

function installConsumer(bus: EventBus) {
  let current: RerankOffer | undefined;
  const offers: RerankOffer[] = [];
  const withdrawals: RerankWithdraw[] = [];
  bus.on(CHANNEL_PROVIDE, (data) => {
    const offer = data as RerankOffer;
    if (
      offer?.version === 1 &&
      offer.provider === JEV_PROVIDER &&
      typeof offer.instanceId === "string" &&
      typeof offer.availability === "function" &&
      typeof offer.rerank === "function"
    ) {
      current = offer;
      offers.push(offer);
    }
  });
  bus.on(CHANNEL_WITHDRAW, (data) => {
    const payload = data as RerankWithdraw;
    withdrawals.push(payload);
    if (payload?.instanceId && payload.instanceId === current?.instanceId) current = undefined;
  });
  return {
    current: () => current,
    offers,
    withdrawals,
    discover: () => bus.emit(CHANNEL_DISCOVER, { version: 1 }),
  };
}

const GEN = "gen-1";
const KEY = "sk-test-not-real";

function candidate(id: string): RerankCandidate {
  return { id, path: `src/${id}.ts`, startLine: 1, endLine: 3, text: `const ${id} = 1;` };
}

function deps(fetch: JevDeps["fetch"], over: Partial<JevDeps> = {}): JevDeps {
  return {
    env: {
      PIPIUI_JEV_STATE_FILE: "/injected/runtime-state.json",
      PIPIUI_JEV_GENERATION: GEN,
      EXT_JEV_OPTIMIZER_APIKEY: KEY,
    },
    readState: async () =>
      JSON.stringify({ schemaVersion: 1, enabled: true, hasKey: true, generation: GEN }),
    fetch,
    ...over,
  };
}

test("provider then consumer discover completes the handshake without tools", () => {
  const bus = createBus();
  const pi = fakePi(bus);
  const handle = createJevOptimizer(pi, deps(async () => new Response("nope", { status: 500 })));
  assert.equal(pi.tools.length, 0);
  assert.equal(pi.providers.length, 0);
  const consumer = installConsumer(bus);
  consumer.discover();
  assert.equal(consumer.current()?.provider, JEV_PROVIDER);
  assert.equal(consumer.current()?.instanceId, handle.instanceId);
  assert.equal(typeof consumer.current()?.rerank, "function");
  handle.dispose();
});

test("consumer-first load order still receives the later offer", () => {
  const bus = createBus();
  const consumer = installConsumer(bus);
  consumer.discover();
  assert.equal(consumer.current(), undefined);
  const pi = fakePi(bus);
  const handle = createJevOptimizer(pi, { env: {} });
  assert.equal(consumer.current()?.instanceId, handle.instanceId);
  consumer.discover();
  assert.ok(consumer.offers.length >= 2);
  assert.equal(consumer.offers.at(-1)?.instanceId, handle.instanceId);
  handle.dispose();
});

test("session shutdown withdraws the instance and late rerank cannot apply", async () => {
  const bus = createBus();
  const pi = fakePi(bus);
  const consumer = installConsumer(bus);
  let resolveFetch: ((value: Response) => void) | undefined;
  let markStarted: () => void = () => {};
  const fetchStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const handle = createJevOptimizer(
    pi,
    deps((_url, init) => {
      markStarted();
      return new Promise((resolve, reject) => {
        resolveFetch = resolve;
        init?.signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
    }),
  );
  consumer.discover();
  const offer = consumer.current();
  assert.ok(offer);
  const pending = offer!.rerank({
    query: "auth",
    projectRoot: "/abs/project",
    candidates: [candidate("candidate-1"), candidate("candidate-2")],
  });
  await fetchStarted;
  pi.shutdown();
  assert.equal(consumer.current(), undefined);
  assert.equal(consumer.withdrawals[0]?.provider, JEV_PROVIDER);
  assert.equal(consumer.withdrawals[0]?.instanceId, handle.instanceId);
  const outcome = await pending;
  assert.equal(outcome.status, "fallback");
  assert.ok(outcome.reason === "withdrawn" || outcome.reason === "aborted");
  assert.equal(outcome.scores, undefined);
  resolveFetch?.(
    new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: {
          "candidate-1": { type: "score", score: 3 },
          "candidate-2": { type: "score", score: 3 },
        },
      }),
      { status: 200 },
    ),
  );
  assert.equal((await offer!.availability("/abs/project")).ready, false);
});

test("discover after withdraw does not resurrect a disposed instance", () => {
  const bus = createBus();
  const pi = fakePi(bus);
  const consumer = installConsumer(bus);
  const handle = createJevOptimizer(pi, { env: {} });
  consumer.discover();
  handle.dispose();
  assert.equal(consumer.current(), undefined);
  consumer.discover();
  assert.equal(consumer.current(), undefined);
});
