const childProcessMockURL = new URL(
  "./SpecialistToolRuntimeChildProcessMock.mjs",
  import.meta.url,
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "node:child_process") {
    return { url: childProcessMockURL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
