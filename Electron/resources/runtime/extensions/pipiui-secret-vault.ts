import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  invokeVaultHostMethod,
  redactJsonValue,
  redactText,
  secretsFromProcessEnv,
  sessionIdFromEnv,
  type VaultMount,
  type VaultSecretMeta,
} from "./secret-vault-core.ts";

function result(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: {},
    ...(isError ? { isError: true } : {}),
  };
}

function sessionIdOf(ctx: { sessionManager?: { getSessionId?: () => string } } | undefined): string {
  return ctx?.sessionManager?.getSessionId?.() || sessionIdFromEnv();
}

const knownEnvNames = new Set<string>();

function rememberEnvName(envName: string | undefined) {
  if (envName) knownEnvNames.add(envName);
}

function sessionSecrets() {
  return secretsFromProcessEnv([...knownEnvNames]);
}

function redactKnown(text: string): string {
  try {
    return redactText(text, sessionSecrets());
  } catch {
    return text;
  }
}

export default function (pi: ExtensionAPI) {
  if (process.env.PIPIUI_AGENT_DEPTH && process.env.PIPIUI_AGENT_DEPTH !== "0") return;

  pi.on("before_provider_request", (event, _ctx) => {
    try {
      const secrets = sessionSecrets();
      if (secrets.length === 0) return;
      if (event && typeof event === "object" && "payload" in event) {
        (event as { payload: unknown }).payload = redactJsonValue((event as { payload: unknown }).payload, secrets);
      }
    } catch (error) {
      console.error("[secret-vault] provider redaction failed", error instanceof Error ? error.name : "error");
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
        const hosted = await invokeVaultHostMethod("putSecretVault", [{
          name: params.name,
          envName: params.envName,
          value: params.value,
          sessionId,
        }]) as { secret: VaultSecretMeta; mount: VaultMount; sessionId: string };
        rememberEnvName(hosted.mount?.envName ?? hosted.secret?.envName);
        if (hosted.mount?.envName) process.env[hosted.mount.envName] = params.value;
        return result({ ok: true, secret: hosted.secret, mount: hosted.mount, sessionId: hosted.sessionId ?? sessionId });
      } catch (error) {
        return result({ ok: false, error: redactKnown(error instanceof Error ? error.message : String(error)) }, true);
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
        const listed = await invokeVaultHostMethod("listSecretVault", [sessionId]) as {
          secrets: VaultSecretMeta[];
          mounts: Array<VaultMount & { name: string }>;
          sessionId: string;
        };
        for (const mount of listed.mounts ?? []) rememberEnvName(mount.envName);
        return result({
          ok: true,
          secrets: listed.secrets,
          mounts: listed.mounts,
          sessionId: listed.sessionId ?? sessionId,
        });
      } catch (error) {
        return result({ ok: false, error: redactKnown(error instanceof Error ? error.message : String(error)) }, true);
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
        const hosted = await invokeVaultHostMethod("mountSecretVault", [sessionId, params.secret, params.envName]) as {
          sessionId: string;
          mount: VaultMount;
        };
        rememberEnvName(hosted.mount?.envName);
        return result({ ok: true, sessionId: hosted.sessionId ?? sessionId, mount: hosted.mount });
      } catch (error) {
        return result({ ok: false, error: redactKnown(error instanceof Error ? error.message : String(error)) }, true);
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
        const listed = await invokeVaultHostMethod("listSecretVault", [sessionId]) as {
          mounts: Array<VaultMount & { name: string }>;
        };
        const hosted = await invokeVaultHostMethod("unmountSecretVault", [sessionId, params.secret]) as {
          sessionId: string;
          removed: boolean;
        };
        const leftover = new Set(
          ((await invokeVaultHostMethod("listSecretVault", [sessionId]) as { mounts: Array<VaultMount> }).mounts ?? [])
            .map((item) => item.envName),
        );
        for (const mount of listed.mounts ?? []) {
          if (!leftover.has(mount.envName)) {
            delete process.env[mount.envName];
            knownEnvNames.delete(mount.envName);
          }
        }
        return result({ ok: true, sessionId: hosted.sessionId ?? sessionId, removed: hosted.removed });
      } catch (error) {
        return result({ ok: false, error: redactKnown(error instanceof Error ? error.message : String(error)) }, true);
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
        const listed = await invokeVaultHostMethod("listSecretVault", [sessionId]) as {
          mounts: Array<VaultMount & { name: string }>;
        };
        const hosted = await invokeVaultHostMethod("deleteSecretVault", [params.secret]) as { deleted: boolean };
        const leftover = new Set(
          ((await invokeVaultHostMethod("listSecretVault", [sessionId]) as { mounts: Array<VaultMount> }).mounts ?? [])
            .map((item) => item.envName),
        );
        for (const mount of listed.mounts ?? []) {
          if (!leftover.has(mount.envName)) {
            delete process.env[mount.envName];
            knownEnvNames.delete(mount.envName);
          }
        }
        return result({ ok: true, deleted: hosted.deleted });
      } catch (error) {
        return result({ ok: false, error: redactKnown(error instanceof Error ? error.message : String(error)) }, true);
      }
    },
  });
}
