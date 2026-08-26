"use strict";

function binaryPath() {
  return null;
}

async function ensureBinary() {
  throw new Error(
    "PipiUI disables @officecli/officecli auto-download. Architecture binaries arrive in T7 under bin/<platform>-<arch>/officecli.",
  );
}

module.exports = { binaryPath, ensureBinary };
