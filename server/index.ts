import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { createServer } from "http";
import cors from "cors";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// -----------------------------------------------------------------------------
// ✅ CORS SETUP
// -----------------------------------------------------------------------------
// In production → allow Vercel domain
// In development → allow localhost:5173 (Vite)
const allowedOrigins =
  process.env.NODE_ENV === "production"
    ? ["https://your-frontend.vercel.app"] // <-- Change this after Vercel deploy
    : ["http://localhost:5173"];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// -----------------------------------------------------------------------------
// BODY PARSING
// -----------------------------------------------------------------------------
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.urlencoded({ extended: false }));

// -----------------------------------------------------------------------------
// LOGGER
// -----------------------------------------------------------------------------
export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;

    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

// -----------------------------------------------------------------------------
// MAIN STARTUP
// -----------------------------------------------------------------------------
(async () => {
  await registerRoutes(httpServer, app);

  // Error Handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  // ---------------------------------------------------------------------------
  // ⛔ IMPORTANT: Backend-only mode
  // No Vite, no static, no frontend. Render runs ONLY API.
  // ---------------------------------------------------------------------------

  const port = parseInt(process.env.PORT || "5000", 10);

  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`Backend running on port ${port}`);
    }
  );
})();
