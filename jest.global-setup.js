const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * Jest globalSetup — runs ONCE, in the pristine spawn environment, before any
 * test file loads. Snapshots that clean process.env to a temp file so the
 * per-file env guard (jest.env-guard.js) can restore every test file back to
 * it. This is the fix for the cross-suite env-leak flake: several suites
 * mutate shared process.env (NODE_ENV, ELEVENLABS_*, rate-limit knobs, JWT
 * config) in beforeAll/beforeEach and don't fully restore it, so a later
 * suite inherits the wrong env and its RBAC/rate-limit/flag assertions flip —
 * deterministically under --runInBand, and 2-6 suites at random in parallel.
 */
module.exports = async () => {
  const baseline = JSON.stringify(process.env);
  fs.writeFileSync(path.join(os.tmpdir(), "frank-pilot-jest-env-baseline.json"), baseline);
};
