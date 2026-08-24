/**
 * Generic extension auth + provider/model contribution contract.
 * Host-owned: login/logout/status and credential storage stay outside the
 * extension renderer. Models are never written to models.json here.
 */

import {
  mergeModelCapabilities,
  parseModelCapabilities,
  type ModelCapabilities,
} from "@pipi/host-api";

export const EXTENSION_PROVIDER_ID_RE = /^[a-z][a-z0-9-]*$/;
export const EXTENSION_MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/;

export type ExtensionModelCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** Pi provider `models[]` shape used as the single host-visible model source. */
export type ExtensionProviderModelContribution = {
  id: string;
  name: string;
  api?: string;
  input?: string[];
  reasoning?: boolean;
  capabilities?: ModelCapabilities;
  contextWindow?: number;
  maxTokens?: number;
  cost?: ExtensionModelCost;
  thinkingLevelMap?: Record<string, unknown>;
  compat?: Record<string, unknown>;
};

export type ExtensionProviderContribution = {
  id: string;
  name: string;
  api?: string;
  oauth?: boolean;
  models: ExtensionProviderModelContribution[];
};

export type ExtensionAuthContribution = {
  provider: ExtensionProviderContribution;
};

/** Renderer-visible status. Never includes tokens, keys, or refresh material. */
export type ExtensionAuthStatus = {
  extensionId: string;
  providerId: string;
  loggedIn: boolean;
  usable: boolean;
  expiresAtMs?: number;
  error?: string;
};

export type ExtensionCatalogModel = {
  provider: string;
  id: string;
  name: string;
  api?: string;
  input?: string[];
  reasoning?: boolean;
  capabilities?: ModelCapabilities;
  contextWindow?: number;
  maxTokens?: number;
  cost?: ExtensionModelCost;
  thinkingLevelMap?: Record<string, unknown>;
  compat?: Record<string, unknown>;
};

export type ContributionValidation =
  | { ok: true; contribution: ExtensionAuthContribution }
  | { ok: false; errors: string[] };

const SECRET_STATUS_KEYS = [
  "accessToken",
  "refreshToken",
  "access",
  "refresh",
  "token",
  "apiKey",
  "key",
  "secret",
  "authorization",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseCost(value: unknown): ExtensionModelCost | undefined {
  if (!isRecord(value)) return undefined;
  const input = asFiniteNumber(value.input);
  const output = asFiniteNumber(value.output);
  const cacheRead = asFiniteNumber(value.cacheRead);
  const cacheWrite = asFiniteNumber(value.cacheWrite);
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite };
}

