import express, { type Express } from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const vite = await createViteServer({
    configFile: path.resolve("vite.config.ts"),
    server: {
      middlewareMode: true,
      hmr: { server },
      host: '0.0.0.0',
    },
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve("client", "index.html");
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      
      // Add cache busting
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      const err = e as Error;
      vite.ssrFixStacktrace(err);
      log(`Vite error: ${err.message}`, "vite");
      next(err);
    }
  });

  log("Vite dev server setup complete", "vite");
}

export function serveStatic(app: Express) {
  const distPath = path.resolve("dist", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}. Run 'npm run build' first.`
    );
  }

  log(`Serving static files from: ${distPath}`, "static");

  // Serve static files with proper caching headers
  app.use(express.static(distPath, {
    maxAge: process.env.NODE_ENV === "production" ? "1y" : 0,
    etag: true,
    lastModified: true,
  }));

  // SPA fallback - serve index.html for all non-API routes
  app.use("*", (req, res) => {
    // Don't serve index.html for API routes
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    
    const indexPath = path.resolve(distPath, "index.html");
    res.sendFile(indexPath);
  });

  log("Static file serving setup complete", "static");
}