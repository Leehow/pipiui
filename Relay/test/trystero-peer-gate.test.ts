import assert from "node:assert/strict";
import test from "node:test";
import { OneTimePeerGate } from "../src/trystero-peer-gate.js";

test("wrong role cannot consume a one-time peer gate", () => {
  const gate = new OneTimePeerGate();
  assert.throws(
    () => gate.reserveBrowser("attacker", { v: 1, role: "host" }),
    /non-browser/,
  );
  gate.reserveBrowser("browser-a", { v: 1, role: "browser" });
  assert.equal(gate.accepts("browser-a"), true);
});

test("reservation is single-use and expiry rejects same-ID reconnect", () => {
  const gate = new OneTimePeerGate();
  gate.reserveBrowser("browser-a", { v: 1, role: "browser" });
  assert.throws(
    () => gate.reserveBrowser("browser-b", { v: 1, role: "browser" }),
    /already used/,
  );
  assert.equal(gate.expire("browser-a"), true);
  assert.equal(gate.accepts("browser-a"), false);
  assert.throws(
    () => gate.reserveBrowser("browser-a", { v: 1, role: "browser" }),
    /already used/,
  );
});
