import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const healthChecks = sqliteTable("health_checks", {
  id: integer("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});
