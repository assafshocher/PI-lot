import { AsyncLocalStorage } from "node:async_hooks";

/** Identity exists only inside a verified worker request, never in caller-supplied headers. */
export type TrustedAuth = {
  userId: string;
  method: "session" | "oauth" | "demo";
  csrfToken?: string;
  scopes?: readonly string[];
};
const context = new AsyncLocalStorage<TrustedAuth>();
export function withTrustedAuth<T>(auth: TrustedAuth, work: () => T): T { return context.run(Object.freeze({ ...auth }), work); }
export function trustedAuth(): TrustedAuth | undefined { return context.getStore(); }
