# Connect your assistant

PIA exposes a remote Model Context Protocol (MCP) endpoint at **`https://YOUR-APP-ORIGIN/mcp`**. It provides structured tools for workspace context, searching and reading records, safe edits, archiving/restoration, and people–project relationships.

The assistant runs in its own product. PIA does not run a model, buy inference, or turn a ChatGPT subscription into an API key. You can use an assistant's existing subscription when that product permits your remote MCP connection. Its plan, admin policies, tool approvals and usage limits still apply.

## Before connecting

- Deploy your private copy and verify browser login first.
- Use the exact configured HTTPS origin, ending in `/mcp`.
- Choose a client with remote/Streamable HTTP MCP and OAuth support. Browser-only login cookies are not MCP credentials.
- Complete the PIA sign-in and consent screen yourself. Do not give your owner password to the model or put it in an MCP configuration file.

PIA uses OAuth authorization with PKCE. The owner approves each connection. OAuth tokens grant access to the same single-owner workspace visible in the browser. Review a client's requested permissions before approving it.

## Codex

With a current Codex CLI installed:

```sh
codex mcp add pia --url https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
codex mcp login pia
```

Follow the browser sign-in and consent flow. Use `codex mcp list` to inspect configuration, or `/mcp` within the Codex terminal interface to inspect active servers. These commands follow the [official Codex MCP guide](https://developers.openai.com/codex/mcp/); consult it if your installed version uses different options.

Alternatively, a remote server entry in Codex configuration uses:

```toml
[mcp_servers.pia]
url = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp"
```

Then run `codex mcp login pia`. Configuring a URL alone does not grant access.

## ChatGPT

Custom app/MCP availability varies by plan, workspace policy and client. Check the current [OpenAI developer-mode and MCP instructions](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt) for your account.

Where your account offers custom MCP apps, create an app using your `/mcp` URL, select OAuth, complete PIA's authorization, and let the client scan its tools. Do not select unauthenticated access for a private workspace. A local Codex configuration does not automatically create a ChatGPT web app.

This project does not promise access to custom MCP apps on every ChatGPT subscription, and it is not a published app-store listing. The setup instructions describe the supported protocol; a successful connection must still be verified in the client you use.

## Other MCP clients

Use the client's **remote MCP / Streamable HTTP** connection flow with the same `/mcp` URL and OAuth. The server supports Client ID Metadata Documents (CIMD) and the registration behavior provided by its pinned Cloudflare OAuth library. Older clients may need updating. A client that supports only local stdio servers or only unauthenticated remote URLs will need an appropriate supported bridge or a different client; do not disable PIA's authentication to make it connect.

The authorization implementation uses [Cloudflare's Workers OAuth Provider](https://github.com/cloudflare/workers-oauth-provider). See also Cloudflare's [MCP authorization guide](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/).

## Verify it, then use it

Start with:

> Read my PIA workspace context. Summarize active projects, people needing follow-up and upcoming deadlines. Do not change any records yet.

The answer should contain records from your own workspace. Then try a small, explicit change:

> Add a prospective student named Alex Example. We have only exchanged email; they have not been accepted for a project. Set the next action to “Arrange an introductory meeting.” Confirm the saved record.

Check the saved person in the browser. A model saying it made a change is not enough; the corresponding tool call must have succeeded and the record should be present.

Other useful requests:

- “Suggest suitable conference targets for this project. Keep them as recommendations, give a rationale, and preserve uncertainty about unannounced dates.”
- “Record this actual submission and its venue, preserving the earlier rejected submission.”
- “Read these authorized source messages and save a dated project update with source links. Distinguish facts from your interpretation.”
- “Prepare a lab meeting agenda from current projects and next actions.”

Edits use current record revisions and action keys to catch conflicting changes and avoid duplicate retries. Project status does not establish that a paper was submitted, accepted or rejected; those decisions remain explicit per-venue records.

## Slack, email and schedules

PIA does not include a Slack bot or an email connector. An assistant with separately authorized Slack/email tools can read relevant material, update PIA through MCP and, when you authorize it, post a summary. Sending messages and recurring updates require their own permissions and setup in that assistant. No recurring monitor is enabled by connecting PIA alone.

## Revoke access

Visit **`/auth/connections`** while signed in to review and revoke grants. Remove the connection in the assistant as well if you no longer need it. Logging out of the browser and revoking an assistant are separate actions; see [security](../SECURITY.md).

OAuth grants use Cloudflare KV, whose updates are eventually consistent across locations. Allow for propagation delay after connecting or revoking a client; revocation is not an instantaneous global cutoff. It cannot erase information an assistant has already read. See [Cloudflare's consistency explanation](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

## Compatibility status

The video demonstrates a real ChatGPT read and write on a private Sites-hosted demo, with the saved changes verified in the app. That demo uses Sites-managed authentication. The standalone Worker's MCP and OAuth flows have passed local integration tests; a fresh Cloudflare deployment and ChatGPT OAuth onboarding for that deployment have not yet been tested end to end. Verify one read and one authorized write on your own installation. Client instructions are based on the linked official documentation, and availability can vary by product, plan and version.
