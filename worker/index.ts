import OAuthProvider, { AuthorizationError, CimdFetchError, insufficientScope, type OAuthHelpers, type OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { withTrustedAuth } from "../lib/auth-context";
import { AppError } from "../lib/domain";
import { boundedBody, failure } from "../lib/data-http";
import * as me from "../app/api/me/route";
import * as records from "../app/api/records/route";
import * as record from "../app/api/records/[id]/route";
import * as restore from "../app/api/records/[id]/restore/route";
import * as audit from "../app/api/audit/route";
import * as exports from "../app/api/export/route";
import * as imports from "../app/api/import/route";
import * as links from "../app/api/lab/link/route";
import * as files from "../app/api/files/route";
import * as file from "../app/api/files/[id]/route";
import * as mcp from "../app/mcp/route";
import { appContentSecurityPolicy, assertConfigured, authVersion, browserAuth, canonicalOrigin, constantEqual, createSession, demoAllowed, destroySession, loginChallenge, OWNER_ID, rateLimit, readForm, requireCsrf, safeReturnTo, validateLoginChallenge, type AuthEnv } from "./auth";
import { connectionsPage, consentPage, escapeHtml, html, loginPage, page } from "./pages";

export interface WorkerEnv extends AuthEnv {
  ASSETS: Fetcher;
  BUCKET?: R2Bucket;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
}
type OAuthProps = { userId: string; authVersion: string };
const scopes = ["workspace:read", "workspace:write", "offline_access"];
const readTools = new Set(["search_records", "read_record", "workspace_context"]);
const methodNotAllowed = (allow: string) => new Response(null, { status: 405, headers: { Allow: allow } });
const redirect = (location: string) => new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });

