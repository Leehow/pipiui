import { buildPayload } from "./payload.js";
import { JEV_API_URL, JEV_DEADLINE_MS, JEV_POLL_MS } from "./protocol.js";
import { checkAvailability } from "./state.js";
import type { JevDeps, JevFetch, RerankInput, RerankOutcome, RerankScore } from "./types.js";

export type RerankGate = {
  withdrawn: () => boolean;
  signal: AbortSignal;
};

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError")
  );
}

function httpReason(status: number): string {
  if (status === 401) return "http-401";
  if (status === 429) return "http-429";
  if (status >= 500 && status <= 599) return "http-5xx";
  if (status >= 400 && status <= 499) return "http-4xx";
  return "invalid-response";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Scan valid JSON text for duplicate object keys. JSON.parse cannot see them. */
function jsonHasDuplicateKeys(text: string): boolean {
  let i = 0;
  const n = text.length;
  const skipWs = () => {
    while (i < n) {
      const c = text[i];
      if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") break;
      i += 1;
    }
  };
  const parseString = (): string => {
    const start = i;
    i += 1;
    while (i < n) {
      const c = text[i];
      if (c === "\\") {
        i += 1;
        if (text[i] === "u") i += 5;
        else i += 1;
        continue;
      }
      if (c === '"') {
        const raw = text.slice(start, i + 1);
        i += 1;
        return JSON.parse(raw) as string;
      }
      i += 1;
    }
    throw new Error("unterminated string");
  };
  const parseValue = (): boolean => {
    skipWs();
    const c = text[i];
    if (c === '"') {
      parseString();
      return false;
    }
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === "t") {
      i += 4;
      return false;
    }
    if (c === "f") {
      i += 5;
      return false;
    }
    if (c === "n") {
      i += 4;
      return false;
    }
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) {
      i += 1;
      while (i < n) {
        const d = text[i]!;
        if (
          (d >= "0" && d <= "9") ||
          d === "." ||
          d === "e" ||
          d === "E" ||
          d === "+" ||
          d === "-"
        ) {
          i += 1;
          continue;
        }
        break;
      }
      return false;
    }
    throw new Error("bad value");
  };
  const parseObject = (): boolean => {
    i += 1;
    const keys = new Set<string>();
    skipWs();
    if (text[i] === "}") {
      i += 1;
      return false;
    }
    while (i < n) {
      skipWs();
      if (text[i] !== '"') throw new Error("object key");
      const key = parseString();
      if (keys.has(key)) return true;
      keys.add(key);
      skipWs();
      if (text[i] !== ":") throw new Error("colon");
      i += 1;
      if (parseValue()) return true;
      skipWs();
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] === "}") {
        i += 1;
        return false;
      }
      throw new Error("object end");
    }
    throw new Error("unclosed object");
  };
  const parseArray = (): boolean => {
    i += 1;
    skipWs();
    if (text[i] === "]") {
      i += 1;
      return false;
    }
    while (i < n) {
      if (parseValue()) return true;
      skipWs();
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] === "]") {
        i += 1;
        return false;
      }
      throw new Error("array end");
    }
    throw new Error("unclosed array");
  };
  try {
    skipWs();
    return parseValue();
  } catch {
    return true;
  }
}

function parseApplied(payload: unknown, ids: readonly string[]): RerankOutcome {
  if (!isRecord(payload)) return { status: "fallback", reason: "invalid-response" };
  const answers = payload.answers;
  if (!isRecord(answers)) return { status: "fallback", reason: "invalid-response" };
  const answerKeys = Object.keys(answers);
  if (answerKeys.length !== ids.length) return { status: "fallback", reason: "invalid-response" };
  const expected = new Set(ids);
  for (const key of answerKeys) {
    if (!expected.has(key)) return { status: "fallback", reason: "invalid-response" };
  }
  const scores: RerankScore[] = [];
  for (const id of ids) {
    if (!Object.prototype.hasOwnProperty.call(answers, id)) {
      return { status: "fallback", reason: "invalid-response" };
    }
    const answer = answers[id];
    if (!isRecord(answer) || answer.type !== "score") {
      return { status: "fallback", reason: "invalid-response" };
    }
    const score = answer.score;
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 3) {
      return { status: "fallback", reason: "invalid-response" };
    }
    scores.push({ id, score });
  }
  const outcome: RerankOutcome = { status: "applied", scores };
  if (typeof payload.model === "string" && payload.model) outcome.model = payload.model;
  if (isRecord(payload.usage)) {
    const tokens = payload.usage.input_tokens;
    if (typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0) {
      outcome.inputTokens = tokens;
    }
  }
  return outcome;
}

