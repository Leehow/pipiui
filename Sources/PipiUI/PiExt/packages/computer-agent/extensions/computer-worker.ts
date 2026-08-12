import { desktopModelActionSchema } from "../src/desktop-actions.ts";

type WorkerRole = "gui-operator" | "terminal-worker" | "verifier";
type WorkerEnvironment = Record<string, string | undefined>;
type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
	executionMode?: "sequential";
  execute(id: string, params: any, signal?: AbortSignal): Promise<any>;
};
const WORKER_REQUEST_TIMEOUT_MS = 40_000;
type PiLike = { registerTool(tool: RegisteredTool): void };

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export function toolNamesForComputerWorkerRole(role: WorkerRole): string[] {
  if (role === "terminal-worker") return [];
  const observation = ["desktop_observe", "desktop_locate", "desktop_verify"];
  return role === "gui-operator"
    ? [...observation, "desktop_open_application", "desktop_typeahead", "desktop_act"]
    : observation;
}

function validEnvironment(env: WorkerEnvironment): {
  url: string;
  token: string;
  role: WorkerRole;
} | undefined {
  const url = env.PIPIUI_COMPUTER_WORKER_BROKER_URL;
  const token = env.PIPIUI_COMPUTER_WORKER_BROKER_TOKEN;
  const role = env.PIPIUI_COMPUTER_WORKER_ROLE;
  if (!url?.startsWith("http://127.0.0.1:") || !token || token.length < 32) return undefined;
  if (role !== "gui-operator" && role !== "verifier") return undefined;
  return { url, token, role };
}

function contentForResult(result: Record<string, any>): Array<Record<string, unknown>> {
  const screenshot = typeof result.screenshotBase64 === "string"
    ? result.screenshotBase64
    : typeof result.screenshot_png_b64 === "string"
      ? result.screenshot_png_b64
      : typeof result.base64 === "string"
				? result.base64
				: undefined;
  const mimeType = result.mimeType ?? result.screenshotMimeType ?? result.screenshot_mime_type ?? "image/png";
  const safe = { ...result };
  delete safe.screenshotBase64;
  delete safe.screenshot_png_b64;
	delete safe.base64;
  const content: Array<Record<string, unknown>> = [{ type: "text", text: JSON.stringify(safe) }];
  if (screenshot) content.push({ type: "image", data: screenshot, mimeType });
  return content;
}

function elementsFrom(observation: Record<string, any> | undefined): Array<Record<string, any>> {
  const accessibility = observation?.accessibility;
  return Array.isArray(accessibility?.elements) ? accessibility.elements : [];
}

