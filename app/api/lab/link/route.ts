import { setLabLink } from "@/lib/data";
import { linkSchema, parse } from "@/lib/domain";
import { authorized, failure, json, readJson } from "@/lib/data-http";
export async function POST(request: Request) { try { const user = authorized(request, true); return json(await setLabLink(user, parse(linkSchema, await readJson(request)))); } catch (e) { return failure(e); } }
