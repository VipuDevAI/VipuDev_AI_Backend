import { 
  type User, 
  type InsertUser,
  type Project,
  type InsertProject,
  type ChatMessage,
  type InsertChatMessage,
  type CodeExecution,
  type InsertCodeExecution,
  type UserConfig,
  type InsertUserConfig,
  users,
  projects,
  chatMessages,
  codeExecutions,
  userConfig
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Project operations
  getProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, project: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<boolean>;

  // Chat operations
  getChatMessages(limit?: number): Promise<ChatMessage[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  clearChatHistory(): Promise<void>;

  // Code execution operations
  getCodeExecutions(limit?: number): Promise<CodeExecution[]>;
  createCodeExecution(execution: InsertCodeExecution): Promise<CodeExecution>;

  // Config operations
  getConfig(): Promise<UserConfig | undefined>;
  updateConfig(config: InsertUserConfig): Promise<UserConfig>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // Project operations
  async getProjects(): Promise<Project[]> {
    return db.select().from(projects).orderBy(desc(projects.updatedAt));
  }

  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return project;
  }

  async createProject(project: InsertProject): Promise<Project> {
    const [newProject] = await db.insert(projects).values(project).returning();
    return newProject;
  }

  async updateProject(id: string, project: Partial<InsertProject>): Promise<Project | undefined> {
    const [updated] = await db
      .update(projects)
      .set({ ...project, updatedAt: sql`NOW()` })
      .where(eq(projects.id, id))
      .returning();
    return updated;
  }

  async deleteProject(id: string): Promise<boolean> {
    const result = await db.delete(projects).where(eq(projects.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Chat operations
  async getChatMessages(limit: number = 50): Promise<ChatMessage[]> {
    return db.select().from(chatMessages).orderBy(chatMessages.createdAt).limit(limit);
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [newMessage] = await db.insert(chatMessages).values(message).returning();
    return newMessage;
  }

  async clearChatHistory(): Promise<void> {
    await db.delete(chatMessages);
  }

  // Code execution operations
  async getCodeExecutions(limit: number = 20): Promise<CodeExecution[]> {
    return db.select().from(codeExecutions).orderBy(desc(codeExecutions.createdAt)).limit(limit);
  }

  async createCodeExecution(execution: InsertCodeExecution): Promise<CodeExecution> {
    const [newExecution] = await db.insert(codeExecutions).values(execution).returning();
    return newExecution;
  }

  // Config operations
  async getConfig(): Promise<UserConfig | undefined> {
    const [config] = await db.select().from(userConfig).limit(1);
    return config;
  }

  async updateConfig(config: InsertUserConfig): Promise<UserConfig> {
    const existing = await this.getConfig();
    
    if (existing) {
      const [updated] = await db
        .update(userConfig)
        .set({ ...config, updatedAt: sql`NOW()` })
        .where(eq(userConfig.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(userConfig).values(config).returning();
      return created;
    }
  }
}

export const storage = new DatabaseStorage();
