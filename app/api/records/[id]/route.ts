import { getRecord, writeRecord } from "@/lib/data";
import { idSchema, parse, revisionSchema, updateSchema } from "@/lib/domain";
import { authorized, failure, json, readJson } from "@/lib/data-http";
type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: Context) { try { const user = authorized(request); return json({ record: await getRecord(user, parse(idSchema, (await context.params).id)) }); } catch (e) { return failure(e); } }
export async function PATCH(request: Request, context: Context) { try { const user = authorized(request, true); return json({ record: await writeRecord(user, { ...parse(updateSchema, await readJson(request)), id: parse(idSchema, (await context.params).id) }, "update") }); } catch (e) { return failure(e); } }
export async function DELETE(request: Request, context: Context) { try { const user = authorized(request, true); return json({ record: await writeRecord(user, { ...parse(revisionSchema, await readJson(request)), id: parse(idSchema, (await context.params).id) }, "archive") }); } catch (e) { return failure(e); } }
