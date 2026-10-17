import { env } from "cloudflare:workers";
import { database } from "@/lib/data";
import { AppError, idSchema, parse } from "@/lib/domain";
import { authorized, failure } from "@/lib/data-http";
import { assertKind } from "@/lib/workspace";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = authorized(request), id = parse(idSchema, (await context.params).id);
    assertKind("project");
    const file = await database().prepare("SELECT name,content_type FROM files WHERE user_id=? AND id=?").bind(user, id).first<{ name: string; content_type: string }>();
    if (!file || !env.BUCKET) throw new AppError(404, "not_found", "The attachment could not be found.");
    const object = await env.BUCKET.get(`private/${encodeURIComponent(user)}/${id}`);
    if (!object) throw new AppError(404, "not_found", "The attachment could not be found.");
    return new Response(object.body, { headers: { "Content-Type": file.content_type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } });
  } catch (e) { return failure(e); }
}
