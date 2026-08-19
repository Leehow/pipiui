export const MIN_SECRET_LEN = 8;

export type VaultSecretMeta = {
  id: string;
  name: string;
  envName: string;
  createdAt: string;
};

export type VaultMount = { secretId: string; envName: string };
export type RevealedSecret = { id: string; name: string; envName: string; value: string };

const VAULT_HOST_METHODS = [
  "listSecretVault",
  "putSecretVault",
  "mountSecretVault",
  "unmountSecretVault",
  "deleteSecretVault",
] as const;

export type VaultHostMethod = (typeof VAULT_HOST_METHODS)[number];

export async function invokeVaultHostMethod(method: VaultHostMethod, params: unknown[] = []): Promise<unknown> {
  const port = process.env.PIPIUI_BRIDGE_PORT;
  const capability = process.env.PIPIUI_SESSION_CAPABILITY;
  if (!port || !capability) throw new Error("vault host bridge unavailable");
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 1,
      sessionCapability: capability,
      action: "vault_action",
      event: { method, params },
    }),
  });
  const payload = await response.json() as { ok?: boolean; result?: unknown; error?: string };
  if (!payload?.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "vault host request failed");
  return payload.result;
}

export function applySessionMountsToMainEnv(
  parent: NodeJS.ProcessEnv,
  mounts: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(mounts)) env[key] = value;
  delete env.PIPIUI_VAULT_DEK;
  delete env.PIPIUI_SECRET_VAULT_DEK;
  return env;
}

export function applySessionMountsToWorkerEnv(
  parent: NodeJS.ProcessEnv,
  mounts: Record<string, string> = {},
): Record<string, string> {
  return applySessionMountsToMainEnv(parent, mounts);
}

export function sessionIdFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.PIPIUI_SESSION_ID || env.PIPIUI_SESSION_KEY || "default";
}

export function secretsFromProcessEnv(envNames: readonly string[], env: NodeJS.ProcessEnv = process.env): RevealedSecret[] {
  return envNames.flatMap((envName) => {
    const value = env[envName];
    if (!value || value.length < MIN_SECRET_LEN) return [];
    return [{ id: envName, name: envName, envName, value }];
  });
}

export function secretPlaceholder(secret: { envName: string }): string {
  return `{{secret:${secret.envName}}}`;
}

export function redactText(text: string, secrets: readonly RevealedSecret[]): string {
  if (!text || secrets.length === 0) return text;
  const ordered = [...secrets].sort((a, b) => b.value.length - a.value.length);
  let out = text;
  for (const secret of ordered) {
    if (secret.value.length < MIN_SECRET_LEN) continue;
    if (!out.includes(secret.value)) continue;
    out = out.split(secret.value).join(secretPlaceholder(secret));
  }
  return out;
}

export function redactJsonValue(value: unknown, secrets: readonly RevealedSecret[]): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item, secrets));
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) next[key] = redactJsonValue(item, secrets);
    return next;
  }
  return value;
}
