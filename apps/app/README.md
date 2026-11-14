# @repo/app

Hello world: a page that greets a name and counts the greetings. It is small on purpose, and it uses one of each
thing Vibestack offers, so that every stage of `pnpm check` has something to check. Start a new application by
replacing it.

Its requirements are [`spec/app/index.md`](../../spec/app/index.md), in the one spec tree at the repository root.
`pnpm check` there generates `gen/app.ts` and `gen/app.effect.vibe` here, and checks this package's types, proofs,
tests and traces (SPEC.md, "One spec tree").

| Piece | Shows | Checked by |
|---|---|---|
| `spec/app/index.md` | a story; a state, `initial`, a guarded transition, an `always`, a `step`, a `sometimes` rule and a law | `model`, `always`, `sometimes`, `replay`, `proof` |
| `src/greeter.vibe` | the VibeLang shell: the greeter kept in a `KeyValueStore` (`stored`), every input through `decodeEvent` and `apply`; and `remote`, the same service in the page over the Worker's HTTP API | `types`, `traces`, `tests` |
| `src/worker.vibe`, `wrangler*.jsonc` | the Cloudflare Worker: a Durable Object per greeter holding `stored` over its own storage, the API at `/api/app/<key>`, the page as static assets ([shell skill, "On Cloudflare Workers"](../../.claude/skills/shell/SKILL.md#on-cloudflare-workers)) | `types`, `traces`, `tests`, the release train |
| `src/greeter.schema.ts` | an Effect Schema at the boundary: what the store holds | the property tests `pnpm test` derives from it |
| `src/greeting.ts`, `greeting.proof.dfy` | hand-written verified logic: a `//@` contract and the lemma that proves it | `proof`, `review` |
| `src/App.tsx`, `src/useGreetings.ts` | React over the shell: Greet is offered exactly when `enabled` allows it, on `@repo/ui` and the design tokens | `types`, lint, `test:browser` |
| `test/drivers/app.ts` | the conformance driver: the Worker against the spec over HTTP, by journeys, malformed inputs and random walks, under `wrangler dev` or at `DEPLOY_URL` | `traces`, the train's gates |
| `test/app.test.vibe` | the journeys the driver cannot see: the greeter read back from its store, and the page's `remote` through the Worker across a restart | `tests`, the train's gates |
| `test/app.browser.test.tsx` | what only a browser shows: focus after greeting, and a store that refuses (a full localStorage) | `pnpm test:browser` |

| Command | Does |
|---|---|
| `pnpm dev` | the Worker and its page, with `wrangler dev` (which builds first) |
| `pnpm typecheck`, `pnpm build` | `vibelang --noEmit`; `vite build` of the page to `dist/client` and of the Worker to `dist/worker` |
| `pnpm test`, `pnpm test:browser` | the tests in Node, with the derived property tests; the browser tests in Chromium |
