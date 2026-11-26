import {
  type AnyPgColumn,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import type { StoryMapStoryStatus, ScratchNoteStatus } from "@paperclipai/shared";

/** One user story map per company (PF-02). */
export const storyMaps = pgTable(
  "story_maps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUniqueIdx: uniqueIndex("story_maps_company_uq").on(table.companyId),
  }),
);

/** Backbone level 1: a user activity, ordered left to right. */
export const storyMapActivities = pgTable(
  "story_map_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    mapId: uuid("map_id").notNull().references(() => storyMaps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    mapPositionIdx: index("story_map_activities_map_position_idx").on(table.mapId, table.position),
  }),
);

/** Backbone level 2: a task under an activity, ordered left to right. */
export const storyMapTasks = pgTable(
  "story_map_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    mapId: uuid("map_id").notNull().references(() => storyMaps.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id").notNull().references(() => storyMapActivities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    activityPositionIdx: index("story_map_tasks_activity_position_idx").on(table.activityId, table.position),
    mapIdx: index("story_map_tasks_map_idx").on(table.mapId),
  }),
);

/** Horizontal release row. Stories in no release are "Unscheduled". */
export const storyMapReleases = pgTable(
  "story_map_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    mapId: uuid("map_id").notNull().references(() => storyMaps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetDate: date("target_date", { mode: "string" }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    mapPositionIdx: index("story_map_releases_map_position_idx").on(table.mapId, table.position),
  }),
);

/** Optional level 3 under a task, ordered top to bottom. */
export const storyMapEpics = pgTable(
  "story_map_epics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    mapId: uuid("map_id").notNull().references(() => storyMaps.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull().references(() => storyMapTasks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    taskPositionIdx: index("story_map_epics_task_position_idx").on(table.taskId, table.position),
    mapIdx: index("story_map_epics_map_idx").on(table.mapId),
  }),
);

/** Level 4: a story under a task, optionally inside an epic and a release. */
export const storyMapStories = pgTable(
  "story_map_stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    mapId: uuid("map_id").notNull().references(() => storyMaps.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull().references(() => storyMapTasks.id, { onDelete: "cascade" }),
    epicId: uuid("epic_id").references(() => storyMapEpics.id, { onDelete: "set null" }),
    releaseId: uuid("release_id").references(() => storyMapReleases.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    acceptanceCriteria: text("acceptance_criteria"),
    size: text("size"),
    status: text("status").$type<StoryMapStoryStatus>().notNull().default("planned"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    taskPositionIdx: index("story_map_stories_task_position_idx").on(table.taskId, table.position),
    releaseIdx: index("story_map_stories_release_idx").on(table.releaseId),
    epicIdx: index("story_map_stories_epic_idx").on(table.epicId),
    mapIdx: index("story_map_stories_map_idx").on(table.mapId),
  }),
);

/** Plain-text idea written by a company member (PF-02 scratch pad). */
export const scratchNotes = pgTable(
  "scratch_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").notNull(),
    body: text("body").notNull(),
    status: text("status").$type<ScratchNoteStatus>().notNull().default("active"),
    promotedStoryId: uuid("promoted_story_id").references((): AnyPgColumn => storyMapStories.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("scratch_notes_company_created_idx").on(table.companyId, table.createdAt),
  }),
);
