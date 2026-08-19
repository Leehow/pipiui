export function getAgentDir() {
  return "/tmp/pi-goal-vendor-test-agent";
}

export function defineTool(definition) {
  return definition;
}

export function truncateHead(text, _opts) {
  return String(text);
}

export const DEFAULT_MAX_BYTES = 32_000;
export const DEFAULT_MAX_LINES = 400;
