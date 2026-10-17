import { writeRecord } from "@/lib/data";
import { idSchema, parse, revisionSchema } from "@/lib/domain";
import { authorized, failure, json, readJson } from "@/lib/data-http";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { try { const user = authorized(request, true); return json({ record: await writeRecord(user, { ...parse(revisionSchema, await readJson(request)), id: parse(idSchema, (await context.params).id) }, "restore") }); } catch (e) { return failure(e); } }
