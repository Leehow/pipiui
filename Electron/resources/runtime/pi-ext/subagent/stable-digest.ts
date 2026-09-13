/**
 * One bounded, stable, dependency-free digest for the runtime's "have I seen this before?"
 * comparisons. Not cryptographic and never used as one: it exists so ring buffers and
 * fingerprints hold fixed-size entries instead of whole tool payloads or whole path lists.
 */

/** FNV-1a over two basins, base-36 joined. Collisions cost a missed repeat, never a false kill. */
export function stableDigest(input: string): string {
	let h1 = 0x811c9dc5;
	let h2 = 0xc2b2ae35;
	for (let i = 0; i < input.length; i += 1) {
		const code = input.charCodeAt(i);
		h1 = Math.imul(h1 ^ code, 0x01000193);
		h2 = Math.imul(h2 ^ code, 0x85ebca6b);
	}
	return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}
