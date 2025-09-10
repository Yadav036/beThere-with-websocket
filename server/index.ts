import express, { type Request, Response, NextFunction } from "express";
import http from "http";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";

const app = express();

// Parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// API request logger (only for /api routes)
app.use((req, res, next) => {
  const start = Date.now();
  let capturedJson: Record<string, any> | undefined;

  const originalJson = res.json;
  res.json = function (body, ...args) {
    capturedJson = body;
    return originalJson.apply(res, [body, ...args]);
  };

  res.on("finish", () => {
    if (req.path.startsWith("/api")) {
      let logLine = `${req.method} ${req.path} ${res.statusCode} in ${
        Date.now() - start
      }ms`;
      if (capturedJson) {
        const jsonStr = JSON.stringify(capturedJson);
        logLine += ` :: ${
          jsonStr.length > 100 ? jsonStr.slice(0, 100) + "..." : jsonStr
        }`;
      }
      console.log(logLine);
    }
  });

  next();
});

async function startServer() {
  try {
    const isDevelopment = process.env.NODE_ENV !== "production";
    const host = "0.0.0.0"; // ✅ always 0.0.0.0 for Docker
    const port = parseInt(process.env.PORT || "3000", 10);

  // ✅ Create HTTP server
  const server = http.createServer(app);

  // Register routes and attach Socket.IO to the same server
  await registerRoutes(app, server);

    // Global error handler
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ error: message });
      if (isDevelopment && err.stack) console.error(err.stack);
    });

    // Dev: Vite middleware, Prod: static files
    if (isDevelopment) {
      await setupVite(app);
    } else {
      serveStatic(app);
    }


    // Start server
    server.listen(port, host, () => {
      if (isDevelopment) {
        console.log(`Server running at http://localhost:${port}`);
      } else {
        console.log(`Server running on port ${port}`);
        console.log("Use your EC2/Docker host IP or domain to connect");
      }
    });

    // Graceful shutdown
    const shutdown = (signal: string) => {
      console.log(`\nReceived ${signal}. Shutting down...`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("unhandledRejection", () => shutdown("UNHANDLED_REJECTION"));
    process.on("uncaughtException", () => shutdown("UNCAUGHT_EXCEPTION"));
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
