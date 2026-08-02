import {
  JWTVerifyGetKey,
  createRemoteJWKSet,
  jwtVerify,
} from "jose";

export interface VerifiedAccessIdentity {
  subject: string;
  email?: string;
}

export interface AccessIdentityVerifier {
  verify(assertion: string): Promise<VerifiedAccessIdentity | null>;
}

export class CloudflareAccessJWTVerifier implements AccessIdentityVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly jwks: JWTVerifyGetKey;

  constructor(input: {
    teamDomain: string;
    audience: string;
    jwks?: JWTVerifyGetKey;
  }) {
    const teamDomain = input.teamDomain.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(
      teamDomain,
    )) {
      throw new Error("invalid Cloudflare Access team domain");
    }
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(input.audience)) {
      throw new Error("invalid Cloudflare Access audience");
    }
    this.issuer = `https://${teamDomain}`;
    this.audience = input.audience;
    this.jwks = input.jwks ?? createRemoteJWKSet(
      new URL(`${this.issuer}/cdn-cgi/access/certs`),
      {
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60 * 1_000,
      },
    );
  }

  async verify(assertion: string): Promise<VerifiedAccessIdentity | null> {
    if (assertion.length === 0 || assertion.length > 16_384) return null;
    try {
      const { payload } = await jwtVerify(assertion, this.jwks, {
        algorithms: ["RS256"],
        issuer: this.issuer,
        audience: this.audience,
        requiredClaims: ["exp"],
        clockTolerance: 5,
      });
      if (typeof payload.sub !== "string"
        || payload.sub.length === 0
        || Buffer.byteLength(payload.sub) > 256
        || /[\0\r\n]/.test(payload.sub)) return null;
      const email = typeof payload.email === "string"
        && Buffer.byteLength(payload.email) <= 320
        && !/[\0\r\n]/.test(payload.email)
        ? payload.email.toLowerCase()
        : undefined;
      return {
        subject: `cf:${payload.sub}`,
        ...(email ? { email } : {}),
      };
    } catch {
      return null;
    }
  }
}
