import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";

import {
  insertProjectSchema,
  insertChatMessageSchema,
  insertCodeExecutionSchema,
  insertUserConfigSchema,
} from "@shared/schema";

import { z } from "zod";
import crypto from "crypto";
import OpenAI from "openai";
import { exec, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import multer from "multer";
import AdmZip from "adm-zip";

// ===================================================================================
// BASIC ADMIN AUTH
// ===================================================================================
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const tokens = new Set<string>();
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ===================================================================================
// OPENAI + UPLOADS
// ===================================================================================
const openaiApiKey = process.env.OPENAI_API_KEY || "";
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

const upload = multer({
  dest: path.join(os.tmpdir(), "vipudev-uploads"),
});

// ===================================================================================
// VIPUDEVAI PERSONALITY ENGINE
// ===================================================================================
const VIPU_SYSTEM_PROMPT = `
You are VipuDevAI, a highly advanced AI developer assistant for Balaji.

Rules:
- Never reply with "I can't", "I don't know", or similar negative phrases.
- Always provide a working answer, even if assumptions are needed.
- Think like a senior full-stack engineer and architect.
- Give complete, ready-to-run code.
- Keep responses structured with headings, bullet points, and full examples.
`;

// Fetch memory from DB
async function buildVipuMessages(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  codeContext?: string,
) {
  let memory = "";
  try {
    const history = await storage.getChatMessages(20);
    memory =
      history
        ?.map(
          (m) => `${m.role || "user"}: ${(m as any).content ?? m.message ?? ""}`,
        )
        .join("\n") || "";
  } catch {
    // ignore memory issues
  }

  const base: any[] = [
    {
      role: "system",
      content: `${VIPU_SYSTEM_PROMPT}\n\nMEMORY:\n${memory || "(none)"}`,
    },
  ];

  if (codeContext) {
    base.push({
      role: "user",
      content: `Here is the current code/project context:\n${codeContext}`,
    });
  }

  return [...base, ...messages];
}

// ===================================================================================
// REGISTER ROUTES
// ===================================================================================
export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // ===========================
  // AUTH ROUTES
  // ===========================
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
    if (token && tokens.has(token)) return res.json({ valid: true });

    res.status(401).json({ error: "Invalid token" });
  });

  app.post("/api/auth/logout", (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace("Bearer ", "");
    if (token) tokens.delete(token);
    res.json({ message: "Logged out" });
  });

  // ===========================
  // PROJECT ROUTES
  // ===========================
  app.get("/api/projects", async (_req, res) => {
    try {
      res.json({ projects: await storage.getProjects() });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      res.json({ project });
    } catch {
      res.status(500).json({ error: "Failed to fetch project" });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const data = insertProjectSchema.parse(req.body);
      res.status(201).json({ project: await storage.createProject(data) });
    } catch (e) {
      if (e instanceof z.ZodError)
        return res.status(400).json({ error: "Invalid project data", details: e.errors });
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const data = insertProjectSchema.partial().parse(req.body);
      const project = await storage.updateProject(req.params.id, data);
      if (!project) return res.status(404).json({ error: "Project not found" });
      res.json({ project });
    } catch (e) {
      if (e instanceof z.ZodError)
        return res.status(400).json({ error: "Invalid project data", details: e.errors });
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const del = await storage.deleteProject(req.params.id);
      if (!del) return res.status(404).json({ error: "Project not found" });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  // ===========================
  // CHAT HISTORY ROUTES
  // ===========================
  app.get("/api/chat/history", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      res.json({ messages: await storage.getChatMessages(limit) });
    } catch {
      res.status(500).json({ error: "Failed to fetch chat history" });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const data = insertChatMessageSchema.parse(req.body);
      res.status(201).json({ message: await storage.createChatMessage(data) });
    } catch (e) {
      if (e instanceof z.ZodError)
        return res.status(400).json({ error: "Invalid message data", details: e.errors });
      res.status(500).json({ error: "Failed to save message" });
    }
  });

  app.delete("/api/chat/history", async (_req, res) => {
    try {
      await storage.clearChatHistory();
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to clear history" });
    }
  });

  // ===========================
  // CODE EXECUTION METADATA
  // ===========================
  app.get("/api/executions", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      res.json({ executions: await storage.getCodeExecutions(limit) });
    } catch {
      res.status(500).json({ error: "Failed to fetch executions" });
    }
  });

  app.post("/api/executions", async (req, res) => {
    try {
      const data = insertCodeExecutionSchema.parse(req.body);
      res.status(201).json({ execution: await storage.createCodeExecution(data) });
    } catch (e) {
      if (e instanceof z.ZodError)
        return res.status(400).json({ error: "Invalid execution data", details: e.errors });
      res.status(500).json({ error: "Failed to create execution" });
    }
  });

  // ===================================================================================
  // VIPUDEVAI INTELLIGENCE / AI CHAT
  // ===================================================================================
  app.post("/api/assistant/chat", async (req, res) => {
    if (!openai)
      return res.status(500).json({ error: "OpenAI API key missing" });

    try {
      const { messages, codeContext } = req.body;

      const finalMessages = await buildVipuMessages(messages || [], codeContext);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: finalMessages,
        temperature: 0.1,
        max_tokens: 4000,
      });

      res.json({ reply: completion.choices[0]?.message?.content || "" });
    } catch (err) {
      res.status(500).json({ error: "Assistant failed" });
    }
  });

  // ===================================================================================
  // SIMPLE CODE RUNNER (JS/Python)
  // ===================================================================================
  app.post("/api/run", async (req, res) => {
    const { code, language } = req.body;
    if (!code) return res.status(400).json({ error: "Code required" });

    const lang = language === "python" ? "python" : "javascript";
    const ext = lang === "python" ? ".py" : ".js";
    const cmd = lang === "python" ? "python3" : "node";

    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vipurun-"));
      const filePath = path.join(dir, "main" + ext);

      fs.writeFileSync(filePath, code);

      exec(`${cmd} "${filePath}"`, { timeout: 8000 }, (error, stdout, stderr) => {
        res.json({
          stdout,
          stderr,
          exitCode: (error as any)?.code || 0,
          timedOut: !!(error as any)?.killed,
        });

        fs.rmSync(dir, { force: true, recursive: true });
      });
    } catch {
      res.status(500).json({ error: "Failed to execute" });
    }
  });

  // ===================================================================================
  // DOCKER SANDBOX EXECUTION
  // ===================================================================================
  app.post("/api/run-project", async (req, res) => {
    const { files, language, command } = req.body;
    if (!files || !Array.isArray(files)) {
      return res.status(400).json({ error: "files[] required" });
    }

    const lang = (language || "node").toLowerCase();
    const image = lang === "python" ? "python:3.11" : "node:18";
    const defaultCmd = lang === "python" ? "python main.py" : "node main.js";

    let tempDir = "";
    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vipuproject-"));

      for (const f of files) {
        const safe = f.path.replace(/^[/\\]+/, "");
        const dest = path.join(tempDir, safe || "main.js");
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.content ?? "");
      }

      const dockerArgs = [
        "run",
        "--rm",
        "--network",
        "none",
        "--memory",
        "512m",
        "--cpus",
        "1",
        "-v",
        `${tempDir}:/app`,
        "-w",
        "/app",
        image,
        "bash",
        "-lc",
        command || defaultCmd,
      ];

      let stdout = "";
      let stderr = "";

      const child = spawn("docker", dockerArgs);
      const timeout = setTimeout(() => child.kill("SIGKILL"), 20000);

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("close", (code) => {
        clearTimeout(timeout);
        fs.rmSync(tempDir, { recursive: true, force: true });

        res.json({
          stdout,
          stderr,
          exitCode: code,
          imageUsed: image,
        });
      });
    } catch (e) {
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
      res.status(500).json({ error: "Docker execution failed" });
    }
  });

  // ===================================================================================
  // ZIP CREATOR
  // ===================================================================================
  app.post("/api/zip-code", (req, res) => {
    const { code, language, filename } = req.body;
    if (!code) return res.status(400).json({ error: "Code required" });

    const ext =
      (filename && filename.split(".").pop()) ||
      (language === "python" ? "py" : "js");

    const safeName =
      (filename && filename.replace(/[^\w.\-]/g, "")) || `main.${ext}`;

    try {
      const zip = new AdmZip();
      zip.addFile(safeName, Buffer.from(code));
      const buffer = zip.toBuffer();

      res.set({
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="vipudevai.zip"',
      });
      res.send(buffer);
    } catch {
      res.status(500).json({ error: "ZIP creation failed" });
    }
  });

  // ===================================================================================
  // ZIP ANALYZER (AI)
  // ===================================================================================
  app.post("/api/analyze-zip", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "File required" });
    if (!openai) return res.status(500).json({ error: "API key missing" });

    const zipPath = req.file.path;

    try {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();

      const files: string[] = [];
      for (const e of entries) {
        if (files.length >= 30) break;
        if (e.isDirectory) continue;

        const name = e.entryName;
        if (/\.(png|jpg|jpeg|gif|mp4|mp3|ico|pdf)$/i.test(name)) continue;

        const data = e.getData();
        const content = data.toString("utf8").slice(0, 20000);
        files.push(`--- FILE: ${name} ---\n${content}`);
      }

      const msgs = await buildVipuMessages(
        [
          {
            role: "user",
            content:
              "Analyze my uploaded ZIP. Describe tech stack, architecture, issues, improvements.",
          },
          { role: "user", content: files.join("\n\n") },
        ],
        undefined,
      );

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: msgs,
        temperature: 0.2,
        max_tokens: 4000,
      });

      res.json({
        analysis: completion.choices[0]?.message?.content || "",
        sampledFiles: files.length,
      });
    } catch {
      res.status(500).json({ error: "Failed to analyze ZIP" });
    } finally {
      fs.unlinkSync(zipPath);
    }
  });

  // ===================================================================================
  // DALL·E IMAGE GENERATION
  // ===================================================================================
  app.post("/api/generate-image", async (req, res) => {
    if (!openai)
      return res.status(500).json({ error: "API key missing" });

    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    try {
      const result = await openai.images.generate({
        model: "dall-e-3",
        prompt,
        size: "1024x1024",
        n: 1,
      });

      res.json({ url: result.data[0]?.url });
    } catch {
      res.status(500).json({ error: "Image generation failed" });
    }
  });

  // ===================================================================================
  // DEPLOYMENT GUIDE
  // ===================================================================================
  app.post("/api/deploy", async (req, res) => {
    const { platform } = req.body;
    if (!platform) return res.status(400).json({ error: "platform required" });

    let logs = "";

    switch (platform.toLowerCase()) {
      case "vercel":
        logs = `
To deploy to Vercel:
1. npm i -g vercel
2. vercel && vercel --prod
3. Add OPENAI_API_KEY, DATABASE_URL in Vercel Dashboard.
`;
        break;

      case "render":
        logs = `
To deploy to Render:
1. Push repo to GitHub.
2. Create Web Service in Render.
3. Build: npm install && npm run build
4. Start: node dist/server/index.js
5. Add environment variables in Render Dashboard.
`;
        break;

      case "railway":
        logs = `
To deploy to Railway:
1. npm i -g @railway/cli
2. railway login
3. railway up
4. Add environment variables.
`;
        break;

      default:
        logs = "Unknown platform. Use: vercel | render | railway.";
    }

    res.json({ success: true, logs });
  });

  // ===================================================================================
  return httpServer;
}