function parseModel(
  value: unknown,
  index: number,
  errors: string[],
): ExtensionProviderModelContribution | undefined {
  if (!isRecord(value)) {
    errors.push(`auth.provider.models[${index}] must be an object`);
    return undefined;
  }
  const id = asNonEmptyString(value.id);
  if (!id) {
    errors.push(`auth.provider.models[${index}] missing id`);
    return undefined;
  }
  if (!EXTENSION_MODEL_ID_RE.test(id)) {
    errors.push(`auth.provider.models[${index}] invalid id '${id}'`);
    return undefined;
  }
  const name = asNonEmptyString(value.name);
  if (!name) {
    errors.push(`auth.provider.models[${index}] missing name`);
    return undefined;
  }
  const model: ExtensionProviderModelContribution = { id, name };
  const api = asNonEmptyString(value.api);
  if (api) model.api = api;
  if (value.input !== undefined) {
    if (!Array.isArray(value.input) || !value.input.every((item) => typeof item === "string" && item.trim())) {
      errors.push(`auth.provider.models[${index}].input must be an array of strings`);
    } else {
      model.input = value.input.map((item) => String(item));
    }
  }
  if (value.reasoning !== undefined) {
    if (typeof value.reasoning !== "boolean") {
      errors.push(`auth.provider.models[${index}].reasoning must be a boolean`);
    } else {
      model.reasoning = value.reasoning;
    }
  }
  if (value.capabilities !== undefined) {
    if (!isRecord(value.capabilities)) {
      errors.push(`auth.provider.models[${index}].capabilities must be an object`);
    } else {
      const parsed = parseModelCapabilities(
        value.capabilities,
        `auth.provider.models[${index}].capabilities`,
      );
      if (!parsed.ok) errors.push(parsed.error);
      else if (parsed.capabilities) model.capabilities = parsed.capabilities;
    }
  }
  if (value.contextWindow !== undefined) {
    const contextWindow = asPositiveInt(value.contextWindow);
    if (contextWindow === undefined) {
      errors.push(`auth.provider.models[${index}].contextWindow must be a positive integer`);
    } else {
      model.contextWindow = contextWindow;
    }
  }
  if (value.maxTokens !== undefined) {
    const maxTokens = asPositiveInt(value.maxTokens);
    if (maxTokens === undefined) {
      errors.push(`auth.provider.models[${index}].maxTokens must be a positive integer`);
    } else {
      model.maxTokens = maxTokens;
    }
  }
  if (value.cost !== undefined) {
    const cost = parseCost(value.cost);
    if (!cost) {
      errors.push(
        `auth.provider.models[${index}].cost must be {input,output,cacheRead,cacheWrite} numbers`,
      );
    } else {
      model.cost = cost;
    }
  }
  if (value.thinkingLevelMap !== undefined) {
    if (!isRecord(value.thinkingLevelMap)) {
      errors.push(`auth.provider.models[${index}].thinkingLevelMap must be an object`);
    } else {
      model.thinkingLevelMap = { ...value.thinkingLevelMap };
    }
  }
  if (value.compat !== undefined) {
    if (!isRecord(value.compat)) {
      errors.push(`auth.provider.models[${index}].compat must be an object`);
    } else {
      model.compat = { ...value.compat };
    }
  }
  return model;
}

/** Parse a manifest `auth` object. Missing auth is not an error (no contribution). */
export function parseExtensionAuthContribution(value: unknown): ContributionValidation | undefined {
  if (value === undefined || value === null) return undefined;
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["auth must be an object"] };
  }
  const providerValue = value.provider;
  if (providerValue === undefined || providerValue === null) {
    return { ok: false, errors: ["auth.provider is required"] };
  }
  if (!isRecord(providerValue)) {
    return { ok: false, errors: ["auth.provider must be an object"] };
  }
  const id = asNonEmptyString(providerValue.id);
  if (!id) errors.push("auth.provider.id is required");
  else if (!EXTENSION_PROVIDER_ID_RE.test(id)) {
    errors.push(`invalid auth.provider.id '${id}': must match [a-z][a-z0-9-]*`);
  }
  const name = asNonEmptyString(providerValue.name);
  if (!name) errors.push("auth.provider.name is required");

  const models: ExtensionProviderModelContribution[] = [];
  if (providerValue.models !== undefined) {
    if (!Array.isArray(providerValue.models)) {
      errors.push("auth.provider.models must be an array");
    } else {
      const seen = new Set<string>();
      for (const [index, raw] of providerValue.models.entries()) {
        const model = parseModel(raw, index, errors);
        if (!model) continue;
        if (seen.has(model.id)) {
          errors.push(`duplicate model id '${model.id}' on provider '${id ?? ""}'`);
          continue;
        }
        seen.add(model.id);
        models.push(model);
      }
    }
  }

  if (providerValue.api !== undefined && typeof providerValue.api !== "string") {
    errors.push("auth.provider.api must be a string");
  }
  if (providerValue.oauth !== undefined && typeof providerValue.oauth !== "boolean") {
    errors.push("auth.provider.oauth must be a boolean");
  }

  if (errors.length) return { ok: false, errors };
  const provider: ExtensionProviderContribution = {
    id: id!,
    name: name!,
    models,
  };
  const api = asNonEmptyString(providerValue.api);
  if (api) provider.api = api;
  if (typeof providerValue.oauth === "boolean") provider.oauth = providerValue.oauth;
  return { ok: true, contribution: { provider } };
}

export type ContributionClaim = {
  extensionId: string;
  enabled: boolean;
  contribution: ExtensionAuthContribution;
};

