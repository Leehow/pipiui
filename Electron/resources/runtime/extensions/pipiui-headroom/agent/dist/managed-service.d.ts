export type ManagedServiceState = {
    state: "installing" | "starting" | "ready" | "failed" | "stopped";
    baseUrl: string;
    engineVersion: string;
    error?: string;
};
/**
 * Read the host-owned rendezvous file. It contains no user credentials; it is
 * only a project-local lifecycle/loopback endpoint receipt.
 */
export declare function readManagedServiceState(path: string | undefined, expectedEngineVersion?: string): Promise<ManagedServiceState | undefined>;
