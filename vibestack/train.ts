// The release train's view of the spec (README.md, "On Cloudflare Workers"): every story of a spec a surface of
// .deploy/manifest.json names is a simulated person's scenario in .deploy/sims, and `observe` is how a scenario, a gate
// or a watch reads the deployed Worker, with the generated module as the judge of what it holds.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readSpecs, type Spec, type Story } from "./parse.ts";

const MANIFEST = ".deploy/manifest.json", SIMS = ".deploy/sims";

interface Surface { name: string; spec?: string; worker?: string; user?: string[] }
interface Scenario { name: string; surface: string; story: string; persona: { id: string; about: string }; task: string; oracles: unknown[] }

/** `Say hello` of spec `app` as a scenario's name: lower case and dashes, within sim.mjs's 61 characters. */
const slug = (spec: Spec, story: Story) =>
  `${spec.name}-${story.title.replace(/^Story:\s*/, "")}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 61).replace(/-$/, "");

/** `app` as the variable a gate gets its address in: DEPLOY_URL_APP (deploy.mjs). */
const urlVariable = (worker: string) => `DEPLOY_URL_${worker.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

/** The scenario of one story: the person the story names, wanting what it says, judged by `observe` on the Worker. */
function scenario(spec: Spec, story: Story, surface: Surface): Scenario {
  const quote = story.prose.split("\n").filter((line) => line.startsWith(">")).map((line) => line.replace(/^>\s?/, "")).join(" ").replace(/\s+/g, " ").trim();
  const who = /^As (?:an? |the )?([^,]+),/i.exec(quote)?.[1]?.trim() ?? "person using the product";
  const want = quote.replace(/^As [^,]+,\s*/i, "").replace(/^I want to /i, "").replace(/[.]$/, "") || story.title.replace(/^Story:\s*/, "");
  const variable = urlVariable(surface.worker ?? surface.name);
  return {
    name: slug(spec, story),
    surface: surface.name,
    story: `${spec.file}, "${story.title}"`,
    persona: { id: who.toLowerCase().replace(/[^a-z0-9]+/g, "-"), about: `a ${who}, in the words of ${spec.file}` },
    // sim.mjs fills {DEPLOY_URL_…} from the gate's environment, as the shell does $DEPLOY_URL_… in the oracle, and {run}
    // with this run's id: the page's `?key=` gives the person a machine of their own, so only what they did can change it.
    task: `I am on the site at {${variable}}/?key=sim-{run}. I want to ${want}.`,
    oracles: [{
      name: `the person's own ${spec.name} changed, into a state ${spec.file} allows`,
      cmd: `node vibestack/spec.ts observe ${spec.name} "$${variable}" --key sim-{run} --run {run}`,
      marker: "OBSERVED_CHANGE",
    }],
  };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * What .deploy/ should hold for the spec in `root`: a scenario per story of each surface's spec, listed in its
 * `user`. Hand-written scenarios (no `story`) are kept as they are; a generated one whose story is gone is removed.
 */
function wanted(root: string) {
  const file = path.join(root, MANIFEST);
  if (!fs.existsSync(file)) throw new Error(`${MANIFEST} is missing: the release train's manifest (README.md, "On Cloudflare Workers")`);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as { surfaces?: Surface[] };
  const specs = readSpecs(root), problems: string[] = [];
  const surfaces = manifest.surfaces ?? [];
  const files = new Map<string, string>();
  for (const spec of specs.filter((s) => s.stories.length && !surfaces.some((surface) => surface.spec === s.file)))
    problems.push(`${spec.file} has ${spec.stories.length} stories and no surface of ${MANIFEST} names it in "spec"`);
  for (const surface of surfaces.filter((s) => s.spec)) {
    const spec = specs.find((s) => s.file === surface.spec);
    if (!spec) { problems.push(`surface ${surface.name}: "spec" is ${surface.spec}, which is no spec`); continue; }
    const generated = spec.stories.map((story) => scenario(spec, story, surface));
    for (const s of generated) files.set(`${SIMS}/${s.name}.json`, json(s));
    const own = (surface.user ?? []).filter((name) => !isGenerated(root, name));
    surface.user = [...own, ...generated.map((s) => s.name)];
  }
  const dir = path.join(root, SIMS);
  const stale = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).map((f) => `${SIMS}/${f}`)
    .filter((f) => f.endsWith(".json") && !files.has(f) && isGenerated(root, path.basename(f, ".json")));
  files.set(MANIFEST, json(manifest));
  return { files, stale, problems, stories: specs.reduce((n, s) => n + (surfaces.some((x) => x.spec === s.file) ? s.stories.length : 0), 0) };
}

/** A scenario `spec train` wrote: it names its story. */
function isGenerated(root: string, name: string) {
  try { return "story" in JSON.parse(fs.readFileSync(path.join(root, SIMS, `${name}.json`), "utf8")); } catch { return false; }
}

/** Bring .deploy/ up to date with the spec, or with `check` say only whether it is; the lines to print, and whether all is well. */
export function train(root: string, check = false): { ok: boolean; lines: string[] } {
  const { files, stale, problems, stories } = wanted(root);
  const differ = [...files].filter(([file, text]) => !fs.existsSync(path.join(root, file)) || fs.readFileSync(path.join(root, file), "utf8") !== text).map(([file]) => file);
  if (!check) {
    for (const file of differ) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), files.get(file)!); }
    for (const file of stale) fs.rmSync(path.join(root, file));
  }
  const changed = [...differ.map((f) => `${check ? "out of date" : "wrote"}: ${f}`), ...stale.map((f) => `${check ? "story is gone" : "removed"}: ${f}`)];
  const ok = !problems.length && (!check || !changed.length);
  const sims = files.size - 1;
  return { ok, lines: [...problems, ...changed, ok ? `TRAIN_OK stories=${stories} sims=${sims}` : check && changed.length ? "run `spec train` to bring .deploy/ up to date with the spec" : ""].filter(Boolean) };
}

