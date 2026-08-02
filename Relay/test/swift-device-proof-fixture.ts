import { readFileSync } from "node:fs";
import { parseDeviceAuthProof } from "../src/protocol.js";

const input = readFileSync(0, "utf8");
const proof = parseDeviceAuthProof(input);
if (!proof) process.exit(2);
process.stdout.write(JSON.stringify({
  accepted: true,
  clientVersionBytes: Buffer.byteLength(proof.clientVersion),
  displayNameBytes: Buffer.byteLength(proof.displayName),
}));
