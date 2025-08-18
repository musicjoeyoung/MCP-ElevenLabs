import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  script: text("script").notNull(),
  audioFileKey: text("audio_file_key"),
  durationSeconds: integer("duration_seconds"),
  status: text("status", { enum: ["generating", "completed", "failed"] }).notNull().default("generating"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const generationRequests = sqliteTable("generation_requests", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  episodeId: text("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  sourceType: text("source_type", { enum: ["code", "file", "discussion", "project"] }).notNull(),
  sourceContent: text("source_content").notNull(),
  sourceMetadata: text("source_metadata", { mode: "json" }).$type<Record<string, any>>(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const episodesRelations = relations(episodes, ({ many }) => ({
  generationRequests: many(generationRequests),
}));

export const generationRequestsRelations = relations(generationRequests, ({ one }) => ({
  episode: one(episodes, {
    fields: [generationRequests.episodeId],
    references: [episodes.id],
  }),
}));