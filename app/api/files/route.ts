import { env } from "cloudflare:workers";
import { database } from "@/lib/data";
import { AppError } from "@/lib/domain";
import { authorized, boundedBody, failure, json } from "@/lib/data-http";
import { assertKind } from "@/lib/workspace";
export async function POST(request: Request) {
  let uploaded: string | null = null;
  try {
    const user = authorized(request, true);
    assertKind("project");
    if (!env.BUCKET) throw new AppError(503, "files_unavailable", "Private file storage is not connected yet.");
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new AppError(415, "multipart_required", "Choose a file to upload.");
    const bytes = await boundedBody(request, 21 * 1024 * 1024);
    const form = await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type")! }, body: bytes }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024) throw new AppError(400, "invalid_file", "Choose a non-empty file smaller than 20 MB.");
    const id = crypto.randomUUID(), name = file.name.replace(/[\x00-\x1f\/\\]/g, "_").slice(0, 240) || "attachment", contentType = file.type || "application/octet-stream";
    const key = `private/${encodeURIComponent(user)}/${id}`;
    await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType } }); uploaded = key;
    await database().prepare("INSERT INTO files(id,user_id,name,content_type,size,created_at) VALUES(?,?,?,?,?,?)").bind(id, user, name, contentType, file.size, new Date().toISOString()).run();
    return json({ id, name, size: file.size, url: `/api/files/${id}` }, 201);
  } catch (e) { if (uploaded && env.BUCKET) await env.BUCKET.delete(uploaded).catch(() => {}); return failure(e); }
}
