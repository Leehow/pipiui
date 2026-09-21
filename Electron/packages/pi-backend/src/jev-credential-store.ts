import { readFileSync, realpathSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { JEV_EXTENSION_ID } from "./jev-runtime-state.js";
import { projectPiAgentDir } from "./project-pi-home.js";
import { atomicWriteFile } from "./secret-vault.js";

/** Host-injected OS encryption. Production wraps Electron `safeStorage`; tests inject a fake. */
export type ExtensionSecretCipher = {
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
};

export const EXTENSION_SECRET_ENCRYPTION_UNAVAILABLE = "系统加密不可用，无法持久保存扩展凭据";
export const JEV_CREDENTIAL_DECRYPT_FAILED = "无法解密已保存的 Jev 扩展凭据";
export const JEV_CREDENTIAL_FILE = "credential.enc";

function canonicalProjectRoot(projectRoot: string): string {
  const lexical = resolve(projectRoot);
  try {
    return realpathSync(lexical);
  } catch {
    return lexical;
  }
}

/** Independent ciphertext blob under the project's `.pi/agent` — never the runtime-state file. */
export function jevCredentialCipherPath(projectRoot: string): string {
  return join(projectPiAgentDir(canonicalProjectRoot(projectRoot)), JEV_EXTENSION_ID, JEV_CREDENTIAL_FILE);
}

/**
 * Durable store for the Jev extension API key only. The in-memory extension vault remains
 * the process cache; this file is the OS-encrypted projection that survives restart.
 * The global tool vault is untouched and still RAM-only.
 */
export class JevCredentialStore {
  constructor(private readonly cipher?: ExtensionSecretCipher) {}

  async read(projectRoot: string): Promise<string | undefined> {
    let bytes: Buffer;
    try {
      bytes = readFileSync(jevCredentialCipherPath(projectRoot));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!this.cipher) {
      throw new Error(JEV_CREDENTIAL_DECRYPT_FAILED);
    }
    try {
      const value = this.cipher.decrypt(bytes);
      if (typeof value !== 'string' || value.length < 8 || !value.trim()) throw new Error(JEV_CREDENTIAL_DECRYPT_FAILED);
      return value;
    } catch {
      // Cipher errors are not trusted to omit plaintext; never forward their text/cause.
      throw new Error(JEV_CREDENTIAL_DECRYPT_FAILED);
    }
  }

  async write(projectRoot: string, plaintext: string): Promise<void> {
    if (!this.cipher) {
      throw new Error(EXTENSION_SECRET_ENCRYPTION_UNAVAILABLE);
    }
    let ciphertext: Buffer;
    try {
      const encrypted = this.cipher.encrypt(plaintext);
      ciphertext = Buffer.isBuffer(encrypted) ? encrypted : Buffer.from(encrypted);
    } catch {
      throw new Error(EXTENSION_SECRET_ENCRYPTION_UNAVAILABLE);
    }
    atomicWriteFile(jevCredentialCipherPath(projectRoot), ciphertext);
  }

  async clear(projectRoot: string): Promise<void> {
    try {
      unlinkSync(jevCredentialCipherPath(projectRoot));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}