export type ContributionCollision = {
  extensionId: string;
  errors: string[];
};

/**
 * Provider/model IDs are owned by at most one enabled extension.
 * Disabled packages may declare the same ids; they do not claim them.
 */
export function detectContributionCollisions(claims: readonly ContributionClaim[]): ContributionCollision[] {
  const providerOwners = new Map<string, string>();
  const modelOwners = new Map<string, string>();
  const errors = new Map<string, string[]>();
  const add = (extensionId: string, message: string) => {
    const list = errors.get(extensionId) ?? [];
    list.push(message);
    errors.set(extensionId, list);
  };

  for (const claim of claims) {
    if (!claim.enabled) continue;
    const providerId = claim.contribution.provider.id;
    const existingProvider = providerOwners.get(providerId);
    if (existingProvider && existingProvider !== claim.extensionId) {
      add(
        claim.extensionId,
        `provider id '${providerId}' already contributed by '${existingProvider}'`,
      );
      add(
        existingProvider,
        `provider id '${providerId}' already contributed by '${claim.extensionId}'`,
      );
      continue;
    }
    providerOwners.set(providerId, claim.extensionId);
    for (const model of claim.contribution.provider.models) {
      const key = `${providerId}/${model.id}`;
      const existingModel = modelOwners.get(key);
      if (existingModel && existingModel !== claim.extensionId) {
        add(claim.extensionId, `model '${key}' already contributed by '${existingModel}'`);
        add(existingModel, `model '${key}' already contributed by '${claim.extensionId}'`);
        continue;
      }
      modelOwners.set(key, claim.extensionId);
    }
  }

  return [...errors.entries()].map(([extensionId, messages]) => ({
    extensionId,
    errors: messages,
  }));
}

export function contributionOwnsProvider(
  claims: readonly ContributionClaim[],
  providerId: string,
): string | undefined {
  for (const claim of claims) {
    if (claim.contribution.provider.id === providerId) return claim.extensionId;
  }
  return undefined;
}

export function reservedProviderClaimError(
  providerId: string,
  reserved: ReadonlySet<string>,
): string | undefined {
  if (reserved.has(providerId)) {
    return `provider id '${providerId}' is reserved by the host`;
  }
  return undefined;
}

function modelKey(provider: string, id: string): string {
  return `${provider}/${id}`;
}

function ownerByProvider(claims: readonly ContributionClaim[]): Map<string, ContributionClaim> {
  const owners = new Map<string, ContributionClaim>();
  for (const claim of claims) {
    const providerId = claim.contribution.provider.id;
    const existing = owners.get(providerId);
    if (!existing || (claim.enabled && !existing.enabled)) {
      owners.set(providerId, claim);
    }
  }
  return owners;
}

/**
 * Build the host-visible overlay from enabled, authenticated, non-colliding
 * contributions. Existing catalog entries (configured + Pi runtime) win so the
 * Pi provider `models` contract stays the single source when present.
 */
export function resolveContributedCatalog(input: {
  claims: readonly ContributionClaim[];
  authenticatedProviders: ReadonlySet<string>;
  existing: readonly { provider: string; id: string }[];
}): { models: ExtensionCatalogModel[]; suppressedProviders: Set<string> } {
  const collisions = new Set(detectContributionCollisions(input.claims).map((item) => item.extensionId));
  const existingKeys = new Set(input.existing.map((model) => modelKey(model.provider, model.id)));
  const suppressedProviders = new Set<string>();
  const models: ExtensionCatalogModel[] = [];

  for (const claim of input.claims) {
    const providerId = claim.contribution.provider.id;
    const active =
      claim.enabled &&
      !collisions.has(claim.extensionId) &&
      input.authenticatedProviders.has(providerId);
    if (!active) {
      if (providerId) suppressedProviders.add(providerId);
      continue;
    }
    for (const model of claim.contribution.provider.models) {
      const key = modelKey(providerId, model.id);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      models.push({
        provider: providerId,
        id: model.id,
        name: model.name,
        ...(model.api ? { api: model.api } : {}),
        ...(model.input ? { input: model.input } : {}),
        ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
        ...(model.capabilities ? { capabilities: model.capabilities } : {}),
        ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
        ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
        ...(model.cost ? { cost: model.cost } : {}),
        ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
        ...(model.compat ? { compat: model.compat } : {}),
      });
    }
  }

  return { models, suppressedProviders };
}

