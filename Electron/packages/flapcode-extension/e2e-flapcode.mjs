/**
 * E2E smoke: pi-ai's real openai-responses streamer against the live Flapcode
 * relay, using the exact registration payload from createFlapcodeProvider and
 * the same payload sanitizer the before_provider_request hook applies.
 *
 * Run from this package directory with a real key:
 *   FLAPCODE_KEY=sk-flapcode-… node e2e-flapcode.mjs
 */
import { createRequire } from "node:module";
import { createFlapcodeProvider, stripUnsupportedFlapcodeParams } from "./agent/dist/provider.js";

const require = createRequire(import.meta.url);
const { streamSimple } = await import(require.resolve("@earendil-works/pi-ai/dist/api/openai-responses.js"));

const apiKey = process.env.FLAPCODE_KEY;
if (!apiKey) throw new Error("FLAPCODE_KEY env required");

const registration = createFlapcodeProvider({ apiKey });
const model = {
  ...registration.models[0], // gpt-5.6-sol
  provider: "flapcode",
  baseUrl: registration.baseUrl,
  headers: registration.headers, // session-id — composer merges provider headers the same way
};

const context = {
  messages: [
    { role: "user", content: [{ type: "text", text: "用一句话回答：1+1等于几？" }], timestamp: Date.now() },
  ],
};

// The before_provider_request hook does this inside pi; replicate it here.
const sanitizingFetch = async (url, init) => {
  if (init?.body && typeof init.body === "string") {
    const cleaned = stripUnsupportedFlapcodeParams(JSON.parse(init.body));
    if (cleaned) init = { ...init, body: JSON.stringify(cleaned) };
  }
  return fetch(url, init);
};

console.log(`POST ${registration.baseUrl}/responses model=${model.id} session-id=${registration.headers["session-id"]}`);
const stream = streamSimple(model, context, { apiKey, fetch: sanitizingFetch });

let finalText = "";
for await (const event of stream) {
  if (event.type === "text_delta") finalText += event.delta;
  if (event.type === "done") {
    console.log("DONE stopReason=%s", event.reason);
    console.log("text:", JSON.stringify(finalText));
    console.log("usage:", JSON.stringify(event.message.usage));
  }
  if (event.type === "error") {
    console.error("ERROR stopReason=%s message=%s", event.reason, event.error?.errorMessage);
    process.exitCode = 1;
  }
}
