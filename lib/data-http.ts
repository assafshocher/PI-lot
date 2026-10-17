import { AppError, checkOrigin, requestIdentity } from "./domain.ts";
export function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }); }
export function failure(error: unknown) {
  if (error instanceof AppError) return json({ error: { code: error.code, message: error.message, details: error.details } }, error.status);
  console.error("Private workspace operation failed", error instanceof Error ? error.message : "unknown error");
  return json({ error: { code: "server_error", message: "This operation could not be completed. Please try again; your existing data is safe." } }, 500);
}
export function authorized(request: Request, mutation = false) { const user = requestIdentity(request); if (mutation) checkOrigin(request); return user; }
export async function boundedBody(request: Request, max = 512 * 1024) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > max) throw new AppError(413, "too_large", "The submitted content is too large.");
  const reader = request.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); throw new AppError(413, "too_large", "The submitted content is too large."); } chunks.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}
export async function readJson(request: Request, max?: number) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new AppError(415, "json_required", "Send application/json content.");
  const bytes = await boundedBody(request, max);
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new AppError(400, "invalid_json", "The submitted JSON could not be read."); }
}
