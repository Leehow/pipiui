export const JEV_PROVIDER = "jev-optimizer" as const;

export const CHANNEL_DISCOVER = "pipiui.retrieval-reranker.discover.v1";
export const CHANNEL_PROVIDE = "pipiui.retrieval-reranker.provide.v1";
export const CHANNEL_WITHDRAW = "pipiui.retrieval-reranker.withdraw.v1";

export const JEV_API_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
export const JEV_DEADLINE_MS = 1500;
export const JEV_POLL_MS = 100;
export const JEV_MAX_CANDIDATES = 64;
export const JEV_MAX_JSON_BYTES = 65536;

export const STATE_FILE_ENV = "PIPIUI_JEV_STATE_FILE";
export const GENERATION_ENV = "PIPIUI_JEV_GENERATION";
export const API_KEY_ENV = "EXT_JEV_OPTIMIZER_APIKEY";

export const SCORE_CRITERIA = [
  "0 irrelevant",
  "1 mention",
  "2 related dependency/test",
  "3 direct implementation",
] as const;
