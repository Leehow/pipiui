import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  deleteSecret,
  installEnvKeyProvider,
  listSecretMeta,
  listSessionMounts,
  mountSecret,
  putSecret,
  redactJsonValue,
  redactText,
  revealMountedSecrets,
  sessionIdFromEnv,
  unmountSecret,
  vaultDirFromEnv,
} from "./secret-vault-core.ts";

function result(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: {},
    ...(isError ? { isError: true } : {}),
  };
}

function requireDir(): string {
  const dir = vaultDirFromEnv();
  if (!dir) throw new Error("PIPIUI_SECRET_VAULT_DIR is not set");
  return dir;
}

function sessionIdOf(ctx: { sessionManager?: { getSessionId?: () => string } } | undefined): string {
  return ctx?.sessionManager?.getSessionId?.() || sessionIdFromEnv();
}

function sessionSecrets(sessionId: string) {
  return revealMountedSecrets(requireDir(), sessionId);
}

function redactKnown(text: string, sessionId: string): string {
  try {
    return redactText(text, sessionSecrets(sessionId));
  } catch {
    return text;
  }
}

export default function (pi: ExtensionAPI) {
  installEnvKeyProvider();
  if (process.env.PIPIUI_AGENT_DEPTH && process.env.PIPIUI_AGENT_DEPTH !== "0") return;

  pi.on("before_provider_request", (event, ctx) => {
    try {
      const secrets = sessionSecrets(sessionIdOf(ctx));
      if (secrets.length === 0) return;
      if (event && typeof event === "object" && "payload" in event) {
        (event as { payload: unknown }).payload = redactJsonValue((event as { payload: unknown }).payload, secrets);
      }
    } catch (error) {
      console.error("[secret-vault] provider redaction failed", error);
    }
  });

  pi.registerTool({
    name: "secret_vault_put",
    label: "Secret Vault Put",
    description:
      "Store a secret in the global App-profile vault. Returns only id/name/envName — never the value. " +
      "Then call secret_vault_mount so this session (and later workers) can use it as an env var.",
    promptSnippet: "Store a secret in the global vault without echoing its value",
    parameters: Type.Object({
      name: Type.String({ minLength: 1 }),
      envName: Type.String({ minLength: 1 }),
      value: Type.String({ minLength: 8 }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const sessionId = sessionIdOf(ctx);
      try {
        const meta = await putSecret(requireDir(), params);
        const mounted = await mountSecret(requireDir(), sessionId, meta.id);
        process.env[mounted.envName] = params.value;
        return result({ ok: true, secret: meta, mount: mounted, sessionId });
      } catch (error) {
        return result({ ok: false, error: redactKnown(error instanceof Error ? error.message : String(error), sessionId) }, true);
      }
    },
  });

  pi.registerTool({
    name: "secret_vault_list",
    label: "Secret Vault List",
    description: "List global vault metadata and this session's mounts. Values are never returned.",
    promptSnippet: "List vault secret names and current session mounts",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const sessionId = sessionIdOf(ctx);
      try {
        const dir = requireDir();
        return result({
          ok: true,
          secrets: listSecretMeta(dir),
          mounts: listSessionMounts(dir, sessionId),
          sessionId,
        });
      } catch (error) {
        return result({ ok: false, error: redactKnown(error instanceof Error ? error.message : String(error), sessionId) }, true);
      }
    },
  });

  pi.registerTool({
    name: "secret_vault_mount",
    label: "Secret Vault Mount",
    description:
      "Bind a vault secret to this conversation so later turns and dispatched workers receive it as env. " +
      "Reuse the same secret id/name across sessions.",
    promptSnippet: "Mount a vault secret onto the current session as an env var",
    parameters: Type.Object({
      secret: Type.String({ minLength: 1, description: "id, name, or envName" }),
      envName: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const sessionId = sessionIdOf(ctx);
      try {
        const mount = await mountSecret(requireDir(), sessionId, params.secret, params.envName);
        const revealed = revealMountedSecrets(requireDir(), sessionId).find((item) => item.id === mount.secretId);
        if (revealed) process.env[mount.envName] = revealed.value;
        return result({ ok: true, sessionId, mount });
      } catch (error) {
        return result({ ok: false, error: redactKnown(error instanceof Error ? error.message : String(error), sessionId) }, true);
      }
    },
  });

  pi.registerTool({
    name: "secret_vault_unmount",
    label: "Secret Vault Unmount",
    description: "Remove a secret mount from this conversation. The global vault entry remains.",
    promptSnippet: "Unmount a vault secret from the current session",
    parameters: Type.Object({
      secret: Type.String({ minLength: 1 }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const sessionId = sessionIdOf(ctx);
      try {
        const mounts = listSessionMounts(requireDir(), sessionId);
        const removed = await unmountSecret(requireDir(), sessionId, params.secret);
        const leftover = new Set(listSessionMounts(requireDir(), sessionId).map((item) => item.envName));
        for (const mount of mounts) {
          if (!leftover.has(mount.envName)) delete process.env[mount.envName];
        }
        return result({ ok: true, sessionId, removed });
      } catch (error) {
        return result({ ok: false, error: redactKnown(error instanceof Error ? error.message : String(error), sessionId) }, true);
      }
    },
  });

  pi.registerTool({
    name: "secret_vault_delete",
    label: "Secret Vault Delete",
    description: "Permanently delete a secret from the global vault and all session mounts. Returns metadata only.",
    promptSnippet: "Delete a global vault secret",
    parameters: Type.Object({
      secret: Type.String({ minLength: 1 }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const sessionId = sessionIdOf(ctx);
      try {
        const mounts = listSessionMounts(requireDir(), sessionId);
        const deleted = await deleteSecret(requireDir(), params.secret);
        const leftover = new Set(listSessionMounts(requireDir(), sessionId).map((item) => item.envName));
        for (const mount of mounts) {
          if (!leftover.has(mount.envName)) delete process.env[mount.envName];
        }
        return result({ ok: true, deleted });
      } catch (error) {
        return result({ ok: false, error: redactKnown(error instanceof Error ? error.message : String(error), sessionId) }, true);
      }
    },
  });
}
