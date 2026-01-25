import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    pubkey: text("pubkey").notNull(),
    created_at: integer("created_at").notNull(),
    kind: integer("kind").notNull(),
    content: text("content").notNull(),
    sig: text("sig").notNull(),
  },
  (table) => [
    index("idx_events_pubkey").on(table.pubkey),
    index("idx_events_created_at").on(table.created_at),
    index("idx_events_kind").on(table.kind),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: text("value").notNull(),
  },
  (table) => [index("idx_tags_name_value").on(table.name, table.value)],
);

export const eventsRelations = relations(events, ({ many }) => ({
  tags: many(tags),
}));

export const tagsRelations = relations(tags, ({ one }) => ({
  event: one(events, {
    fields: [tags.eventId],
    references: [events.id],
  }),
}));
