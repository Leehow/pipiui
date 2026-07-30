import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const [portFile, resultFile, expectedDeviceID] = process.argv.slice(2);
if (!portFile || !resultFile || !expectedDeviceID) process.exit(2);

let finished = false;
const server = new WebSocketServer({
  host: "127.0.0.1",
  port: 0,
  maxPayload: 8 * 1024 * 1024,
});

function finish(result, exitCode = 0) {
  if (finished) return;
  finished = true;
  writeFileSync(resultFile, JSON.stringify(result), { mode: 0o600 });
  server.close(() => process.exit(exitCode));
}

const timeout = setTimeout(() => finish({ ok: false, error: "timeout" }, 1), 10_000);
server.on("listening", () => {
  const address = server.address();
  writeFileSync(portFile, String(address.port), { mode: 0o600 });
});
server.on("connection", (socket) => {
  let helloAccepted = false;
  const requestID = randomUUID();
  socket.on("message", (data, isBinary) => {
    let frame;
    try { frame = JSON.parse(data.toString()); }
    catch { return finish({ ok: false, error: "invalid JSON" }, 1); }
    if (!helloAccepted) {
      if (isBinary) return finish({ ok: false, error: "hello was binary" }, 1);
      if (frame.type !== "hello" || frame.v !== 1 || frame.deviceID !== expectedDeviceID) {
        return finish({ ok: false, error: "invalid hello" }, 1);
      }
      helloAccepted = true;
      socket.send(JSON.stringify({
        v: 1,
        type: "request",
        requestID,
        command: "index",
        deadlineMs: Date.now() + 10_000,
        body: {},
      }));
      return;
    }
    if (isBinary) return finish({ ok: false, error: "response was binary" }, 1);
    if (frame.type !== "response" || frame.requestID !== requestID || frame.status !== 200) {
      return finish({ ok: false, error: "invalid correlated response" }, 1);
    }
    if (!Array.isArray(frame.body?.projects) || !Array.isArray(frame.body?.sessions)) {
      return finish({ ok: false, error: "unexpected index response" }, 1);
    }
    clearTimeout(timeout);
    socket.close();
    finish({ ok: true, helloText: true, responseText: true, correlated: true });
  });
});
process.on("SIGTERM", () => {
  clearTimeout(timeout);
  server.close(() => process.exit(143));
});
