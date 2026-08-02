import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import WebSocket from "ws";
import {
  createTrysteroRelayServer,
  trysteroOptionsFromEnvironment,
} from "../src/trystero-server.js";

test("Trystero product defaults expose only the static page and signaling path", () => {
  const options = trysteroOptionsFromEnvironment({});
  assert.equal(options.publicOrigin, "https://pipi.aichattrpg.com");
  assert.equal(
    options.signalURL,
    "wss://signal.aichattrpg.com/trystero/ws",
  );
  assert.throws(
    () => trysteroOptionsFromEnvironment({
      PIPIUI_RELAY_HOST: "0.0.0.0",
    }),
    /loopback/,
  );
  assert.throws(
    () => trysteroOptionsFromEnvironment({
      PIPIUI_SIGNAL_URL: "wss://signal.aichattrpg.com/device/ws",
    }),
    /trystero/,
  );
});

test("pair page clears the fragment before loading Trystero and has no command API", async () => {
  const instance = createTrysteroRelayServer({
    host: "127.0.0.1",
    port: 0,
    publicOrigin: "http://127.0.0.1",
    signalURL: "ws://127.0.0.1/trystero/ws",
  });
  instance.server.listen(0, "127.0.0.1");
  await once(instance.server, "listening");
  const address = instance.server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const roomID = "21c5b03d-98cf-4da0-8b5c-17a20d557663";
    const response = await fetch(`${origin}/pair/${roomID}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(
      html.indexOf("history.replaceState") <
        html.indexOf('import("/assets/trystero-browser.js")'),
    );
    assert.doesNotMatch(html, /pair\/claim|api\/devices|兼容回退/);
    assert.match(
      response.headers.get("content-security-policy") ?? "",
      /connect-src ws:\/\/127\.0\.0\.1/,
    );
    assert.equal((await fetch(`${origin}/api/index`)).status, 404);
    assert.equal((await fetch(`${origin}/api/pair/claim`)).status, 404);
    assert.equal(
      (await fetch(`${origin}/assets/trystero-browser.js`)).status,
      200,
    );
  } finally {
    await instance.relay.close();
    await new Promise<void>((resolve) => instance.server.close(() => resolve()));
  }
});

test("WebSocket relay accepts only the exact Trystero signaling path", async () => {
  const instance = createTrysteroRelayServer({
    host: "127.0.0.1",
    port: 0,
    publicOrigin: "http://127.0.0.1",
    signalURL: "ws://127.0.0.1/trystero/ws",
  });
  instance.server.listen(0, "127.0.0.1");
  await once(instance.server, "listening");
  const address = instance.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `ws://127.0.0.1:${address.port}`;
  const accepted = new WebSocket(`${base}/trystero/ws`);
  await once(accepted, "open");
  try {
    const rejected = new WebSocket(`${base}/device/ws`);
    const [error] = await once(rejected, "error");
    assert.ok(error instanceof Error);
  } finally {
    accepted.close();
    await instance.relay.close();
    await new Promise<void>((resolve) => instance.server.close(() => resolve()));
  }
});
