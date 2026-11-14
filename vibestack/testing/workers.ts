// The Worker a journey or a conformance driver talks to (.claude/skills/shell/SKILL.md, "On Cloudflare Workers"): the
// deployed one at DEPLOY_URL when the release train runs a gate, otherwise the package's own under `wrangler dev`,
// which builds it first (wrangler.jsonc, "build").
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Worker extends AsyncDisposable {
  /** Where it answers, without a trailing slash. */
  url: string;
  /** Whether this is the deployed Worker at DEPLOY_URL, whose storage a test must not assume is empty. */
  deployed: boolean;
}

export interface Local {
  /** The wrangler config, from the package directory. */
  config?: string;
  /** Where its Durable Objects keep their storage: give the same directory to start it again over the same state. */
  persist?: string;
}

const READY = /Ready on (http:\/\/[^\s]+)/;
const STARTS_WITHIN = 120_000;

/** A new directory for a Worker's storage, to start it again over (`persist`). */
export function stateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "worker-state-"));
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** The Worker of the package in `dir` (a path, or a file URL such as `new URL("..", import.meta.url)`): DEPLOY_URL's if set, else started here, and stopped when disposed. */
export async function worker(at: string | URL, { config = "wrangler.jsonc", persist }: Local = {}): Promise<Worker> {
  const dir = at instanceof URL ? fileURLToPath(at) : at;
  const deployed = process.env.DEPLOY_URL;
  if (deployed) return { url: deployed.replace(/\/+$/, ""), deployed: true, [Symbol.asyncDispose]: async () => {} };
  const state = persist ?? stateDir();
  const bin = path.join(path.dirname(createRequire(path.join(dir, "package.json")).resolve("wrangler/package.json")), "bin/wrangler.js");
  const child = spawn(process.execPath, [bin, "dev", "-c", config, "--ip", "127.0.0.1", "--port", String(await freePort()),
    "--persist-to", state, "--show-interactive-dev-session=false", "--log-level", "info"], {
    cwd: dir, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  let said = "";
  const exited = new Promise<void>((resolve) => child.on("close", () => resolve()));
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`wrangler dev did not start within ${STARTS_WITHIN / 1000} s:\n${said.slice(-4000)}`)), STARTS_WITHIN);
    const hear = (data: Buffer) => {
      said += data.toString();
      const ready = READY.exec(said);
      if (ready) { clearTimeout(timer); resolve(ready[1].replace(/\/+$/, "")); }
    };
    child.stdout.on("data", hear);
    child.stderr.on("data", hear);
    child.on("close", (code) => { clearTimeout(timer); reject(new Error(`wrangler dev exited with ${code}:\n${said.slice(-4000)}`)); });
  }).catch(async (error: unknown) => { stop(child.pid, "SIGKILL"); await exited; throw error; });
  return {
    url, deployed: false,
    [Symbol.asyncDispose]: async () => {
      stop(child.pid, "SIGTERM");
      const timer = setTimeout(() => stop(child.pid, "SIGKILL"), 5000);
      await exited;
      clearTimeout(timer);
      if (!persist) fs.rmSync(state, { recursive: true, force: true });
    },
  };
}

/** The whole process group: wrangler, its esbuild and workerd. */
function stop(pid: number | undefined, signal: NodeJS.Signals) {
  try { if (pid) process.kill(process.platform === "win32" ? pid : -pid, signal); } catch { /* already gone */ }
}
