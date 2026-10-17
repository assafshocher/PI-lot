import { z } from "zod";
import { importData } from "@/lib/data";
import { idSchema, kinds, parse } from "@/lib/domain";
import { authorized, failure, json, readJson } from "@/lib/data-http";
const schema = z.object({ records: z.array(z.object({ id: idSchema, kind: z.enum(kinds), data: z.record(z.unknown()), deleted_at: z.string().datetime({ offset: true }).nullable().optional(), created_at: z.string().datetime({ offset: true }).optional() })).max(2000), links: z.array(z.object({ project_id: idSchema, student_id: idSchema })).max(5000).optional(), mode: z.literal("merge").optional() });
export async function POST(request: Request) { try { const user = authorized(request, true); return json(await importData(user, parse(schema, await readJson(request, 8 * 1024 * 1024)))); } catch (e) { return failure(e); } }