/**
 * Read the deployed `module` at `url`: its page answers, and the state of its machine `key` (by default the module's
 * name) is one the generated module accepts. With `run`, the first read is remembered under .spec-cache/observed and
 * fails; a later one passes only if the state has changed since: an oracle that is false before the person acts, on a
 * key only that person's page uses (`?key=`), so no one else's change can pass it.
 */
export async function observe(root: string, module: string, url: string, run?: string, key = module): Promise<{ ok: boolean; line: string }> {
  const base = url.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) return { ok: false, line: `OBSERVE_FAIL ${module}: "${url}" is no address (is the gate's DEPLOY_URL_ variable set?)` };
  const page = await fetch(`${base}/`);
  if (!page.ok || !(page.headers.get("content-type") ?? "").includes("text/html")) return { ok: false, line: `OBSERVE_FAIL ${module}: ${base}/ answered ${page.status} ${page.headers.get("content-type") ?? ""}` };
  if (!/^[\w-]{1,80}$/.test(key)) return { ok: false, line: `OBSERVE_FAIL ${module}: --key ${key} is no key` };
  const answer = await fetch(`${base}/api/${module}/${key}`);
  const said: unknown = await answer.json().catch(() => undefined);
  const { parseState } = await import(pathToFileURL(path.join(root, "gen", `${module}.ts`)).href) as { parseState(x: unknown): unknown };
  if (!answer.ok || parseState(said) === undefined) return { ok: false, line: `OBSERVE_FAIL ${module}: /api/${module}/${key} answered ${answer.status} ${JSON.stringify(said)}, which is no state of gen/${module}.ts` };
  const state = JSON.stringify(said);
  if (run === undefined) return { ok: true, line: `OBSERVED ${module} state=${state}` };
  if (!/^[\w-]{1,64}$/.test(run)) return { ok: false, line: `OBSERVE_FAIL ${module}: --run ${run} is no run id` };
  const remembered = path.join(root, ".spec-cache", "observed", `${module}-${key}-${run}.json`);
  if (!fs.existsSync(remembered)) {
    fs.mkdirSync(path.dirname(remembered), { recursive: true });
    fs.writeFileSync(remembered, state);
    return { ok: false, line: `OBSERVED_FIRST ${module} state=${state}: remembered; the next read passes if it has changed` };
  }
  const before = fs.readFileSync(remembered, "utf8");
  return before === state ? { ok: false, line: `OBSERVED_SAME ${module} state=${state}` } : { ok: true, line: `OBSERVED_CHANGE ${module} before=${before} after=${state}` };
}
