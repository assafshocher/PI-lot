import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
export const records = sqliteTable("records", {
  id: text("id").notNull(), userId: text("user_id").notNull(), kind: text("kind").notNull(),
  revision: integer("revision").notNull().default(1), dataJson: text("data_json").notNull(),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"), lastMutationId: text("last_mutation_id").notNull(),
}, t => [primaryKey({ columns: [t.userId, t.id] }), index("records_user_kind").on(t.userId, t.kind, t.deletedAt)]);
export const labLinks = sqliteTable("lab_links", {
  userId: text("user_id").notNull(), projectId: text("project_id").notNull(), studentId: text("student_id").notNull(), createdAt: text("created_at").notNull(),
}, t => [primaryKey({ columns: [t.userId, t.projectId, t.studentId] })]);
export const mutations = sqliteTable("mutations", {
  userId: text("user_id").notNull(), key: text("key").notNull(), requestHash: text("request_hash").notNull(), attemptId: text("attempt_id").notNull(), responseJson: text("response_json"), createdAt: text("created_at").notNull(),
}, t => [primaryKey({ columns: [t.userId, t.key] }), uniqueIndex("mutations_attempt").on(t.attemptId)]);
export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), recordId: text("record_id").notNull(), action: text("action").notNull(), revision: integer("revision"), dataJson: text("data_json"), createdAt: text("created_at").notNull(),
}, t => [index("audit_user_record").on(t.userId, t.recordId, t.createdAt)]);
export const files = sqliteTable("files", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), name: text("name").notNull(), contentType: text("content_type").notNull(), size: integer("size").notNull(), createdAt: text("created_at").notNull(),
}, t => [index("files_user").on(t.userId)]);
