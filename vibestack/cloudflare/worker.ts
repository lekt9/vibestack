// The Worker's entry (workers.vibe): plain routing on the platform's own Request and Response, with no effects.

/** A Durable Object namespace, as `env` binds it. */
interface DurableNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

/** A key a Worker accepts: what a person or a test names a machine by, short and plain. */
const KEY = /^[\w.-]{1,64}$/;

/**
 * The Worker: `/api/<name>/<key>` goes to the Durable Object for `<key>` in the namespace bound as `machines[name]`.
 * The page's files are served before the Worker runs (`assets` in wrangler.jsonc), so anything else is not found.
 */
export function worker(machines: Record<string, string>) {
  return {
    fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
      const [, api, name, key, ...rest] = new URL(request.url).pathname.split("/");
      const binding = api === "api" && rest.length === 0 && KEY.test(key ?? "") ? machines[name] : undefined;
      const namespace = binding === undefined ? undefined : env[binding] as DurableNamespace | undefined;
      if (namespace === undefined) return Promise.resolve(Response.json({ error: "not found" }, { status: 404, headers: { "cache-control": "no-store" } }));
      return namespace.get(namespace.idFromName(key)).fetch(request);
    },
  };
}
