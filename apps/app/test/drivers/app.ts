// SPEC.md, "Conformance": spec/app/index.md against the Worker of src/worker.vibe, through its HTTP API, the Durable
// Objects and their storage: under `wrangler dev`, or the deployed Worker at DEPLOY_URL when the release train gates a
// deploy (.deploy/manifest.json), where the network allows only a few walks.
import { worker } from "vibestack/testing/workers";
import type { Driver, Options } from "../../gen/app.conformance.ts";
import type { Greeter } from "../../gen/app.ts";

const running = await worker(new URL("../..", import.meta.url));
/** Each reset is a fresh set of greeters: keys no earlier run used. */
const run = `conformance-${Date.now()}`;
let fresh = 0;
const at = (key: string) => `${running.url}/api/app/${run}-${fresh}-${key}`;

/** What the Worker did with `body`: 400 and 409 are its refusals (vibestack/cloudflare, `machineApi`); anything else but 200 is a failure. */
async function send(key: string, body: string | undefined) {
  const answer = await fetch(at(key), { method: "POST", headers: { "content-type": "application/json" }, body });
  if (answer.status === 200) return "accepted" as const;
  if (answer.status === 400 || answer.status === 409) return "refused" as const;
  throw new Error(`POST ${at(key)}: ${answer.status} ${await answer.text()}`);
}

export const driver: Driver & AsyncDisposable = {
  reset: () => { fresh++; },
  dispatch: (key, event) => send(key, JSON.stringify(event)),
  receive: (key, raw) => send(key, JSON.stringify(raw)),
  async observe(key) {
    const answer = await fetch(at(key));
    if (!answer.ok) throw new Error(`GET ${at(key)}: ${answer.status} ${await answer.text()}`);
    return await answer.json() as Greeter;
  },
  [Symbol.asyncDispose]: () => running[Symbol.asyncDispose](),
};

/** One greeter per key; two keys, so that one leaking into another shows. */
export const options: Options = { keys: ["ada", "grace"], ...running.deployed ? { walks: 20 } : {} };
