/**
 * Stable host library entry (`agent/dist/host.js`) — the chatrpgv4 pi-coc host
 * consumer loads THIS module from the same build artifact as the extension
 * itself (single source; no second OAuth/image implementation exists).
 *
 * The manifest declares this entry (`host.entry`) and the bundled sync writes a
 * content-hash receipt next to it so a future pi-coc resolver can verify both
 * hosts consume byte-identical code (spec §D1 "两宿主解析到同一文件内容").
 *
 * Everything funnels through the same primitives the tools use: the credential
 * broker (symlink-safe shared-profile locking, early refresh, 401 retry), the
 * advisory tier gate, the ImagesClient wire contract, and the atomic
 * SessionImageWriter. Results carry bytes + metadata (never just a path).
 */
import { type GrokCredentialBroker, type BrokerCredential } from "./oauth/broker.js";
import type { CredentialStoreAdapter } from "./oauth/store-adapter.js";
export { NoAgentHomeError } from "./oauth/home.js";
export { ImagesError } from "./images/errors.js";
export { OAuthError } from "./oauth/device.js";
export type HostStatus = {
    loggedIn: boolean;
    expired: boolean;
    hasRefresh: boolean;
    usable: boolean;
    expiresAtMs?: number;
    issuer?: string;
    /** Subscription tier carried by the credential (official id_token `tier` claim); undefined = unknown. */
    tier?: string;
    tierRaw?: string;
    tierSource?: "jwt";
};
export type HostImageResult = {
    /** Decoded image bytes. */
    bytes: Uint8Array;
    /** Strict-decoded base64 (no whitespace). */
    b64: string;
    mime: string;
    /** Absolute path of the atomically-saved file under the attachments root. */
    path: string;
    model: string;
    backend: string;
    deprecated?: boolean;
};
export type HostLibraryOptions = {
    /** Defaults to `PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR` (fail closed). */
    authPath?: string;
    fetchImpl?: typeof fetch;
    /** Images isolation root override (tests). */
    imagesRoot?: string;
    /** Host-injected credential store — every broker mutation goes through it. */
    credentialStore?: CredentialStoreAdapter;
};
export type HostLibrary = {
    status(): Promise<HostStatus>;
    generateImage(req: {
        prompt: string;
        aspectRatio?: string;
        signal?: AbortSignal;
    }): Promise<HostImageResult>;
    editImage(req: {
        prompt: string;
        /** data URLs or paths inside the allowed roots (cwd / attachments). */
        images: string[];
        aspectRatio?: string;
        signal?: AbortSignal;
    }): Promise<HostImageResult>;
    /** Direct access to the shared broker for host-managed refresh (rare). */
    broker(): GrokCredentialBroker;
};
export declare function createGrokBuildHostLibrary(options?: HostLibraryOptions): HostLibrary;
/** Version of the host entry — the receipt pins the content hash of this file. */
export declare const HOST_LIBRARY_VERSION = "1.0.0";
export type { BrokerCredential };