export async function dispatchApi(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname, method = request.method;
  const routes: Record<string, Record<string, (request: Request) => Promise<Response>>> = {
    "/api/me": { GET: me.GET }, "/api/records": { GET: records.GET, POST: records.POST },
    "/api/audit": { GET: audit.GET }, "/api/export": { GET: exports.GET },
    "/api/import": { POST: imports.POST }, "/api/lab/link": { POST: links.POST }, "/api/files": { POST: files.POST }
  };
  if (routes[path]) return routes[path][method]?.(request) ?? methodNotAllowed(Object.keys(routes[path]).join(", "));
  const match = path.match(/^\/api\/(records|files)\/([A-Za-z0-9_-]{1,120})(\/restore)?$/);
  if (match) {
    const ctx = { params: Promise.resolve({ id: match[2] }) };
    if (match[1] === "files") return !match[3] && method === "GET" ? file.GET(request, ctx) : methodNotAllowed("GET");
    if (match[3]) return method === "POST" ? restore.POST(request, ctx) : methodNotAllowed("POST");
    if (method === "GET") return record.GET(request, ctx);
    if (method === "PATCH") return record.PATCH(request, ctx);
    if (method === "DELETE") return record.DELETE(request, ctx);
    return methodNotAllowed("GET, PATCH, DELETE");
  }
  return Response.json({ error: { code: "not_found", message: "Unknown API route." } }, { status: 404 });
}
async function defaultHandler(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url), path = url.pathname;
  if (path === "/login" || path === "/auth/login") {
    if (demoAllowed(request, env)) return redirect("/lab");
    if (request.method === "GET") {
      if (await browserAuth(request, env)) return redirect(safeReturnTo(url.searchParams.get("next")));
      const challenge = await loginChallenge(request, env);
      return html(loginPage(challenge.token, safeReturnTo(url.searchParams.get("next"))), new Headers({ "Set-Cookie": challenge.cookie }));
    }
    if (request.method !== "POST") return methodNotAllowed("GET, POST");
    const form = await readForm(request);
    await validateLoginChallenge(request, env, form.get("csrf") || "");
    await rateLimit(request, env, "login");
    if (!(await constantEqual(form.get("password") || "", env.OWNER_PASSWORD!))) {
      const challenge = await loginChallenge(request, env);
      return html(loginPage(challenge.token, safeReturnTo(form.get("next")), "That password did not match."), new Headers({ "Set-Cookie": challenge.cookie }), 401);
    }
    const headers = await createSession(request, env);
    headers.set("Location", safeReturnTo(form.get("next")));
    return new Response(null, { status: 303, headers });
  }
  const auth = await browserAuth(request, env);
  if (path.startsWith("/api/")) {
    if (!auth) throw new AppError(401, "sign_in_required", "Sign in to your private workspace.");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) requireCsrf(request, auth);
    return withTrustedAuth(auth, () => dispatchApi(request));
  }
  if (path === "/auth/logout") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    if (!auth) return redirect("/login");
    const token = request.headers.get("X-CSRF-Token") || (await readForm(request)).get("csrf");
    requireCsrf(request, auth, token);
    return new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": await destroySession(request, env), "Cache-Control": "no-store" } });
  }
  if (path === "/authorize") {
    if (demoAllowed(request, env)) return html(page("Local demo", "<h1>Local demo</h1><p>OAuth connections require a private installation with real authentication.</p>"), undefined, 403);
    if (request.method === "GET") {
      const parsed = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      // Require modern PKCE even for confidential clients.
      if (!parsed.codeChallenge || parsed.codeChallengeMethod !== "S256") throw new AppError(400, "pkce_required", "This connection requires PKCE with S256.");
      if (!auth) return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
      if (parsed.scope.some(scope => !scopes.includes(scope))) throw new AppError(400, "invalid_scope", "This client requested unsupported permissions.");
      if (!parsed.scope.length) parsed.scope = [...scopes];
      const details = await env.OAUTH_PROVIDER.describeConsent(parsed);
      const consent = await env.OAUTH_PROVIDER.beginConsent(parsed);
      const response = html(consentPage(details, consent.handle, auth.csrfToken!), consent.headers);
      // Some browsers apply form-action to the redirect after an OAuth approval.
      // Permit only this already-validated callback origin in addition to ourselves.
      const callbackOrigin = new URL(parsed.redirectUri).origin;
      response.headers.set("Content-Security-Policy", response.headers.get("Content-Security-Policy")!.replace("form-action 'self'", `form-action 'self' ${callbackOrigin}`));
      return response;
    }
    if (request.method !== "POST") return methodNotAllowed("GET, POST");
    if (!auth) throw new AppError(401, "sign_in_required", "Sign in again, then restart the assistant connection.");
    const form = await readForm(request); requireCsrf(request, auth, form.get("csrf"));
    const handle = form.get("handle") || "";
    if (form.get("decision") !== "approve") {
      const denied = await env.OAUTH_PROVIDER.denyConsent(request, handle);
      return new Response(null, { status: 303, headers: denied.headers });
    }
    const approved = await env.OAUTH_PROVIDER.approveConsent(request, handle, { scope: form.getAll("scope") });
    const client = await env.OAUTH_PROVIDER.lookupClient(approved.request.clientId);
    const result = await env.OAUTH_PROVIDER.completeAuthorization({ request: approved.request, userId: OWNER_ID, metadata: { clientName: client?.clientName || "AI assistant" }, scope: approved.request.scope, props: { userId: OWNER_ID, authVersion: await authVersion(env) } });
    approved.headers.set("Location", result.redirectTo);
    return new Response(null, { status: 303, headers: approved.headers });
  }
  if (path === "/auth/connections") {
    if (!auth) return redirect("/login?next=/auth/connections");
    if (demoAllowed(request, env)) return html(page("Demo connections", '<h1>Your assistant, connected.</h1><p>This is a local fictional demo. A private installation lets you approve and revoke real assistant connections here.</p><a class="button" href="/lab">Back to demo</a>'));
    if (request.method === "POST") {
      const form = await readForm(request); requireCsrf(request, auth, form.get("csrf"));
      const id = form.get("grant_id");
      if (!id || id.length > 240) throw new AppError(400, "invalid_grant", "Choose a connection to revoke.");
      await env.OAUTH_PROVIDER.revokeGrant(id, OWNER_ID);
      return redirect("/auth/connections");
    }
    if (request.method !== "GET") return methodNotAllowed("GET, POST");
    const grants = await env.OAUTH_PROVIDER.listUserGrants(OWNER_ID);
    return html(connectionsPage(grants.items, auth.csrfToken!));
  }
  if (!["GET", "HEAD"].includes(request.method)) return methodNotAllowed("GET, HEAD");
  if (!auth && (path === "/" || path === "/lab" || path.startsWith("/lab/"))) return redirect(`/login?next=${encodeURIComponent(path + url.search)}`);
  return env.ASSETS.fetch(request);
}
function providerFor(origin: string) {
  return new OAuthProvider<WorkerEnv>({
    apiRoute: "/mcp", authorizeEndpoint: "/authorize", tokenEndpoint: "/oauth/token", clientRegistrationEndpoint: "/oauth/register",
    resourceMetadata: { resource: origin + "/mcp", authorization_servers: [origin] },
    scopesSupported: scopes, requiredScopes: ["workspace:read"], clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: 3600, refreshTokenTTL: 30 * 24 * 60 * 60, clientRegistrationTTL: 90 * 24 * 60 * 60,
    defaultHandler: { fetch: defaultHandler },
    apiHandler: { async fetch(request, env, rawContext) {
      const ctx = rawContext as OAuthResourceContext<OAuthProps>;
      if (ctx.props?.userId !== OWNER_ID || !(await constantEqual(ctx.props?.authVersion || "", await authVersion(env)))) return Response.json({ error: "invalid_token", error_description: "Reconnect this assistant after credential rotation." }, { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token"` } });
      if (!ctx.auth.scope.includes("workspace:read")) return insufficientScope(ctx.auth, ["workspace:read"]);
      if (request.method === "POST") {
        const raw = await boundedBody(request.clone() as Request);
        let body: { method?: string; params?: { name?: string } } | null = null;
        try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { /* The protocol handler returns the precise JSON error. */ }
        if (body?.method === "tools/call" && !readTools.has(body.params?.name || "") && !ctx.auth.scope.includes("workspace:write")) return insufficientScope(ctx.auth, ["workspace:read", "workspace:write"]);
        return withTrustedAuth({ userId: OWNER_ID, method: "oauth", scopes: ctx.auth.scope }, () => mcp.POST(request));
      }
      return mcp.GET();
    } }
  });
}
function secure(response: Response, request: Request) {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", appContentSecurityPolicy(request));
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      assertConfigured(request, env);
      if (demoAllowed(request, env)) {
        if (new URL(request.url).pathname === "/mcp") return secure(await withTrustedAuth({ userId: OWNER_ID, method: "demo", csrfToken: "local-demo-only" }, () => request.method === "POST" ? mcp.POST(request) : mcp.GET()), request);
        return secure(await defaultHandler(request, env), request);
      }
      if (!env.OAUTH_KV) throw new AppError(503, "setup_required", "Connect OAUTH_KV before using this installation.");
      if (new URL(request.url).pathname === "/oauth/register" && request.method === "POST") await rateLimit(request, env, "oauth-registration", 30, 300);
      return secure(await providerFor(canonicalOrigin(request, env)).fetch(request, env, ctx), request);
    } catch (error) {
      if (error instanceof AuthorizationError || error instanceof CimdFetchError) return secure(html(page("Connection could not finish", `<h1>Connection could not finish</h1><p>${escapeHtml(error instanceof AuthorizationError ? error.description : "The assistant metadata could not be verified.")}</p><p>Restart the connection from your assistant.</p>`), undefined, 400), request);
      return secure(failure(error), request);
    }
  }
} satisfies ExportedHandler<WorkerEnv>;
