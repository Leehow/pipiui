import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ComputerWorkerBroker,
  type ComputerWorkerRole,
  type IssuedComputerWorkerGrant,
} from "./worker-broker.ts";

const MAX_BODY_BYTES = 256 * 1024;
const ENDPOINT = "/v1/computer-worker";

async function readJSON(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error("computer worker broker request is too large");
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("computer worker broker request must be an object");
  }
  return parsed as Record<string, unknown>;
}

export class ComputerWorkerBrokerServer {
  readonly #broker: ComputerWorkerBroker;
  #server?: Server;
  #url?: string;

  constructor(broker: ComputerWorkerBroker) {
    this.#broker = broker;
  }

  async start(): Promise<string> {
    if (this.#url) return this.#url;
    const server = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method !== "POST" || request.url !== ENDPOINT) {
        response.statusCode = 404;
        response.end(JSON.stringify({ ok: false, error: "not_found" }));
        return;
      }
      try {
        const body = await readJSON(request);
        const token = typeof body.token === "string" ? body.token : "";
        const operation = body.operation;
        const payload = body.payload;
        if (
          !token
          || !["observe", "locate", "mutate", "openApplication"].includes(String(operation))
          || !payload
          || typeof payload !== "object"
          || Array.isArray(payload)
        ) {
          response.statusCode = 400;
          response.end(JSON.stringify({ ok: false, error: "invalid_request" }));
          return;
        }
        const result = await this.#broker.execute(token, {
          operation: operation as "observe" | "locate" | "mutate" | "openApplication",
          payload: payload as Record<string, unknown>,
        });
        response.statusCode = 200;
        response.end(JSON.stringify(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        response.statusCode = /does not grant|forbidden broker/.test(message) ? 403 : /unknown or revoked/.test(message) ? 401 : 500;
        response.end(JSON.stringify({ ok: false, error: message }));
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.#server = server;
    const address = server.address() as AddressInfo;
    this.#url = `http://127.0.0.1:${address.port}${ENDPOINT}`;
    return this.#url;
  }

  issue(input: {
    taskId: string;
    stepId: string;
    runId: string;
    role: ComputerWorkerRole;
  }): IssuedComputerWorkerGrant {
    if (!this.#url) throw new Error("computer worker broker server is not started");
    const issued = this.#broker.issue(input);
    return {
      ...issued,
      environment: {
        ...issued.environment,
        PIPIUI_COMPUTER_WORKER_BROKER_URL: this.#url,
      },
    };
  }

  revokeStep(taskId: string, stepId: string): void {
    this.#broker.revokeStep(taskId, stepId);
  }

  consumeExecutions(taskId: string, stepId: string) {
    return this.#broker.consumeExecutions(taskId, stepId);
  }
  observation(taskId: string, stepId: string) { return this.#broker.observation(taskId, stepId); }

  revokeTask(taskId: string): void {
    this.#broker.revokeTask(taskId);
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    this.#url = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}
