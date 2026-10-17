import { z } from "zod";
import { listRecords, writeRecord } from "@/lib/data";
import { createSchema, dateSchema, kinds, parse } from "@/lib/domain";
import { authorized, failure, json, readJson } from "@/lib/data-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = authorized(request), params = Object.fromEntries(new URL(request.url).searchParams);
    const options = parse(z.object({ kind: z.enum(kinds).optional(), query: z.string().max(240).optional(), archived: z.enum(["true", "false", "all"]).optional(), date: dateSchema.optional(), limit: z.coerce.number().int().min(1).max(2000).optional(), offset: z.coerce.number().int().min(0).max(100000).optional() }).strict(), params);
    return json(await listRecords(user, options));
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) { try { const user = authorized(request, true); return json({ record: await writeRecord(user, parse(createSchema, await readJson(request))) }, 201); } catch (e) { return failure(e); } }
