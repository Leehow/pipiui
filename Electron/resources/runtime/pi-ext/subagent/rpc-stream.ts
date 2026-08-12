import { StringDecoder } from "node:string_decoder";

const OMITTED_SCREENSHOT = "[screenshot omitted from parent result; image was available to child model]";
const PRIVATE_RESULT_KEYS = /(?:^|_)(?:x|y|left|top|right|bottom|width|height|bounds|coordinates?|element_token|token|screenshot(?:_png)?_?b64|screenshotBase64|image_data|base64)(?:$|_)/i;
const BASE64_LIKE = /^[A-Za-z0-9+/=_-]+$/;

function closedValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(closedValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value as Record<string, unknown>)
			.filter(([key]) => !PRIVATE_RESULT_KEYS.test(key))
			.map(([key, item]) => [key, closedValue(item)]));
	}
	if (typeof value === "string" && value.length > 1024 && BASE64_LIKE.test(value)) return "[binary omitted]";
	return value;
}

function closedText(text: string): string {
	try { return JSON.stringify(closedValue(JSON.parse(text))); }
	catch { return text.replace(/[A-Za-z0-9+/=_-]{2048,}/g, "[binary omitted]"); }
}

export function projectToolResultMessageForParent(message: Record<string, any>): Record<string, any> {
	const content = Array.isArray(message.content) ? message.content.flatMap((part: any) => {
		if (part?.type === "text") return [{ ...part, text: closedText(String(part.text ?? "")) }];
		if (part?.type === "image") return [{ type: "text", text: OMITTED_SCREENSHOT }];
		return [];
	}) : [];
	return { ...message, content };
}

export class JSONLChunkScanner {
	readonly #decoder = new StringDecoder("utf8");
	#lineParts: string[] = [];
	readonly #onLine: (line: string) => void;
	constructor(onLine: (line: string) => void) { this.#onLine = onLine; }

	push(chunk: Buffer | Uint8Array | string): void {
		const decoded = typeof chunk === "string" ? chunk : this.#decoder.write(Buffer.from(chunk));
		this.#scan(decoded);
	}

	end(): void {
		this.#scan(this.#decoder.end());
		if (this.#lineParts.length) {
			this.#onLine(this.#lineParts.length === 1 ? this.#lineParts[0] : this.#lineParts.join(""));
			this.#lineParts = [];
		}
	}

	#scan(decoded: string): void {
		let start = 0;
		for (;;) {
			const newline = decoded.indexOf("\n", start);
			if (newline < 0) break;
			this.#lineParts.push(decoded.slice(start, newline));
			this.#onLine(this.#lineParts.length === 1 ? this.#lineParts[0] : this.#lineParts.join(""));
			this.#lineParts = [];
			start = newline + 1;
		}
		if (start < decoded.length) this.#lineParts.push(decoded.slice(start));
	}
}
