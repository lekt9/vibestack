---
name: shell
description: "Write the code around the generated core: read before writing or changing anything in `src/` or a test, in VibeLang (`.vibe`) or React (`.tsx`), and before importing `gen/<name>.effect.vibe`, building or running the application."
---

# The VibeLang shell

The shell around the generated code is
[VibeLang](https://github.com/smithersai/vibelang): `.vibe` files, TypeScript
syntax over [Effect](https://effect.website) 4, in which a function's type
says what it fails with and which services it needs. Every package depends on
the `vibelang` compiler: `types` runs `vibelang --noEmit -p .`, which checks
`.vibe`, `.ts` and `.tsx` as one program, and `gen` writes
`gen/<name>.effect.vibe` beside each `gen/<name>.ts`.

**Before writing any**, read the skill the compiler ships,
`node_modules/vibelang/skills/vibelang/SKILL.md`. The language is new: look
syntax and Effect APIs up, and compile often.

## The Effect adapter

`gen/<name>.effect.vibe` is `gen/<name>.ts` for effect code. Import it in
place of the `.ts` module: `"../gen/index.effect.vibe"`.

| It exports | Which is |
|---|---|
| every type of `gen/<name>.ts` | the same types |
| its constants and functions, under their own names: `initial`, `step`, `enabled`, `parseEvent`, your guards, helpers and rules | the same, declared to throw nothing, so effect code calls them bare: `canPay(order, 5)`. The compiler refuses that call (EK0403) when the function is imported from `gen/<name>.ts` |

and for a state machine, with `[, by]`, `NotASender` and `decodeSender` only
when the spec has a sender:

| It exports | Which is |
|---|---|
| `error Rejected { event, state[, by] }` | the rules do not allow this event in this state |
| `error NotAnEvent { input }`, `NotAState { input }`, `NotASender { input }` | an untrusted value that is not one |
| `decodeEvent(input)`, `decodeState(input)`, `decodeSender(input)` | `parseEvent`, `parseState` and `parseSender`, failing where they return `undefined` |
| `apply(current, event[, by])` | `step`, failing with `Rejected` where `enabled` refuses instead of leaving the state unchanged |
| `service Machine` | the state and the one way to change it: `get()`, `send(event[, by])`, `receive(input[, by])` for an untrusted event (`decodeEvent`, then `send`), and `changes`, a `Stream` of the state, starting with the current one |
| `machine(start = initial)` | a `Layer` that provides `Machine` in memory, applying one event at a time; `start` may be a state `decodeState` returned |

Where transitions return `{ state, out }`, `apply`, `send` and `receive`
return that record; `get` and `changes` give the state.

A shell and its test, on the order example's spec:

```vibe
// src/app.vibe
import { Machine, NotAnEvent, Rejected, canSubmit } from "../gen/index.effect.vibe"

/** What to tell the sender of an untrusted input. Needs a Machine, which the caller provides. */
export effect function answer(input: unknown) {
  const orders = try Machine
  return effect {
    const order = try orders.receive(input) // decodeEvent, then apply: the state changes only if both pass
    return canSubmit(order) ? "ready to submit" : order.status // a guard of the spec, called bare
  } catch (error) => match (error) {
    when NotAnEvent: "not an event";
    when Rejected: `${error.event.type} is not allowed for a ${error.state.status} order`;
  }
}
```

```vibe
// test/app.test.vibe
// spec/index.md, "Story: Check out"
import { assert, it } from "@effect/vitest"
import { machine } from "../gen/index.effect.vibe"
import { answer } from "../src/app.vibe"

it.effect("Check out", effect () => {
  provide machine() {
    const said = [try answer({ type: "addItem", qty: 2 }), try answer({ type: "pay", amount: 1 }), try answer("pay")]
    try Effect.try(() => assert.deepStrictEqual(said, ["ready to submit", "pay is not allowed for a Draft order", "not an event"]))
  }
})
```

- **`machine()` forgets when the process ends.** A shell that stores state
  writes its own service on `apply` and the decoders, and a driver that
  `check` compares with the spec ([SPEC.md, "Conformance"](../../../SPEC.md#conformance)):
  `check` writes one to fill in when `src/` imports `apply`.
- **Match an event by its `type`**: `match (event.type) { when "pay": …; }`.
  The compiler does not yet check that a `match` on the event itself, or on
  a variant by its `tag`, covers every case.
- **A `.vibe` file reaches the platform through Effect**, not through
  `node:*` imports, `console`, `fetch` or the DOM: an Effect service
  (`Console`, `FileSystem`, `HttpClient`, …), a `module node { … }` body in
  the file, or a thin `.ts` file beside it.
- **`//@` files stay `.ts`** ([prove skill](../prove/SKILL.md)). Effect code
  calls one through a `module` body that says what its functions throw.

## The React interface

Components are `.tsx` under `src/`, built with Vite. A component reads the
state and sends events through hooks over the `Machine` service, so what it
shows is the spec's state and what it can do is what `enabled` allows: a
control is offered exactly when its event is. It keeps in `useState` only
what the spec does not own, such as an open menu or a draft in a text box.
Style with Tailwind utilities on the project's tokens, compose shadcn/ui
components before writing one, and follow the
[design skill](../design/SKILL.md).

## On Cloudflare Workers

An application runs as a Worker (workerd, `nodejs_compat`), deployed only by
the release train (`.deploy/manifest.json`). The platform is
`vibestack/cloudflare` (`vibestack/cloudflare/workers.vibe`); the shell's own
services do not change, so `gen/`'s machine and the spec stay the one model.
`apps/app` is the worked example.

| It exports | Which is |
|---|---|
| `durableStore(storage)` | a `KeyValueStore` in a Durable Object's own storage: where a machine's state lives |
| `d1Store(db)`, `kvStore(namespace)` | a `KeyValueStore` in D1 (table `kv`) or KV, for state Workers share rather than a machine's; KV is eventually consistent |
| `machineApi(name, current, receive)` | the HTTP API of one machine at `/api/<name>/:key`: GET its state; POST one untrusted input as JSON, 200 with the new state, 400 for `NotAnEvent`, 409 for `Rejected` (with the state), 415 for a body that is not `application/json`, 503 for anything else, which changes nothing |
| `machineObject(routes)` | a Durable Object class serving `routes` over `durableStore` of its own storage, built once per object: one machine per key, applying one event at a time. A DELETE empties a throwaway machine's storage (keys starting `conformance-`, `journey-` or `sim-`: 204) and is refused for any other (405) |
| `worker({ <name>: "<BINDING>" })` | the Worker's `fetch`: `/api/<name>/<key>` to that key's Durable Object; the Vite build in `dist/client` is served before the Worker runs. It is plain TypeScript (`worker.ts`), the one exception to "effects in VibeLang": it only picks the object a request goes to and hands the request on |

- **A package's Worker** is `src/worker.vibe`: `export class X extends
  machineObject(Layer.provideMerge(machineApi("<module>", …), stored))` and
  `export default worker({ <module>: "X_BINDING" })`. The page reaches it
  with a layer of the same service over `HttpClient` (`visiting` in
  `apps/app/src/greeter.vibe`), on the visitor's own key: the one `?key=`
  names, or else one made on the browser's first visit and kept in its
  localStorage. A machine every visitor shares is a decision of the spec,
  not a default.
- **Build and run.** `pnpm build` is `vite build` (the page, to
  `dist/client`) and `vite build --ssr src/worker.vibe` (the Worker, whole,
  to `dist/worker`). `pnpm dev` is `wrangler dev`, which builds first
  (`build` in `wrangler.jsonc`) and rebuilds on a change. That command names
  its package (`pnpm -s --filter @repo/app build`): the train runs wrangler
  in the repository root, and `deploy.mjs coverage` fails a config whose
  build would build the root instead. There are three
  configs, `wrangler.jsonc` (production), `wrangler.staging.jsonc` and
  `wrangler.preprod.jsonc`, the same but for `name`; a branch's preview is a
  copy of staging's with Durable Objects of its own.
- **Tests and drivers reach the Worker** through `worker(dir)` from
  `vibestack/testing/workers`: `wrangler dev` over a fresh storage directory
  (or `persist` to start it again over the same one), or the deployed Worker
  at `DEPLOY_URL` when a gate runs them. The conformance driver sends each
  reset to keys no earlier run used (`conformance-…`), so it needs no reset
  endpoint, and forgets them all at the end with a DELETE, as the journeys
  do theirs (`journey-…`): a gate leaves nothing in a deployed Worker's
  storage.
- **The release train.** `.deploy/manifest.json` lists the checks
  (`vibestack.mjs check`: every stage of `spec check`, no rule recorded as
  unproved, and review waiting on `pnpm accept` allowed; then `pnpm verify`,
  `vibestack.mjs train --check`, `sim.mjs validate`), the gates on the
  deployed Worker in preview, staging and preprod (`vibestack.mjs check
  --worker app`: conformance walked on the deployed Worker; the journeys with
  `DEPLOY_URL`; the simulated people in a browser), `before.preprod` and
  `before.production` (the same check, where pending review fails and nothing
  deploys), and a surface per Worker with the spec it serves (`"spec"`,
  `"worker"`). `spec train` writes a simulated person per story of that spec
  to `.deploy/sims/`: the person opens the page at `/?key=sim-<run>`, a
  machine of their own, judged by `spec observe <module> <url> --key
  sim-<run> --run <run>` (false before the person acts, true once that
  machine has changed into a state the spec allows, so no one else's
  traffic can pass it); `pnpm new` runs it, and `deploy.mjs coverage` fails
  on a story with none. The scripts in `.deploy/*.mjs` and the workflows
  `deploy`, `preview-cleanup`, `promote`, `watch` and `autofix` in
  `.github/workflows/` are the cf-release-train skill's (it reads this spec
  through `vibestack.mjs`), copied whole: never edit them here; change the
  skill and copy again.
- **Deploying.** `wrangler login` (or `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`), then `node .deploy/deploy.mjs preview --branch
  <b>` (`--delete` to remove it) or `staging`. A failed gate rolls each
  Worker back, deletes a preview's first deploy, and names what neither
  could undo: `DEPLOY_FAIL … rolled_back=n deleted=n left_broken=…`. The
  environments, the GitHub secrets, and how to add a second application are
  in [README.md, "Deploy on Cloudflare with the release
  train"](../../../README.md#deploy-on-cloudflare-with-the-release-train).

## Building, running and testing

| | Command | Does |
|---|---|---|
| check | `pnpm check` | `types` checks `src/`, `test/` and `gen/` with `vibelang --noEmit -p .` |
| build | `pnpm build` (`vibelang`) | checks, and writes JavaScript to `dist/`, as `dist/src/…` and `dist/gen/…` |
| run | `pnpm build && node dist/src/main.js` | runs the built `src/main.vibe` |
| test | `pnpm test` (`vitest run`) | `test/**/*.test.vibe`, written with `@effect/vitest`, and the property tests of `src/**/*.schema.*` and `*.contract.*`; compiled as they load, no build first ([AGENTS.md, "Tests"](../../../AGENTS.md#tests)) |

| Needs | |
|---|---|
| Node | 26 |
| `dependencies` | `effect`, `@effect/platform-node`, `vibelang-runtime` |
| `devDependencies` | `vibelang`, `vibelang-vite`, `vite`, `vitest`, `@effect/vitest`, `@types/node` |

VibeLang's packages move together, and with one version of Effect: pin them
exactly, at the versions in the tools' own `package.json`, which `spec init`
adds. The compiler writes declarations for other tools under `.vibe/`, even
when it only checks: keep it out of Git, like `dist/`.