export function registerComputerWorkerTools(
  pi: PiLike,
  env: WorkerEnvironment = process.env,
  fetchImpl: typeof fetch = fetch,
): void {
  const config = validEnvironment(env);
  if (!config) return;
  let observation: Record<string, any> | undefined;
	let fatalCode: "computer_worker_runtime_timeout" | "computer_worker_request_cancelled" | "computer_worker_no_progress" | undefined;
	let requestQueue: Promise<void> = Promise.resolve();

  const request = async (
    operation: "observe" | "locate" | "mutate" | "openApplication",
    payload: Record<string, unknown>,
    signal?: AbortSignal,
	): Promise<Record<string, any>> => {
		const run = async (): Promise<Record<string, any>> => {
			if (fatalCode) throw new Error(fatalCode);
		const timeoutSignal = AbortSignal.timeout(WORKER_REQUEST_TIMEOUT_MS);
		const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetchImpl(config.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
			signal: requestSignal,
      body: JSON.stringify({ token: config.token, operation, payload }),
    });
    const result = await response.json() as Record<string, any>;
    if (!response.ok || result.ok === false) {
			const code = String(result.error ?? `computer worker broker returned ${response.status}`);
			if (code === "computer_worker_runtime_timeout" || code === "computer_worker_request_cancelled" || code === "computer_worker_no_progress") fatalCode = code;
      throw new Error(code);
    }
    observation = result;
    return result;
		};
		const pending = requestQueue.then(run, run);
		requestQueue = pending.then(() => undefined, () => undefined);
		return pending;
  };

  pi.registerTool({
    name: "desktop_observe",
    label: "Desktop Observe",
    description: "Capture one fresh observation of the exact pinned target. This tool cannot mutate the desktop.",
    parameters: objectSchema({ fresh: { type: "boolean" } }),
		executionMode: "sequential",
    async execute(_id, params, signal) {
      const result = await request("observe", { fresh: params?.fresh !== false }, signal);
      return { content: contentForResult(result), details: { observationId: result.observationId ?? result.screenshotId } };
    },
  });

  pi.registerTool({
    name: "desktop_locate",
    label: "Desktop Locate",
    description: "Resolve elements from the latest observation by semantic role/name/value. Returns ambiguity instead of guessing.",
    parameters: objectSchema({
      role: { type: "string" },
      name: { type: "string" },
      value: { type: "string" },
    }),
		executionMode: "sequential",
    async execute(_id, params, signal) {
      if (!observation) throw new Error("desktop_locate requires desktop_observe first");
      const result = await request("locate", params, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: { status: result.status, bindingId: result.bindingId },
      };
    },
  });

  pi.registerTool({
    name: "desktop_verify",
    label: "Desktop Verify",
    description: "Evaluate a deterministic condition against the latest fresh observation without changing the desktop.",
    parameters: objectSchema({
      kind: { enum: ["visible_text", "element_exists"] },
      text: { type: "string" },
      name: { type: "string" },
    }, ["kind"]),
		executionMode: "sequential",
    async execute(_id, params) {
      if (!observation) throw new Error("desktop_verify requires desktop_observe first");
      const elements = elementsFrom(observation);
      const met = params.kind === "element_exists"
        ? elements.some((element) => String(element.name ?? "") === String(params.name ?? ""))
        : elements.some((element) => [element.name, element.value, element.text]
            .some((value) => String(value ?? "").includes(String(params.text ?? ""))));
      const status = met ? "condition_met" : "condition_not_met";
      return { content: [{ type: "text", text: JSON.stringify({ status }) }], details: { status } };
    },
  });

  if (config.role !== "gui-operator") return;

  pi.registerTool({
    name: "desktop_open_application",
    label: "Desktop Open Application",
    description: "Open or activate one exact application and pin its target through PipiUI Runtime.",
    parameters: objectSchema({
      bundle_identifier: { type: "string" },
      application_name: { type: "string" },
    }),
		executionMode: "sequential",
    async execute(_id, params, signal) {
      const result = await request("openApplication", params, signal);
      return { content: contentForResult(result), details: { target: result.target } };
    },
  });

  pi.registerTool({
    name: "desktop_typeahead",
    label: "Desktop File Type-Ahead",
    description: "Open one exact basename in the current standard macOS Open or Save panel. Call with only the basename after a fresh observation; Host uniquely resolves the current trusted AXList file child, requires its advertised AX open action, opens it, and proves return to the immutable document surface. After success, fresh-observe the document body; do not press an extra Return or substitute ordinary type, double-click, coordinates, the Search field, menus, or sidebar navigation.",
    parameters: objectSchema({
      basename: { type: "string", minLength: 1, maxLength: 255, pattern: "^[A-Za-z0-9._ -]+$" },
    }, ["basename"]),
		executionMode: "sequential",
    async execute(_id, params, signal) {
      const action = {
        type: "typeahead",
        text: params.basename,
      };
      const result = await request("mutate", { actions: [action], semanticBindings: [] }, signal);
      return { content: contentForResult(result), details: { outcomes: result.outcomes, batchOK: result.batchOK } };
    },
  });

  pi.registerTool({
    name: "desktop_act",
    label: "Desktop Act",
    description: "Execute one coherent target-scoped action batch and return a fresh post-action observation.",
    parameters: objectSchema({
      actions: { type: "array", minItems: 1, maxItems: 64, items: desktopModelActionSchema, description: "Closed Cua 0.19.2 generic actions only. Multi-key hotkeys use only keys plus optional x/y or coordinate; never attach element_token, element_index, or snapshot_id to a hotkey. When the fresh exact-window observation reports same_pid_keyboard_ambiguity, Host selects foreground delivery for the exact pinned window; never fall back to menus or sidebar navigation. Reliable keyboard-only file open: send {type:'key',keys:['CMD','O']}, fresh observe, send {type:'key',keys:['CMD','SHIFT','G']}, fresh observe, {type:'type',text:<parent-directory>} then RETURN, fresh observe, call the separate desktop_typeahead tool with only the exact basename; it opens the uniquely proven file child and returns only after Host proves the immutable document surface. Then freshly observe the document body; do not press an extra Return. Ordinary type inserts into a text field and must not substitute for desktop_typeahead. Never type the full file path into Go to Folder. Never invent raise, keychord, menu_click, or other action types." },
      semanticBindings: { type: "array", maxItems: 64, items: objectSchema({ kind: { enum: ["click", "type_parameter"] }, bindingId: { type: "string" } }, ["kind", "bindingId"]) },
    }, ["actions"]),
		executionMode: "sequential",
    async execute(_id, params, signal) {
      const result = await request("mutate", { actions: params.actions, semanticBindings: params.semanticBindings ?? [] }, signal);
      return { content: contentForResult(result), details: { outcomes: result.outcomes, batchOK: result.batchOK } };
    },
  });
}

export default function (pi: PiLike): void {
  registerComputerWorkerTools(pi);
}
