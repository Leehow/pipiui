import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  Command,
  MAX_PENDING,
  MAX_RESPONSE_BYTES,
  PROTOCOL_VERSION,
  parseResponse,
} from "./protocol.js";

interface Pending {
  epoch: string;
  timer: NodeJS.Timeout;
  resolve: (value: { status: number; body: unknown }) => void;
  reject: (error: Error) => void;
}

export class HostOfflineError extends Error {}
export class HostTimeoutError extends Error {}
export class HostBusyError extends Error {}
export class HostReplacedError extends Error {}

export class HostBroker {
  private socket?: WebSocket;
  private epoch?: string;
  private pending = new Map<string, Pending>();
  private requests = 0;

  replace(socket: WebSocket, epoch: string): void {
    const previous = this.socket;
    this.socket = socket;
    this.epoch = epoch;
    if (previous && previous !== socket) previous.close(4001, "host replaced");
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new HostReplacedError("host epoch replaced"));
      this.pending.delete(id);
    }
  }

  detach(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.epoch = undefined;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new HostOfflineError("host disconnected"));
      this.pending.delete(id);
    }
  }

  isOnline(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  currentEpoch(): string | undefined {
    return this.epoch;
  }

  requestCount(): number {
    return this.requests;
  }

  receive(text: string): void {
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      this.socket?.close(1009, "response too large");
      return;
    }
    const response = parseResponse(text);
    if (!response || response.hostEpoch !== this.epoch) return;
    const pending = this.pending.get(response.requestID);
    if (!pending || pending.epoch !== response.hostEpoch) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.requestID);
    pending.resolve({ status: response.status, body: response.body });
  }

  request(command: Command, body: unknown, timeoutMs = 12_000):
    Promise<{ status: number; body: unknown }> {
    this.requests += 1;
    const socket = this.socket;
    const epoch = this.epoch;
    if (!socket || socket.readyState !== WebSocket.OPEN || !epoch) {
      return Promise.reject(new HostOfflineError("host offline"));
    }
    if (this.pending.size >= MAX_PENDING) {
      return Promise.reject(new HostBusyError("too many pending requests"));
    }
    const requestID = randomUUID();
    const deadlineMs = Date.now() + Math.min(15_000, Math.max(1_000, timeoutMs));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestID);
        reject(new HostTimeoutError("host timeout"));
      }, timeoutMs);
      this.pending.set(requestID, { epoch, timer, resolve, reject });
      socket.send(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "request",
        requestID,
        command,
        deadlineMs,
        body,
      }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(requestID);
        reject(new HostOfflineError("host send failed"));
      });
    });
  }
}
