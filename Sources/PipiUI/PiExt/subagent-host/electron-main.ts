/**
 * Directly executable Electron-main integration helper.
 *
 * It imports only Node and portable subagent-host modules: Electron itself owns
 * BrowserWindow, process spawning, platform/TCC routes, and scheduler commands.
 * The returned spawn specification is intentionally handed to the caller rather
 * than launching a Pi process behind its back.
 */

import { randomBytes } from "node:crypto";
import { decodeHostCapabilitiesV1, type HostCapabilitiesV1 } from "./contract.ts";
import { buildSubagentEnvironmentV1, type SubagentEnvironmentV1 } from "./env.ts";
import {
	createSubagentHostRuntimeV1,
	type SubagentHostRuntimeCallbacksV1,
	type SubagentHostRuntimeOptionsV1,
	type SubagentHostRuntimeStartOptionsV1,
	type SubagentHostRuntimeStartResultV1,
	type SubagentHostRuntimeV1,
} from "./runtime.ts";

export const ELECTRON_MAIN_SUBAGENT_HOST_VERSION = 1 as const;

/** The bridge fields are created only after the real loopback port is known. */
export type ElectronMainHostCapabilitiesTemplateV1 = Omit<HostCapabilitiesV1, "schemaVersion" | "bridge"> & {
	bridge?: Pick<HostCapabilitiesV1["bridge"], "host" | "rpcPath" | "extensions">;
};

export type ElectronMainSpawnSpecV1 = {
	command: string;
	args?: readonly string[];
	cwd?: string;
	/** Do not inherit process.env implicitly; Electron chooses its own process environment. */
	env?: Record<string, string | undefined>;
};

export type ElectronMainPreparedSpawnV1 = {
	command: string;
	args: string[];
	cwd?: string;
	env: Record<string, string>;
};

export type ElectronMainSubagentHostOptionsV1 = {
	/** Inject only for a test or an existing host session; production defaults to 256 random bits. */
	sessionCapability?: string;
	runtime: Omit<SubagentHostRuntimeOptionsV1, "sessionCapability">;
	capabilities: ElectronMainHostCapabilitiesTemplateV1;
	spawn: ElectronMainSpawnSpecV1;
};

export type ElectronMainSubagentHostStartResultV1 = {
	bridge: SubagentHostRuntimeStartResultV1;
	capabilities: HostCapabilitiesV1;
	environment: SubagentEnvironmentV1;
	/** Caller-owned launch request; this helper never spawns, kills, or restarts Pi. */
	spawn: ElectronMainPreparedSpawnV1;
};

export type ElectronMainSubagentHostV1 = {
	sessionCapability: string;
	runtime: SubagentHostRuntimeV1;
	subscribe(callbacks: SubagentHostRuntimeCallbacksV1): () => void;
	start(options?: SubagentHostRuntimeStartOptionsV1): Promise<ElectronMainSubagentHostStartResultV1>;
	stop(): Promise<void>;
};

/** Create an opaque per-session capability without writing it to logs or disk. */
export function createElectronMainSessionCapabilityV1(bytes = 32): string {
	if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 4_096) {
		throw new Error("bytes must be a safe integer between 16 and 4096");
	}
	return randomBytes(bytes).toString("base64url");
}

function definedEnvironment(values: Record<string, string | undefined> | undefined): Record<string, string> {
	const output: Record<string, string> = Object.create(null) as Record<string, string>;
	for (const [key, value] of Object.entries(values ?? {})) {
		if (typeof value === "string") output[key] = value;
	}
	return output;
}

function capabilitiesFor(
	template: ElectronMainHostCapabilitiesTemplateV1,
	sessionCapability: string,
	port: number,
	host: "127.0.0.1" | "::1",
): HostCapabilitiesV1 {
	return {
		schemaVersion: 1,
		...template,
		bridge: {
			port,
			sessionCapability,
			host,
			...(template.bridge?.rpcPath ? { rpcPath: template.bridge.rpcPath } : {}),
			...(template.bridge?.extensions ? { extensions: template.bridge.extensions } : {}),
		},
	};
}

function validatedCapabilities(input: HostCapabilitiesV1): HostCapabilitiesV1 {
	const decoded = decodeHostCapabilitiesV1(input);
	if (!decoded.ok) {
		throw new Error(`invalid Electron host capabilities: ${decoded.diagnostics.map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`);
	}
	return decoded.value;
}

/**
 * Construct a working Electron-main host adapter. Call start(), then pass the
 * returned spawn object to Electron's own child_process integration. Subscribe
 * before start() to receive the initial projection and plan load notifications.
 */
export function createElectronMainSubagentHostV1(options: ElectronMainSubagentHostOptionsV1): ElectronMainSubagentHostV1 {
	const sessionCapability = options.sessionCapability ?? createElectronMainSessionCapabilityV1();
	const runtime = createSubagentHostRuntimeV1({ ...options.runtime, sessionCapability });
	return {
		sessionCapability,
		runtime,
		subscribe: (callbacks) => runtime.subscribe(callbacks),
		async start(startOptions: SubagentHostRuntimeStartOptionsV1 = {}): Promise<ElectronMainSubagentHostStartResultV1> {
			if (typeof options.spawn.command !== "string" || !options.spawn.command.trim()) {
				throw new Error("spawn.command must be a non-empty executable path or command");
			}
			const templateHost = options.capabilities.bridge?.host;
			if (templateHost && startOptions.host && templateHost !== startOptions.host) {
				throw new Error("startOptions.host conflicts with capabilities.bridge.host");
			}
			// A template host selects the actual loopback bind when start() was not given
			// one. Port 1 is only a schema-valid placeholder for an ephemeral request.
			const requestedHost = startOptions.host ?? templateHost ?? "127.0.0.1";
			const requestedPort = startOptions.port === undefined || startOptions.port === 0 ? 1 : startOptions.port;
			const runtimeStartOptions: SubagentHostRuntimeStartOptionsV1 = { ...startOptions, host: requestedHost };
			validatedCapabilities(capabilitiesFor(options.capabilities, sessionCapability, requestedPort, requestedHost));

			const bridge = await runtime.start(runtimeStartOptions);
			const capabilities = validatedCapabilities(capabilitiesFor(options.capabilities, sessionCapability, bridge.port, bridge.host));
			const environment = buildSubagentEnvironmentV1(capabilities);
			if (!environment.ok) {
				throw new Error(`unable to build subagent environment: ${environment.diagnostics.map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`);
			}
			return {
				bridge,
				capabilities,
				environment: environment.value,
				spawn: {
					command: options.spawn.command,
					args: [...(options.spawn.args ?? [])],
					...(options.spawn.cwd ? { cwd: options.spawn.cwd } : {}),
					env: { ...definedEnvironment(options.spawn.env), ...environment.value },
				},
			};
		},
		stop: () => runtime.stop(),
	};
}

/** Convenience one-call start for small Electron-main integrations and tests. */
export async function startElectronMainSubagentHostV1(
	options: ElectronMainSubagentHostOptionsV1,
	startOptions: SubagentHostRuntimeStartOptionsV1 = {},
): Promise<ElectronMainSubagentHostV1 & ElectronMainSubagentHostStartResultV1> {
	const host = createElectronMainSubagentHostV1(options);
	return { ...host, ...(await host.start(startOptions)) };
}