function activeContributionClaims(
  claims: readonly ContributionClaim[],
  authenticatedProviders: ReadonlySet<string>,
): ContributionClaim[] {
  const collisions = new Set(detectContributionCollisions(claims).map((item) => item.extensionId));
  return claims.filter((claim) => (
    claim.enabled
    && !collisions.has(claim.extensionId)
    && authenticatedProviders.has(claim.contribution.provider.id)
  ));
}

/**
 * Attach declared capabilities onto runtime/configured catalog rows that already
 * own the same provider/id. Runtime `nativeSearch` wins when both declare it.
 */
export function mergeContributedModelCapabilities<T extends {
  provider: string;
  id: string;
  capabilities?: ModelCapabilities;
}>(
  models: readonly T[],
  input: {
    claims: readonly ContributionClaim[];
    authenticatedProviders: ReadonlySet<string>;
  },
): T[] {
  const byKey = new Map<string, ModelCapabilities>();
  for (const claim of activeContributionClaims(input.claims, input.authenticatedProviders)) {
    for (const model of claim.contribution.provider.models) {
      if (!model.capabilities) continue;
      byKey.set(modelKey(claim.contribution.provider.id, model.id), model.capabilities);
    }
  }
  if (!byKey.size) return [...models];
  return models.map((model) => {
    const contributed = byKey.get(modelKey(model.provider, model.id));
    if (!contributed) return model;
    const capabilities = mergeModelCapabilities(contributed, model.capabilities);
    return capabilities ? { ...model, capabilities } : model;
  });
}

/**
 * A contributed provider's models stay in the picker only while the owning
 * extension is enabled and authenticated. Official/configured providers that
 * no extension claims are left untouched.
 */
export function filterCatalogByContributions<T extends { provider: string; id: string }>(
  models: readonly T[],
  input: {
    claims: readonly ContributionClaim[];
    authenticatedProviders: ReadonlySet<string>;
  },
): T[] {
  const collisions = new Set(detectContributionCollisions(input.claims).map((item) => item.extensionId));
  const owners = ownerByProvider(input.claims);
  return models.filter((model) => {
    const owner = owners.get(model.provider);
    if (!owner) return true;
    return (
      owner.enabled &&
      !collisions.has(owner.extensionId) &&
      input.authenticatedProviders.has(model.provider)
    );
  });
}

export function extensionAuthStatus(input: {
  extensionId: string;
  providerId: string;
  enabled: boolean;
  loggedIn: boolean;
  expiresAtMs?: number;
  error?: string;
}): ExtensionAuthStatus {
  const status: ExtensionAuthStatus = {
    extensionId: input.extensionId,
    providerId: input.providerId,
    loggedIn: input.loggedIn,
    usable: input.enabled && input.loggedIn && !input.error,
  };
  if (input.expiresAtMs !== undefined) status.expiresAtMs = input.expiresAtMs;
  if (input.error) status.error = input.error;
  return status;
}

/** True when a status object leaked a credential-shaped key. */
export function authStatusContainsSecrets(status: unknown): boolean {
  if (!isRecord(status)) return false;
  const keys = Object.keys(status);
  return keys.some((key) =>
    SECRET_STATUS_KEYS.some((secret) => key.toLowerCase() === secret.toLowerCase()),
  );
}

export function redactAuthStatus<T extends Record<string, unknown>>(status: T): ExtensionAuthStatus {
  return {
    extensionId: String(status.extensionId ?? ""),
    providerId: String(status.providerId ?? ""),
    loggedIn: Boolean(status.loggedIn),
    usable: Boolean(status.usable),
    ...(typeof status.expiresAtMs === "number" ? { expiresAtMs: status.expiresAtMs } : {}),
    ...(typeof status.error === "string" && status.error ? { error: status.error } : {}),
  };
}
