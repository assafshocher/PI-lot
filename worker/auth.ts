import { AppError } from "../lib/domain.ts";
import { boundedBody } from "../lib/data-http.ts";
import type { TrustedAuth } from "../lib/auth-context.ts";

export type AuthEnv = {
  DB: D1Database;
  OWNER_PASSWORD?: string;
  SESSION_SECRET?: string;
  APP_ORIGIN?: string;
  DEMO_MODE?: string;
};
export const OWNER_ID = "owner";
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
export function demoAllowed(request: Request, env: AuthEnv) { return env.DEMO_MODE === "true" && loopback(new URL(request.url).hostname); }
/** Vite's refresh preamble is allowed only on an explicit loopback URL, including private local development. */
export function appContentSecurityPolicy(request: Request) {
  const local = loopback(new URL(request.url).hostname);
  return `default-src 'self'; script-src 'self'${local ? " 'unsafe-inline'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'${local ? ' ws: wss:' : ''}; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
}

export function canonicalOrigin(request: Request, env: AuthEnv): string {
  const url = new URL(request.url);
  if (demoAllowed(request, env)) return url.origin;
  if (!env.APP_ORIGIN) throw new AppError(503, "setup_required", "Set APP_ORIGIN before using this private installation.");
  let configured: URL;
  try { configured = new URL(env.APP_ORIGIN); } catch { throw new AppError(503, "setup_required", "APP_ORIGIN must be an HTTPS origin."); }
  if (configured.origin !== env.APP_ORIGIN || configured.username || configured.password || (configured.protocol !== "https:" && !(configured.protocol === "http:" && loopback(configured.hostname)))) throw new AppError(503, "setup_required", "APP_ORIGIN must be an HTTPS origin (HTTP is allowed only on loopback).");
  if (url.origin !== configured.origin) throw new AppError(403, "invalid_host", "Open the configured APP_ORIGIN for this installation.");
  return configured.origin;
}
export function assertConfigured(request: Request, env: AuthEnv) {
  canonicalOrigin(request, env);
  if (demoAllowed(request, env)) return;
  if (!env.DB || !env.OWNER_PASSWORD || env.OWNER_PASSWORD.length < 16 || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new AppError(503, "setup_required", "Finish the private installation: DB, a strong OWNER_PASSWORD (16+ characters), and SESSION_SECRET (32+ characters) are required.");
  if (new URL(request.url).protocol !== "https:" && !loopback(new URL(request.url).hostname)) throw new AppError(403, "https_required", "Use HTTPS to sign in.");
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new AppError(403, "invalid_origin", "This action must come from this app.");
}
export function safeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x1f]/.test(value)) return "/lab";
  const parsed = new URL(value, "https://local.invalid");
  return parsed.origin === "https://local.invalid" ? parsed.pathname + parsed.search + parsed.hash : "/lab";
}
export function cookieValue(request: Request, name: string) {
  const match = (request.headers.get("cookie") || "").split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return match?.slice(name.length + 1) ?? null;
}
const cookieName = (request: Request) => new URL(request.url).protocol === "https:" ? "__Host-pilot-session" : "pilot-dev-session";
const loginCookieName = (request: Request) => new URL(request.url).protocol === "https:" ? "__Host-pilot-login" : "pilot-dev-login";
function cookie(request: Request, name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
async function digest(value: string) { return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))); }
export async function constantEqual(a: string, b: string) {
  const aa = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(a)));
  const bb = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(b)));
  let difference = 0; for (let i = 0; i < aa.length; i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}
async function hmac(env: AuthEnv, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.SESSION_SECRET!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}
export async function authVersion(env: AuthEnv) { return hmac(env, `credential-version:${env.OWNER_PASSWORD}`); }
async function sessionHash(env: AuthEnv, token: string) { return hmac(env, `session:${env.OWNER_PASSWORD}:${token}`); }
export async function browserAuth(request: Request, env: AuthEnv): Promise<TrustedAuth | null> {
  assertConfigured(request, env);
  if (demoAllowed(request, env)) return { userId: OWNER_ID, method: "demo", csrfToken: "local-demo-only" };
  const token = cookieValue(request, cookieName(request));
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await env.DB.prepare("SELECT csrf_token,expires_at FROM auth_sessions WHERE token_hash=?").bind(await sessionHash(env, token)).first<{ csrf_token: string; expires_at: number }>();
  if (!row || row.expires_at <= Date.now()) return null;
  return { userId: OWNER_ID, method: "session", csrfToken: row.csrf_token };
}
export function requireCsrf(request: Request, auth: TrustedAuth, supplied = request.headers.get("X-CSRF-Token")) {
  sameOrigin(request);
  if (!supplied || supplied !== auth.csrfToken) throw new AppError(403, "invalid_csrf", "Refresh this page before trying again.");
}
export async function loginChallenge(request: Request, env: AuthEnv) {
  const payload = `${Math.floor(Date.now() / 1000) + 600}.${random()}`;
  const token = `${payload}.${await hmac(env, "login:" + payload)}`;
  return { token, cookie: cookie(request, loginCookieName(request), token, 600) };
}
export async function validateLoginChallenge(request: Request, env: AuthEnv, supplied: string) {
  sameOrigin(request);
  const token = cookieValue(request, loginCookieName(request));
  if (!token || !supplied || token !== supplied || token.length > 200) throw new AppError(403, "invalid_csrf", "Reload the sign-in page and try again.");
  const parts = token.split(".");
  if (parts.length !== 3 || Number(parts[0]) <= Date.now() / 1000 || !(await constantEqual(parts[2], await hmac(env, `login:${parts[0]}.${parts[1]}`)))) throw new AppError(403, "invalid_csrf", "Reload the sign-in page and try again.");
}
export async function rateLimit(request: Request, env: AuthEnv, purpose: string, maximum = 10, globalMaximum = 100) {
  const window = Math.floor(Date.now() / 3_600_000), expiry = (window + 1) * 3_600_000;
  // Cloudflare sets this header at its edge. Never use X-Forwarded-For supplied by a client.
  const address = request.headers.get("CF-Connecting-IP") || "local";
  const keys = [[`${purpose}:ip:${await digest(address)}:${window}`, maximum], [`${purpose}:global:${window}`, globalMaximum]] as const;
  for (const [key, max] of keys) {
    const result = await env.DB.prepare("INSERT INTO auth_rate_limits(bucket_key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET attempts=attempts+1 RETURNING attempts").bind(key, expiry).first<{ attempts: number }>();
    if (!result || result.attempts > max) throw new AppError(429, "rate_limited", "Too many attempts. Try again after the current hour, or contact the installation owner.");
  }
}
export async function readForm(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) throw new AppError(415, "form_required", "Use the form on this page.");
  const bytes = await boundedBody(request, 16 * 1024);
  return new URLSearchParams(new TextDecoder().decode(bytes));
}
export async function createSession(request: Request, env: AuthEnv) {
  const token = random(), csrf = random(), expires = Date.now() + SESSION_SECONDS * 1000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at<=?").bind(Date.now()),
    env.DB.prepare("DELETE FROM auth_rate_limits WHERE expires_at<=?").bind(Date.now()),
    env.DB.prepare("INSERT INTO auth_sessions(token_hash,csrf_token,expires_at) VALUES(?,?,?)").bind(await sessionHash(env, token), csrf, expires)
  ]);
  const headers = new Headers({ Location: "/lab" });
  headers.append("Set-Cookie", cookie(request, cookieName(request), token, SESSION_SECONDS));
  headers.append("Set-Cookie", cookie(request, loginCookieName(request), "", 0));
  return headers;
}
export async function destroySession(request: Request, env: AuthEnv) {
  const token = cookieValue(request, cookieName(request));
  if (token) await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(await sessionHash(env, token)).run();
  return cookie(request, cookieName(request), "", 0);
}
