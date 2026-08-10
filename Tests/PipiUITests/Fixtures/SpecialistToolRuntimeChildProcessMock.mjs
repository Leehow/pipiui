export function spawn(...args) {
  const mock = globalThis.__pipiuiSpecialistToolSpawn;
  if (typeof mock !== "function") {
    throw new Error("Specialist runtime harness did not install its child-process mock.");
  }
  return mock(...args);
}
