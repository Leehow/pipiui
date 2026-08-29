/**
 * web-access-extension agent half.
 *
 * Mounts the four frozen Web Access tools — `web_search` / `fetch_content` /
 * `source_check` / `get_search_content` — under this package's manifest
 * contract. Tool names, schemas, wire behavior, and the session transcript
 * renderer are unchanged: the provider adapters, DOM extraction/compression,
 * and result formatting come from the version-pinned `pi-web-access`
 * implementation, wrapped (not reimplemented) so the extension boundary owns
 * the mounting while behavior stays byte-identical.
 *
 * Seed note: this wave only ships the package as a bundled seed. Switching the
 * mounted source from the managed `pi-web-access` mount to this extension is
 * the seed-release wave's decision; until then both mounts must stay
 * behaviorally identical, which
 * `packages/pi-backend/test/web-access-extension.test.ts` pins.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import webAccess from "pi-web-access";

export default function webAccessExtension(pi: ExtensionAPI): void {
	webAccess(pi);
}
