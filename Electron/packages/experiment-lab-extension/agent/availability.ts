export type ExperimentAvailability = { enabled: boolean; reason?: string };
export type AvailabilityReader = (signal?: AbortSignal) => Promise<ExperimentAvailability>;

/** Read the live host decision, not the settings snapshot inherited at spawn. */
export function createAvailabilityReader(options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}): AvailabilityReader {
  const env = options.env ?? process.env;
  const request = options.fetch ?? globalThis.fetch;
  return async (signal) => {
    const port = env.PIPIUI_BRIDGE_PORT;
    const capability = env.PIPIUI_SESSION_CAPABILITY;
    if (!port || !/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !capability) return { enabled: false, reason: "host-unavailable" };
    try {
      const timeout = AbortSignal.timeout(1500);
      const response = await request(`http://127.0.0.1:${port}/rpc`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, sessionCapability: capability, action: "ext.state", extensionId: "experiment-lab" }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) return { enabled: false, reason: response.status === 403 ? "host-authorization-denied" : "host-unavailable" };
      const reader = response.body?.getReader();
      if (!reader) return { enabled: false, reason: "invalid-host-state" };
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 8192) { await reader.cancel(); return { enabled: false, reason: "invalid-host-state" }; }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || body.schemaVersion !== 1 || body.ok !== true || typeof body.enabled !== "boolean" || typeof body.mounted !== "boolean") return { enabled: false, reason: "invalid-host-state" };
      if (!body.mounted) return { enabled: false, reason: "extension-not-mounted" };
      if (!body.enabled || body.state !== "enabled") return { enabled: false, reason: "extension-disabled" };
      return { enabled: true };
    } catch {
      return { enabled: false, reason: signal?.aborted ? "cancelled" : "host-unavailable" };
    }
  };
}
