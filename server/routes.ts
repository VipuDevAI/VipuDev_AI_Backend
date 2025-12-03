import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  insertProjectSchema,
  insertChatMessageSchema,
  insertCodeExecutionSchema,
  insertUserConfigSchema,
} from "@shared/schema";
import { z } from "zod";
import crypto from "crypto";

// 🔥 NEW IMPORTS FOR VipuDevAI POWER FEATURES
import OpenAI from "openai";
import { exec, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import multer from "multer";
import AdmZip from "adm-zip";

// ==================== BASIC ADMIN AUTH (YOUR ORIGINAL CODE) ====================
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const tokens = new Set<string>();

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ==================== VipuDevAI CORE CONFIG ====================
const openaiApiKey = process.env.OPENAI_API_KEY || "";
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

const upload = multer({
  dest: path.join(os.tmpdir(), "vipudev-uploads"),
});

// Strong assistant personality
const VIPU_SYSTEM_PROMPT = `
You are VipuDevAI, a highly advanced AI developer assistant for Balaji.

Rules:
- Never reply with "I can't", "I don't know", or similar negative phrases.
- If something is missing, assume the most likely scenario and still give a working solution.
- Act like a senior full-stack engineer + architect.
- Prefer concrete, working code and step-by-step fixes.
- Use headings, bullet points, and full code blocks where useful.
`;

// Helper to build messages with memory from DB chat history
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
    // ignore memory errors, just run stateless
  }

  const base: any[] = [
    {
      role: "system",
      content: `${VIPU_SYSTEM_PROMPT}\n\nMEMORY:\n${memory || "(none yet)"}`,
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

export async function registerRoutes(
  httpServer: Server,
  app: Express,
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
  app.get("/api/projects", async (_req, res) => {
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
        return res
          .status(400)
          .json({ error: "Invalid project data", details: error.errors });
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
        return res
          .status(400)
          .json({ error: "Invalid project data", details: error.errors });
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

  // ============ CHAT ROUTES (HISTORY STORAGE) ============
  app.get("/api/chat/history", async (req, res) => {
    try {
      const limit = req.query.limit
        ? parseInt(req.query.limit as string)
        : 50;
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
        return res
          .status(400)
          .json({ error: "Invalid message data", details: error.errors });
      }
      console.error("Error creating chat message:", error);
      res.status(500).json({ error: "Failed to create message" });
    }
  });

  app.delete("/api/chat/history", async (_req, res) => {
    try {
      await storage.clearChatHistory();
      res.json({ success: true });
    } catch (error) {
      console.error("Error clearing chat history:", error);
      res.status(500).json({ error: "Failed to clear chat history" });
    }
  });

  // ============ CODE EXECUTION METADATA ROUTES ============
  app.get("/api/executions", async (req, res) => {
    try {
      const limit = req.query.limit
        ? parseInt(req.query.limit as string)
        : 20;
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
        return res
          .status(400)
          .json({ error: "Invalid execution data", details: error.errors });
      }
      console.error("Error creating execution:", error);
      res.status(500).json({ error: "Failed to create execution" });
    }
  });

  // ============ CONFIG ROUTES ============
  app.get("/api/config", async (_req, res) => {
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
        return res
          .status(400)
          .json({ error: "Invalid config data", details: error.errors });
      }
      console.error("Error updating config:", error);
      res.status(500).json({ error: "Failed to update config" });
    }
  });

  // ======================================================================
  // 🚀 NEW: VipuDevAI POWER ROUTES
  // ======================================================================

  // ---- AI Chat (VipuDevAI brain) ----
  app.post("/api/assistant/chat", async (req, res) => {
    if (!openai) {
      return res
        .status(500)
        .json({ error: "OpenAI API key not configured on server" });
    }

    try {
      const { messages, codeContext } = req.body as {
        messages: { role: "user" | "assistant" | "system"; content: string }[];
        codeContext?: string;
      };

      const inputMessages = await buildVipuMessages(messages || [], codeContext);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: inputMessages,
        temperature: 0.1,
        max_tokens: 4000,
      });

      const reply = completion.choices[0]?.message?.content || "";
      res.json({ reply });
    } catch (error) {
      console.error("assistant/chat error:", error);
      res.status(500).json({ error: "Failed to generate assistant reply" });
    }
  });

  // ---- Simple code runner (host, single file) ----
  app.post("/api/run", async (req, res) => {
    const { code, language } = req.body as {
      code?: string;
      language?: string;
    };

    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    const lang = language === "python" ? "python" : "javascript";
    const ext = lang === "python" ? ".py" : ".js";
    const cmd = lang === "python" ? "python3" : "node";

    try {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vipudev-run-"));
      const filePath = path.join(tempDir, "main" + ext);
      fs.writeFileSync(filePath, code);

      exec(
        `${cmd} "${filePath}"`,
        { timeout: 7000, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          const result = {
            stdout,
            stderr,
            exitCode: (error as any)?.code || 0,
            timedOut: !!(error as any)?.killed,
          };

          try {
            fs.unlinkSync(filePath);
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch {
            //
          }

          res.json(result);
        },
      );
    } catch (err) {
      console.error("run error:", err);
      res.status(500).json({ error: "Execution failed on backend" });
    }
  });

  // ---- Advanced sandbox: run project via Docker (resource-limited) ----
  app.post("/api/run-project", async (req, res) => {
    const { files, language, command } = req.body as {
      files?: { path: string; content: string }[];
      language?: string;
      command?: string;
    };

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "files array is required" });
    }

    const lang = (language || "node").toLowerCase();
    let image: string;
    let defaultCmd: string;

    if (lang === "python") {
      image = "python:3.11";
      defaultCmd = "python main.py";
    } else {
      image = "node:18";
      defaultCmd = "node main.js";
    }

    const runCmd = command || defaultCmd;

    let tempDir: string | undefined;
    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vipudev-project-"));

      for (const file of files) {
        const relPath = (file.path || "").replace(/^[/\\]+/, "");
        const targetPath = path.join(tempDir, relPath || "main.js");
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, file.content ?? "", "utf8");
      }

      const dockerArgs = [
        "run",
        "--rm",
        "--network",
        "none", // no internet
        "--memory",
        "512m", // memory limit
        "--cpus",
        "1", // CPU limit
        "-v",
        `${tempDir}:/app`,
        "-w",
        "/app",
        image,
        "bash",
        "-lc",
        runCmd,
      ];

      let stdout = "";
      let stderr = "";

      const child = spawn("docker", dockerArgs);
      const timeoutId = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          //
        }
        stderr += "\n[Process killed due to timeout]";
      }, 20000);

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timeoutId);
        try {
          if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        } catch {
          //
        }

        res.json({
          stdout,
          stderr,
          exitCode: code,
          imageUsed: image,
          commandRun: runCmd,
        });
      });
    } catch (err) {
      console.error("run-project error:", err);
      if (tempDir) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          //
        }
      }
      res.status(500).json({
        error:
          "Failed to run project in Docker. Ensure Docker is installed and accessible.",
      });
    }
  });

  // ---- Create ZIP from single code file ----
  app.post("/api/zip-code", (req, res) => {
    const { code, language, filename } = req.body as {
      code?: string;
      language?: string;
      filename?: string;
    };

    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    const ext =
      (filename && filename.split(".").pop()) ||
      (language === "python" ? "py" : "js");
    const safeName =
      (filename && filename.replace(/[^\w.\-]/g, "")) || `main.${ext}`;

    try {
      const zip = new AdmZip();
      zip.addFile(safeName, Buffer.from(code, "utf8"));
      const buffer = zip.toBuffer();

      res.set({
        "Content-Type": "application/zip",
        "Content-Disposition":
          'attachment; filename="vipudevai-project.zip"',
        "Content-Length": buffer.length,
      });

      res.send(buffer);
    } catch (err) {
      console.error("ZIP creation error:", err);
      res.status(500).json({ error: "Failed to create ZIP" });
    }
  });

  // ---- Analyze uploaded ZIP with AI ----
  app.post(
    "/api/analyze-zip",
    upload.single("file"),
    async (req, res): Promise<any> => {
      if (!openai) {
        return res
          .status(500)
          .json({ error: "OpenAI API key not configured on server" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "ZIP file is required" });
      }

      const zipPath = req.file.path;

      try {
        const zip = new AdmZip(zipPath);
        const entries = zip.getEntries();

        const MAX_FILES = 30;
        const MAX_BYTES = 20000;

        const samples: string[] = [];
        for (const entry of entries) {
          if (samples.length >= MAX_FILES) break;
          if (entry.isDirectory) continue;

          const name = entry.entryName;
          if (
            /\.(png|jpg|jpeg|gif|ico|pdf|mp4|mp3|zip|gz|tar|exe|dll)$/i.test(
              name,
            )
          ) {
            continue;
          }

          const data = entry.getData();
          if (!data || !data.length) continue;

          const content =
            data.length > MAX_BYTES
              ? data.slice(0, MAX_BYTES).toString("utf8")
              : data.toString("utf8");

          samples.push(`--- FILE: ${name} ---\n${content}`);
        }

        const combined = samples.join("\n\n");

        const msgs = await buildVipuMessages(
          [
            {
              role: "user",
              content:
                "I uploaded a ZIP project. Analyze its structure, tech stack, potential issues, and suggest improvements.",
            },
            {
              role: "user",
              content: combined || "(no readable text files found)",
            },
          ],
          undefined,
        );

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: msgs,
          temperature: 0.2,
          max_tokens: 4000,
        });

        const analysis = completion.choices[0]?.message?.content || "";
        res.json({ analysis, sampledFiles: samples.length });
      } catch (err) {
        console.error("Analyze ZIP error:", err);
        res.status(500).json({ error: "Failed to analyze ZIP" });
      } finally {
        try {
          fs.unlinkSync(zipPath);
        } catch {
          //
        }
      }
    },
  );

  // ---- DALL·E 3 image generation ----
  app.post("/api/generate-image", async (req, res) => {
    if (!openai) {
      return res
        .status(500)
        .json({ error: "OpenAI API key not configured on server" });
    }
    const { prompt } = req.body as { prompt?: string };
    if (!prompt) {
      return res.status(400).json({ error: "prompt is required" });
    }

    try {
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt,
        size: "1024x1024",
        n: 1,
      });

      const url = response.data[0]?.url;
      res.json({ url });
    } catch (err) {
      console.error("Image generation error:", err);
      res.status(500).json({ error: "Image generation failed" });
    }
  });

  // ---- Deploy guidance (Vercel / Render / Railway) ----
  app.post("/api/deploy", async (req, res) => {
    const { platform } = req.body as { platform?: string };
    if (!platform) {
      return res.status(400).json({ error: "platform is required" });
    }

    const p = platform.toLowerCase();
    let logs = "";

    if (p === "vercel") {
      logs = `
To deploy to Vercel:
1) Install CLI: npm i -g vercel
2) Run from project root: vercel && vercel --prod
3) Set environment vars (OPENAI_API_KEY, DATABASE_URL, etc.).
`;
    } else if (p === "render") {
      logs = `
To deploy to Render:
1) Push this repo to GitHub.
2) Create a new Web Service in Render and connect the repo.
3) Build command: npm install && npm run build
4) Start command: node dist/server/index.js (or your compiled entry).
5) Configure environment variables.
`;
    } else if (p === "railway") {
      logs = `
To deploy to Railway:
1) Install Railway CLI: npm i -g @railway/cli
2) railway login
3) railway init
4) railway up
5) Add your environment variables in Railway dashboard.
`;
    } else {
      logs = "Unknown platform. Use vercel | render | railway.";
    }

    res.json({ success: true, logs });
  });

  return httpServer;
}
