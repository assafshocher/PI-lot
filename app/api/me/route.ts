import { authorized, failure, json } from "@/lib/data-http";
import { trustedAuth } from "@/lib/auth-context";
import { WORKSPACE_KIND, workspaceName } from "@/lib/workspace";
export async function GET(request: Request) {
  try {
    const user_id = authorized(request), auth = trustedAuth()!;
    return json({ user_id, display_name: auth.method === "demo" ? "Fictional demo" : "Workspace owner", csrf_token: auth.csrfToken, ai_mode: "bring_your_own_assistant", data_scope: "private_single_owner", app: WORKSPACE_KIND, app_name: workspaceName, demo: auth.method === "demo" });
  } catch (e) { return failure(e); }
}
