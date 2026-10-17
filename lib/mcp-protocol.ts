import { z } from "zod";

// MCP Request.params includes optional transport metadata in addition to the
// method's fields. It is not tool input and must never supply caller identity.
// https://modelcontextprotocol.io/specification/2025-03-26/basic
const metadata = z.object({ progressToken: z.union([z.string(), z.number().finite()]).optional() }).catchall(z.unknown());

export const rpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number().int().finite()]).optional(),
  method: z.string().min(1).max(200),
  params: z.record(z.unknown()).optional()
}).strict().superRefine((rpc, context) => {
  const notification = rpc.method.startsWith("notifications/");
  if (notification ? rpc.id !== undefined : rpc.id === undefined) {
    context.addIssue({ code: "custom", path: ["id"], message: notification ? "Notifications must not include an id." : "Requests require a string or integer id." });
  }
});

export const toolCallParamsSchema = z.object({
  name: z.string().min(1).max(200),
  arguments: z.record(z.unknown()).optional().default({}),
  _meta: metadata.optional()
}).strict();
