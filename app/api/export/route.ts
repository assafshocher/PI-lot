import { exportData } from "@/lib/data";
import { authorized, failure, json } from "@/lib/data-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const user = authorized(request); const response = json(await exportData(user)); response.headers.set("Content-Disposition", `attachment; filename="workspace-backup-${new Date().toISOString().slice(0, 10)}.json"`); return response; } catch (e) { return failure(e); } }
