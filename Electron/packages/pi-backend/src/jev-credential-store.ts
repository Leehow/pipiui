import { readFileSync, realpathSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { JEV_EXTENSION_ID } from "./jev-runtime-state.js";
import { projectPiAgentDir } from "./project-pi-home.js";
import { atomicWriteFile } from "./secret-vault.js";

export const JEV_CREDENTIAL_READ_FAILED = "无法读取 Jev 凭据，请在扩展设置中重新保存密钥";
export const JEV_CREDENTIAL_FILE = "credential.json";

export function jevCredentialPath(projectRoot: string): string {
  let root = resolve(projectRoot);
  try { root = realpathSync(root); } catch { /* project may not exist yet */ }
  return join(projectPiAgentDir(root), JEV_EXTENSION_ID, JEV_CREDENTIAL_FILE);
}

/** Local credentials, like the OCR store: atomic writes, POSIX 0600, inherited Windows ACLs.
 * Legacy credential.enc is deliberately never decrypted on startup or spawn. Users
 * re-enter the key once; the old ciphertext cannot resurrect after replace or clear.
 * The global tool vault remains RAM-only.
 */
export class JevCredentialStore {
  async read(projectRoot: string): Promise<string | undefined> {
    let text: string;
    try {
      text = readFileSync(jevCredentialPath(projectRoot), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error(JEV_CREDENTIAL_READ_FAILED);
    }
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object" || !("apiKey" in value)
        || typeof value.apiKey !== "string" || value.apiKey.length < 8 || !value.apiKey.trim()) {
        throw new Error(JEV_CREDENTIAL_READ_FAILED);
      }
      return value.apiKey;
    } catch {
      // Never propagate parser errors containing credential text.
      throw new Error(JEV_CREDENTIAL_READ_FAILED);
    }
  }

  async write(projectRoot: string, plaintext: string): Promise<void> {
    if (typeof plaintext !== "string" || plaintext.length < 8 || !plaintext.trim()) {
      throw new Error("Jev 密钥至少需要 8 个字符");
    }
    atomicWriteFile(jevCredentialPath(projectRoot), `${JSON.stringify({ apiKey: plaintext })}\n`);
  }

  async clear(projectRoot: string): Promise<void> {
    try { unlinkSync(jevCredentialPath(projectRoot)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
