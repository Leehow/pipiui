import assert from "node:assert/strict";
import { generateKeyPair } from "node:crypto";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
} from "jose";
import { CloudflareAccessJWTVerifier } from "../src/access.js";

const generateKeyPairAsync = promisify(generateKeyPair);
const issuer = "https://example.cloudflareaccess.com";
const audience = "0123456789abcdef0123456789abcdef";

async function signingFixture() {
  const { publicKey, privateKey } = await generateKeyPairAsync("rsa", {
    modulusLength: 2048,
  });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  return {
    privateKey,
    verifier: new CloudflareAccessJWTVerifier({
      teamDomain: "example.cloudflareaccess.com",
      audience,
      jwks: createLocalJWKSet({ keys: [jwk] }),
    }),
  };
}

async function token(
  privateKey: Awaited<ReturnType<typeof signingFixture>>["privateKey"],
  overrides: {
    sub?: string;
    issuer?: string;
    audience?: string;
    expiresAt?: number;
    omitExpiration?: boolean;
    rawExpiration?: unknown;
    id?: string;
  } = {},
) {
  const now = Math.floor(Date.now() / 1_000);
  let builder = new SignJWT({
    email: "User@Example.Test",
    ...(overrides.rawExpiration !== undefined
      ? { exp: overrides.rawExpiration as number }
      : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject(overrides.sub ?? "stable-user-id")
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? audience)
    .setIssuedAt(now)
    .setJti(overrides.id ?? "token-1");
  if (!overrides.omitExpiration && overrides.rawExpiration === undefined) {
    builder = builder.setExpirationTime(overrides.expiresAt ?? now + 60);
  }
  return builder.sign(privateKey);
}

test("verified renewed Access JWTs preserve the stable sub binding", async () => {
  const fixture = await signingFixture();
  const first = await fixture.verifier.verify(await token(
    fixture.privateKey,
    { id: "token-1" },
  ));
  const renewed = await fixture.verifier.verify(await token(
    fixture.privateKey,
    { id: "token-2" },
  ));
  assert.deepEqual(first, {
    subject: "cf:stable-user-id",
    email: "user@example.test",
  });
  assert.deepEqual(renewed, first);
});

test("Access verifier rejects wrong signature issuer and audience", async () => {
  const fixture = await signingFixture();
  const attacker = await signingFixture();
  assert.equal(await fixture.verifier.verify(await token(
    attacker.privateKey,
  )), null);
  assert.equal(await fixture.verifier.verify(await token(
    fixture.privateKey,
    { issuer: "https://evil.cloudflareaccess.com" },
  )), null);
  assert.equal(await fixture.verifier.verify(await token(
    fixture.privateKey,
    { audience: "ffffffffffffffffffffffffffffffff" },
  )), null);
});

test("Access verifier requires a numeric unexpired exp claim", async () => {
  const fixture = await signingFixture();
  assert.equal(await fixture.verifier.verify(await token(
    fixture.privateKey,
    { expiresAt: Math.floor(Date.now() / 1_000) - 60 },
  )), null);
  assert.equal(await fixture.verifier.verify(await token(
    fixture.privateKey,
    { omitExpiration: true },
  )), null);
  assert.equal(await fixture.verifier.verify(await token(
    fixture.privateKey,
    { rawExpiration: "tomorrow" },
  )), null);
});

test("Access verifier configuration fails closed", () => {
  assert.throws(() => new CloudflareAccessJWTVerifier({
    teamDomain: "https://example.cloudflareaccess.com",
    audience,
  }), /team domain/);
  assert.throws(() => new CloudflareAccessJWTVerifier({
    teamDomain: "example.cloudflareaccess.com",
    audience: "short",
  }), /audience/);
});
