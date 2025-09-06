import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
const server = createServer(app);

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// Trust proxy for EC2/Load Balancer setup
app.set('trust proxy', 1);

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// API request logger (only for API routes)
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();

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
    let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
    
    if (capturedJsonResponse) {
      const jsonStr = JSON.stringify(capturedJsonResponse);
      logLine += ` :: ${jsonStr.length > 100 ? jsonStr.slice(0, 97) + "..." : jsonStr}`;
    }
    
    log(logLine.length > 120 ? logLine.slice(0, 117) + "..." : logLine, "api");
  });

  next();
});

async function startServer() {
  try {
    // Register API routes first
    await registerRoutes(app, server);

    // Setup client serving based on environment
    if (process.env.NODE_ENV === "production") {
      log("Starting in production mode", "server");
      serveStatic(app);
    } else {
      log("Starting in development mode with Vite", "server");
      await setupVite(app, server);
    }

    // Global error handler
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      
      log(`Error ${status}: ${message}`, "error");
      
      // Don't leak error details in production
      const errorResponse = process.env.NODE_ENV === "production" 
        ? { error: status >= 500 ? "Internal Server Error" : message }
        : { error: message, stack: err.stack };

      res.status(status).json(errorResponse);
    });

    // Health check endpoint
    app.get('/health', (_req, res) => {
      res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV || 'development'
      });
    });

    const port = parseInt(process.env.PORT || "3000", 10);
    const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost";

    server.listen(port, host, () => {
      log(`Server running on http://${host}:${port}`, "server");
      
      if (process.env.NODE_ENV !== "production") {
        log(`Health check: http://${host}:${port}/health`, "server");
      }
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      log('SIGTERM received, shutting down gracefully', "server");
      server.close(() => {
        log('Server closed', "server");
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      log('SIGINT received, shutting down gracefully', "server");
      server.close(() => {
        log('Server closed', "server");
        process.exit(0);
      });
    });

  } catch (error) {
    log(`Failed to start server: ${error}`, "error");
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log(`Unhandled Rejection at: ${promise}, reason: ${reason}`, "error");
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log(`Uncaught Exception: ${error.message}`, "error");
  process.exit(1);
});

startServer();