import { z } from "zod";
import { database, getRecord } from "@/lib/data";
import { idSchema, parse } from "@/lib/domain";
import { authorized, failure, json } from "@/lib/data-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = authorized(request), { record_id } = parse(z.object({ record_id: idSchema }), Object.fromEntries(new URL(request.url).searchParams));
    await getRecord(user, record_id);
    const { results } = await database().prepare("SELECT action,revision,data_json,created_at FROM audit_events WHERE user_id=? AND record_id=? ORDER BY created_at DESC LIMIT 100").bind(user, record_id).all<{ action: string; revision: number; data_json: string; created_at: string }>();
    return json({ events: results.map(({ data_json, ...rest }) => ({ ...rest, data: data_json ? JSON.parse(data_json) : null })) });
  } catch (e) { return failure(e); }
}
