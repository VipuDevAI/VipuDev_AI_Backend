import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/* ============================================================
   USERS
============================================================ */
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

/* ============================================================
   PROJECTS
============================================================ */
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  files: jsonb("files").notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

/* ============================================================
   CHAT MESSAGES (🔥 with per-project memory)
============================================================ */
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),

  role: text("role").notNull(),           // "user" | "assistant"
  content: text("content").notNull(),
  codeContext: text("code_context"),

  // 🔥 NEW: per-project context — each project has its own memory
  projectId: varchar("project_id")
    .references(() => projects.id)
    .default(null),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

/* ============================================================
   LONG-TERM MEMORY SUMMARIES (🔥 NEW — Replit Killer)
============================================================ */
export const memorySummaries = pgTable("memory_summaries", {
  id: serial("id").primaryKey(),

  // Which project this summary belongs to
  projectId: varchar("project_id")
    .references(() => projects.id)
    .default(null),

  // Condensed memory text (GPT-generated summary)
  summary: text("summary").notNull(),

  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMemorySummarySchema = createInsertSchema(memorySummaries).omit({
  id: true,
  updatedAt: true,
});

export type InsertMemorySummary = z.infer<typeof insertMemorySummarySchema>;
export type MemorySummary = typeof memorySummaries.$inferSelect;

/* ============================================================
   CODE EXECUTIONS
============================================================ */
export const codeExecutions = pgTable("code_executions", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  language: text("language").notNull(),
  output: text("output"),
  error: text("error"),
  exitCode: text("exit_code"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCodeExecutionSchema = createInsertSchema(codeExecutions).omit({
  id: true,
  createdAt: true,
});

export type InsertCodeExecution = z.infer<typeof insertCodeExecutionSchema>;
export type CodeExecution = typeof codeExecutions.$inferSelect;

/* ============================================================
   USER CONFIG
============================================================ */
export const userConfig = pgTable("user_config", {
  id: serial("id").primaryKey(),
  backendUrl: text("backend_url"),
  apiKey: text("api_key"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserConfigSchema = createInsertSchema(userConfig).omit({
  id: true,
  updatedAt: true,
});

export type InsertUserConfig = z.infer<typeof insertUserConfigSchema>;
export type UserConfig = typeof userConfig.$inferSelect;
