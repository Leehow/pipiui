import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readManagedServiceState } from "../agent/managed-service.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("managed Headroom lifecycle receipt", () => {
  it("accepts the pinned local service identity", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-headroom-state-"));
    const path = join(root, "service.json");
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      state: "ready",
      engineVersion: "0.37.0",
      baseUrl: "http://127.0.0.1:43123",
    }));
    await expect(readManagedServiceState(path)).resolves.toEqual({
      state: "ready",
      engineVersion: "0.37.0",
      baseUrl: "http://127.0.0.1:43123",
    });
  });

  it("fails closed on a remote endpoint or stale engine version", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-headroom-state-bad-"));
    const path = join(root, "service.json");
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      state: "ready",
      engineVersion: "0.35.0",
      baseUrl: "https://example.com",
    }));
    await expect(readManagedServiceState(path)).resolves.toMatchObject({
      state: "failed",
      error: "managed service state is invalid",
    });
  });
});
