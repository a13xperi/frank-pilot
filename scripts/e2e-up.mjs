#!/usr/bin/env node
// e2e-up.mjs — boot the full stack for Playwright-driven feature tests.
//
// 1. Docker Postgres (idempotent — reuses an existing container if up).
// 2. npm run migrate + npm run seed (always — fast and ensures the
//    applicantA fixture user exists).
// 3. API on :3002 (matches the vite proxy default).
// 4. Vite dev server on :5174.
// 5. Wait for /health (API) + Vite root before printing READY.
//
// Idempotent: if a port is already busy, reuses the existing process and
// skips the spawn. Playwright's webServer.reuseExistingServer flag handles
// the rest. Pass --once to exit after READY (Playwright will manage the
// child stack itself in CI follow-ups).

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import net from "node:net";
import http from "node:http";
import process from "node:process";

const ONCE = process.argv.includes("--once");
const API_PORT = Number(process.env.API_PORT ?? 3002);
// Default to 5175 so the harness coexists with a normal `npm run dev` (which
// claims 5174). Bump via `VITE_PORT=5174 npm run e2e:up` if you actually want
// to share the main dev server.
const VITE_PORT = Number(process.env.VITE_PORT ?? 5175);
const VITE_BASE = `http://127.0.0.1:${VITE_PORT}`;
const API_BASE = `http://127.0.0.1:${API_PORT}`;

// Auto-discover a local (non-docker) Postgres when neither DATABASE_URL nor
// DB_USER is set and there's no committed env. Lets us reuse a Homebrew /
// Postgres.app install without forcing developers to add a docker layer.
const DB_ENV = {};
if (!process.env.DATABASE_URL && !process.env.DB_USER && !existsSync(".env")) {
  DB_ENV.DB_HOST = "localhost";
  DB_ENV.DB_PORT = "5432";
  DB_ENV.DB_NAME = process.env.DB_NAME ?? "frank_pilot";
  DB_ENV.DB_USER = userInfo().username;
}

const children = [];
let shuttingDown = false;

function log(prefix, line) {
  process.stdout.write(`[${prefix}] ${line}\n`);
}

function isPortBusy(port) {
  // Probe by *connecting* rather than trying to bind. macOS lets a
  // 127.0.0.1-only bind succeed when another process holds the wildcard
  // address on the same port, so the bind-and-release trick gives false
  // negatives. A successful connect is the truthful signal.
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (busy) => {
      sock.destroy();
      resolve(busy);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(800, () => done(false));
    sock.connect(port, "127.0.0.1");
  });
}

function httpOk(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve(true);
        else retry();
      });
      req.on("error", retry);
      req.setTimeout(1500, () => req.destroy(new Error("timeout")));
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error(`timeout waiting for ${url}`));
      else setTimeout(tick, 400);
    };
    tick();
  });
}

function spawnChild(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...(opts.env ?? {}) },
    cwd: opts.cwd ?? process.cwd(),
    detached: ONCE,
  });
  child.stdout.on("data", (b) => process.stdout.write(`[${name}] ${b}`));
  child.stderr.on("data", (b) => process.stderr.write(`[${name}] ${b}`));
  child.on("exit", (code, sig) => {
    if (!shuttingDown) {
      log(name, `exited code=${code} signal=${sig}`);
      shutdown(code ?? 1);
    }
  });
  children.push({ name, child });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 200).unref();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function ensurePostgres() {
  // Prefer whatever Postgres the developer already has on :5432 (local
  // Homebrew pg, OrbStack, Docker — anything goes). Falls back to docker
  // compose only if nothing is listening.
  const pgUp = await isPortBusy(5432);
  if (pgUp) {
    log("e2e-up", "postgres reachable on :5432 — reusing");
    return;
  }
  const dockerCheck = spawnSync("docker", ["--version"], { stdio: "ignore" });
  if (dockerCheck.status !== 0) {
    throw new Error(
      "no postgres on :5432 and docker is not installed; start Postgres first."
    );
  }
  const res = spawnSync("docker", ["compose", "up", "-d", "postgres"], {
    stdio: "inherit",
  });
  if (res.status !== 0) {
    throw new Error("docker compose up postgres failed (is Docker running?)");
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isPortBusy(5432)) return;
    await new Promise((r2) => setTimeout(r2, 500));
  }
  throw new Error("postgres did not become ready within 30s");
}

async function runMigrateAndSeed() {
  // `npm run migrate` is now the single provisioning path: it runs the
  // idempotent base schema AND applies any pending tracked deltas
  // (src/db/migrate.ts). Safe on both a fresh DB and a long-lived dev DB —
  // so we always just call it, no fork on whether the schema pre-exists.
  const r = spawnSync("npm", ["run", "migrate"], {
    stdio: "inherit",
    env: { ...process.env, ...DB_ENV },
  });
  if (r.status !== 0) throw new Error("npm run migrate failed");

  const s = spawnSync("npm", ["run", "seed"], {
    stdio: "inherit",
    env: { ...process.env, ...DB_ENV },
  });
  if (s.status !== 0) throw new Error("npm run seed failed");
}

async function main() {
  log("e2e-up", `target ports: api=${API_PORT} vite=${VITE_PORT}`);

  await ensurePostgres();
  await runMigrateAndSeed();

  const apiBusy = await isPortBusy(API_PORT);
  const viteBusy = await isPortBusy(VITE_PORT);

  if (apiBusy) {
    log("e2e-up", `port ${API_PORT} already in use — reusing existing API`);
  } else {
    spawnChild("api", "npm", ["run", "dev"], {
      env: { PORT: String(API_PORT), NODE_ENV: "development", ...DB_ENV },
    });
  }

  if (viteBusy) {
    log("e2e-up", `port ${VITE_PORT} already in use — reusing existing Vite`);
  } else {
    // `npm run dev -- --port N --host 127.0.0.1` so we can run alongside a
    // normal dev server on 5174 without colliding, and so the health probe
    // (which polls 127.0.0.1) hits the right interface — vite's default
    // `localhost` host can resolve to ::1 only on macOS.
    spawnChild(
      "vite",
      "npm",
      ["run", "dev", "--", "--port", String(VITE_PORT), "--host", "127.0.0.1"],
      {
        cwd: "client-tenant",
        env: { VITE_API_PROXY_TARGET: API_BASE },
      }
    );
  }

  await httpOk(`${API_BASE}/health`);
  log("e2e-up", `api ready at ${API_BASE}/health`);
  await httpOk(`${VITE_BASE}/`);
  log("e2e-up", `vite ready at ${VITE_BASE}/`);

  process.stdout.write(
    `\nREADY — base=${VITE_BASE} api=${API_BASE} — see client-tenant/e2e/README.md\n\n`
  );

  if (ONCE) {
    // Detach children so they survive this exit. Playwright connects to
    // them via reuseExistingServer:true.
    for (const { child } of children) child.unref();
    children.length = 0;
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("[e2e-up] fatal:", err.message);
  shutdown(1);
});
