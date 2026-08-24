import { createBroker, type GrokCredentialBroker } from "../oauth/broker.js";
import { resolveOAuthConfig } from "../oauth/config.js";
import { authJsonPath } from "../oauth/home.js";
import { FilesClient } from "./client.js";
import { FilesError } from "./errors.js";
import { DEFAULT_FILES_BASE_URL } from "./types.js";

export type InputFilesService = {
  upload(input: {
    bytes: Uint8Array;
    name: string;
    mimeType?: string;
    signal?: AbortSignal;
  }): Promise<{ fileId: string; name: string; size: number; mimeType: string; digest: string }>;
  remove(fileId: string, signal?: AbortSignal): Promise<void>;
};

export type InputFilesServiceOptions = {
  authPath?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  broker?: GrokCredentialBroker;
  client?: FilesClient;
};

export function createInputFilesService(options: InputFilesServiceOptions = {}): InputFilesService {
  const fetchImpl = (options.fetchImpl ?? fetch) as typeof fetch;
  const broker = options.broker ?? createBroker({
    authPath: options.authPath ?? authJsonPath(),
    earlyRefreshSec: resolveOAuthConfig().earlyRefreshSec,
    fetchImpl,
  });
  const client = options.client ?? new FilesClient({
    baseUrl: options.baseUrl ?? DEFAULT_FILES_BASE_URL,
    fetchImpl,
  });

  return {
    async upload(input) {
      return broker.with401Retry(
        (bearer) => client.upload({ ...input, bearer }),
        input.signal,
      );
    },
    async remove(fileId, signal) {
      try {
        await broker.with401Retry((bearer) => client.remove({ fileId, bearer, signal }), signal);
      } catch (error) {
        if (error instanceof FilesError && error.code === "aborted") throw error;
        // Best-effort remote cleanup: never block chat on a failed delete.
      }
    },
  };
}
