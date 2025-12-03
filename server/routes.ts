import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertProjectSchema, 
  insertChatMessageSchema,
  insertCodeExecutionSchema,
  insertUserConfigSchema 
} from "@shared/schema";
import { z } from "zod";
import crypto from "crypto";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const tokens = new Set<string>();

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // ============ AUTH ROUTES ============
  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body;
    
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      const token = generateToken();
      tokens.add(token);
      res.json({ token, message: "Login successful" });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.get("/api/auth/verify", (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace("Bearer ", "");
    
    if (token && tokens.has(token)) {
      res.json({ valid: true });
    } else {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace("Bearer ", "");
    
    if (token) {
      tokens.delete(token);
    }
    res.json({ message: "Logged out" });
  });

  // ============ PROJECT ROUTES ============
  app.get("/api/projects", async (req, res) => {
    try {
      const projects = await storage.getProjects();
      res.json({ projects });
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      res.json({ project });
    } catch (error) {
      console.error("Error fetching project:", error);
      res.status(500).json({ error: "Failed to fetch project" });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const data = insertProjectSchema.parse(req.body);
      const project = await storage.createProject(data);
      res.status(201).json({ project });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid project data", details: error.errors });
      }
      console.error("Error creating project:", error);
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const data = insertProjectSchema.partial().parse(req.body);
      const project = await storage.updateProject(req.params.id, data);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      res.json({ project });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid project data", details: error.errors });
      }
      console.error("Error updating project:", error);
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteProject(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Project not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting project:", error);
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  // ============ CHAT ROUTES ============
  app.get("/api/chat/history", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const messages = await storage.getChatMessages(limit);
      res.json({ messages });
    } catch (error) {
      console.error("Error fetching chat history:", error);
      res.status(500).json({ error: "Failed to fetch chat history" });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const data = insertChatMessageSchema.parse(req.body);
      const message = await storage.createChatMessage(data);
      res.status(201).json({ message });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid message data", details: error.errors });
      }
      console.error("Error creating chat message:", error);
      res.status(500).json({ error: "Failed to create message" });
    }
  });

  app.delete("/api/chat/history", async (req, res) => {
    try {
      await storage.clearChatHistory();
      res.json({ success: true });
    } catch (error) {
      console.error("Error clearing chat history:", error);
      res.status(500).json({ error: "Failed to clear chat history" });
    }
  });

  // ============ CODE EXECUTION ROUTES ============
  app.get("/api/executions", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const executions = await storage.getCodeExecutions(limit);
      res.json({ executions });
    } catch (error) {
      console.error("Error fetching executions:", error);
      res.status(500).json({ error: "Failed to fetch executions" });
    }
  });

  app.post("/api/executions", async (req, res) => {
    try {
      const data = insertCodeExecutionSchema.parse(req.body);
      const execution = await storage.createCodeExecution(data);
      res.status(201).json({ execution });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid execution data", details: error.errors });
      }
      console.error("Error creating execution:", error);
      res.status(500).json({ error: "Failed to create execution" });
    }
  });

  // ============ CONFIG ROUTES ============
  app.get("/api/config", async (req, res) => {
    try {
      const config = await storage.getConfig();
      res.json({ config: config || {} });
    } catch (error) {
      console.error("Error fetching config:", error);
      res.status(500).json({ error: "Failed to fetch config" });
    }
  });

  app.post("/api/config", async (req, res) => {
    try {
      const data = insertUserConfigSchema.parse(req.body);
      const config = await storage.updateConfig(data);
      res.json({ config });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid config data", details: error.errors });
      }
      console.error("Error updating config:", error);
      res.status(500).json({ error: "Failed to update config" });
    }
  });

  return httpServer;
}
