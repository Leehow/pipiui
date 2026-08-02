import WebSocket from "ws";
import { HostBroker } from "./broker.js";

export class DeviceBrokerRegistry {
  private readonly brokers = new Map<string, HostBroker>();

  broker(deviceID: string): HostBroker {
    let broker = this.brokers.get(deviceID);
    if (!broker) {
      broker = new HostBroker();
      this.brokers.set(deviceID, broker);
    }
    return broker;
  }

  attach(deviceID: string, socket: WebSocket, hostEpoch: string): HostBroker {
    const broker = this.broker(deviceID);
    broker.replace(socket, hostEpoch);
    return broker;
  }

  detach(deviceID: string, socket: WebSocket): void {
    this.brokers.get(deviceID)?.detach(socket);
  }

  online(deviceID: string): boolean {
    return this.brokers.get(deviceID)?.isOnline() ?? false;
  }
}