function abortWhen(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

function resolveFetch(deps: JevDeps): JevFetch | undefined {
  if (typeof deps.fetch === "function") return deps.fetch;
  if (typeof globalThis.fetch === "function") {
    return (url, init) => globalThis.fetch(url, init);
  }
  return undefined;
}

type StopReason = "timeout" | "aborted" | "withdrawn" | "generation-mismatch";

export async function executeRerank(
  input: RerankInput,
  deps: JevDeps,
  gate?: RerankGate,
): Promise<RerankOutcome> {
  return executeScore(input, deps, (key) => buildPayload(input.query, input.candidates, key),
    (signal) => checkAvailability(deps, signal), gate);
}

/** Compatibility wrapper: Score keeps its existing API and parser. */
export async function executeScore(
  input: { signal?: AbortSignal },
  deps: JevDeps,
  build: (key: string) => { status: "ok"; json: string; ids: string[] } | { status: "skipped"; reason: string },
  availability: (signal?: AbortSignal) => Promise<{ ready: boolean; reason?: string; apiKey?: string }>,
  gate?: RerankGate,
  onSubmitted?: (count: number) => void,
): Promise<RerankOutcome> {
  return executeDecision(input, deps, build, availability, (parsed, built) => parseApplied(parsed, built.ids), gate, onSubmitted);
}

type DecisionFailure = { status: "skipped" | "fallback"; reason: string };
type DecisionPayload = { status: "ok"; json: string; ids: string[] };

/** One transport for Score and Choice: shared revocation, deadline and strict JSON handling. */
export async function executeDecision<B extends DecisionPayload, O>(
  input: { signal?: AbortSignal },
  deps: JevDeps,
  build: (key: string) => B | { status: "skipped"; reason: string },
  availability: (signal?: AbortSignal) => Promise<{ ready: boolean; reason?: string; apiKey?: string }>,
  parse: (payload: unknown, built: B, key: string) => O,
  gate?: RerankGate,
  onSubmitted?: (count: number) => void,
): Promise<O | DecisionFailure> {
  if (gate?.withdrawn()) return { status: "skipped", reason: "withdrawn" };
  if (input.signal?.aborted || gate?.signal.aborted) return { status: "skipped", reason: "aborted" };

  const deadlineMs = deps.deadlineMs ?? JEV_DEADLINE_MS;
  const deadline = Date.now() + deadlineMs;
  const pollMs = deps.pollMs ?? JEV_POLL_MS;
  const ac = new AbortController();
  let stop: StopReason | undefined;
  let requestKey: string | undefined;
  const stopWith = (reason: StopReason) => {
    if (stop) return;
    stop = reason;
    ac.abort();
  };

  const onUserAbort = () => stopWith("aborted");
  const onGateAbort = () => stopWith(gate?.withdrawn() ? "withdrawn" : "aborted");
  input.signal?.addEventListener("abort", onUserAbort, { once: true });
  gate?.signal.addEventListener("abort", onGateAbort, { once: true });

  const timeout = setTimeout(() => stopWith("timeout"), deadlineMs);
  timeout.unref?.();
  const poll = setInterval(() => {
    void availability(ac.signal).then((result) => {
      if (!result.ready || (requestKey !== undefined && result.apiKey !== requestKey)) stopWith("generation-mismatch");
    });
  }, pollMs);
  poll.unref?.();

  const aborted = abortWhen(ac.signal);
  void aborted.catch(() => {});
  const race = <T>(work: Promise<T>): Promise<T> => Promise.race([work, aborted]);

  const cleanup = () => {
    clearTimeout(timeout);
    clearInterval(poll);
    input.signal?.removeEventListener("abort", onUserAbort);
    gate?.signal.removeEventListener("abort", onGateAbort);
    if (!ac.signal.aborted) ac.abort();
  };

  try {
    if (stop) return { status: "fallback", reason: stop };

    const ready = await race(availability(ac.signal));
    if (stop) return { status: "fallback", reason: stop };
    if (!ready.ready || !ready.apiKey) {
      return { status: "skipped", reason: ready.reason ?? "no-key" };
    }

    requestKey = ready.apiKey;
    const built = build(ready.apiKey);
    if (built.status === "skipped") return { status: "skipped", reason: built.reason };

    const fetchImpl = resolveFetch(deps);
    if (!fetchImpl) return { status: "fallback", reason: "network" };

    // Recheck immediately before upload; authorization can change during preparation.
    const beforeSend = await race(availability(ac.signal));
    if (stop) return { status: "fallback", reason: stop };
    if (!beforeSend.ready) return { status: "skipped", reason: beforeSend.reason ?? "generation-mismatch" };
    if (beforeSend.apiKey !== requestKey) return { status: "skipped", reason: "credential-mismatch" };
    if (Date.now() >= deadline) return { status: "fallback", reason: "timeout" };
    onSubmitted?.(built.ids.length);
    const response = await race(
      fetchImpl(JEV_API_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${ready.apiKey}`,
          "content-type": "application/json",
        },
        body: built.json,
        signal: ac.signal,
        redirect: "error",
      }),
    );
    if (stop) return { status: "fallback", reason: stop };
    if (!response.ok) return { status: "fallback", reason: httpReason(response.status) };

    const text = await race(response.text());
    if (stop) return { status: "fallback", reason: stop };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { status: "fallback", reason: "invalid-response" };
    }
    if (jsonHasDuplicateKeys(text)) {
      return { status: "fallback", reason: "invalid-response" };
    }

    const still = await race(availability(ac.signal));
    if (stop) return { status: "fallback", reason: stop };
    if (gate?.withdrawn()) return { status: "fallback", reason: "withdrawn" };
    if (input.signal?.aborted) return { status: "fallback", reason: "aborted" };
    if (!still.ready) return { status: "fallback", reason: still.reason ?? "generation-mismatch" };
    if (still.apiKey !== requestKey) return { status: "fallback", reason: "credential-mismatch" };
    if (Date.now() >= deadline) return { status: "fallback", reason: "timeout" };
    return parse(parsed, built, ready.apiKey);
  } catch (error) {
    if (stop) return { status: "fallback", reason: stop };
    if (isAbortError(error)) return { status: "fallback", reason: "aborted" };
    return { status: "fallback", reason: "network" };
  } finally {
    cleanup();
  }
}

export async function executeAvailability(
  _projectRoot: string,
  deps: JevDeps,
  gate: RerankGate | undefined,
  signal?: AbortSignal,
): Promise<{ ready: boolean; reason?: string }> {
  if (gate?.withdrawn()) return { ready: false, reason: "withdrawn" };
  if (signal?.aborted || gate?.signal.aborted) return { ready: false, reason: "aborted" };
  const result = await checkAvailability(deps, signal);
  return { ready: result.ready, reason: result.reason };
}
