import { createBroker } from "../oauth/broker.js";
import { resolveOAuthConfig } from "../oauth/config.js";
import { authJsonPath } from "../oauth/home.js";
import { FilesClient } from "./client.js";
import { FilesError } from "./errors.js";
import { DEFAULT_FILES_BASE_URL } from "./types.js";
export function createInputFilesService(options = {}) {
    const fetchImpl = (options.fetchImpl ?? fetch);
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
            return broker.with401Retry((bearer) => client.upload({ ...input, bearer }), input.signal);
        },
        async remove(fileId, signal) {
            try {
                await broker.with401Retry((bearer) => client.remove({ fileId, bearer, signal }), signal);
            }
            catch (error) {
                if (error instanceof FilesError && error.code === "aborted")
                    throw error;
                // Best-effort remote cleanup: never block chat on a failed delete.
            }
        },
    };
}
