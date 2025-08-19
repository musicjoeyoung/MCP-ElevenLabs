import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";

export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  script: text("script"),
  audioUrl: text("audio_url"),
  status: text("status").notNull().default("pending"),
  sourceContent: text("source_content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(CURRENT_TIMESTAMP)`),
  durationSeconds: integer("duration_seconds"),
});

export const hosts = sqliteTable("hosts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  voiceId: text("voice_id").notNull(),
  personality: text("personality").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const episodeHosts = sqliteTable("episode_hosts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  episodeId: text("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  hostId: text("host_id").notNull().references(() => hosts.id, { onDelete: "cascade" }),
});

export const episodesRelations = relations(episodes, ({ many }) => ({
  episodeHosts: many(episodeHosts),
}));

export const hostsRelations = relations(hosts, ({ many }) => ({
  episodeHosts: many(episodeHosts),
}));

export const episodeHostsRelations = relations(episodeHosts, ({ one }) => ({
  episode: one(episodes, {
    fields: [episodeHosts.episodeId],
    references: [episodes.id],
  }),
  host: one(hosts, {
    fields: [episodeHosts.hostId],
    references: [hosts.id],
  }),
}));