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
  if (gate?.withdrawn()) return { status: "skipped", reason: "withdrawn" };
  if (input.signal?.aborted || gate?.signal.aborted) return { status: "skipped", reason: "aborted" };

  const deadlineMs = deps.deadlineMs ?? JEV_DEADLINE_MS;
  const pollMs = deps.pollMs ?? JEV_POLL_MS;
  const ac = new AbortController();
  let stop: StopReason | undefined;
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
    void checkAvailability(deps, ac.signal).then((result) => {
      if (!result.ready) stopWith("generation-mismatch");
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

    const ready = await race(checkAvailability(deps, ac.signal));
    if (stop) return { status: "fallback", reason: stop };
    if (!ready.ready || !ready.apiKey) {
      return { status: "skipped", reason: ready.reason ?? "no-key" };
    }

    const built = buildPayload(input.query, input.candidates, ready.apiKey);
    if (built.status === "skipped") return { status: "skipped", reason: built.reason };

    const fetchImpl = resolveFetch(deps);
    if (!fetchImpl) return { status: "fallback", reason: "network" };

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

    const still = await race(checkAvailability(deps, ac.signal));
    if (stop) return { status: "fallback", reason: stop };
    if (gate?.withdrawn()) return { status: "fallback", reason: "withdrawn" };
    if (input.signal?.aborted) return { status: "fallback", reason: "aborted" };
    if (!still.ready) return { status: "fallback", reason: still.reason ?? "generation-mismatch" };
    return parseApplied(parsed, built.ids);
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
