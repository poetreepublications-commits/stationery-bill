import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import authRouter from "./routes/auth.js";
import mastersRouter from "./routes/masters.js";
import ordersRouter from "./routes/orders.js";
import financeRouter from "./routes/finance.js";
import adminRouter from "./routes/admin.js";
import { requireAuth } from "./middleware/auth.js";
import { HttpError } from "./lib/errors.js";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";

export function createApp() {
  const app = express();
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-origin" } }));
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? true }));
  app.use(express.json({ limit: "1mb" }));
  if (process.env.NODE_ENV !== "test") app.use(morgan("tiny"));

  app.use("/uploads", (_req, res) => res.status(404).end());
  app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use("/api/auth", authRouter);
  app.use("/api", requireAuth);
  app.use("/api", mastersRouter);
  app.use("/api", ordersRouter);
  app.use("/api", financeRouter);
  app.use("/api", adminRouter);

  // Serve the built web app (single origin in production). Falls through to index.html for client routes.
  const webDist = path.resolve(process.env.WEB_DIST ?? "../web/dist");
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: "index.html", maxAge: "1h" }));
    app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }
  app.use("/api", (_req, res) => res.status(404).json({ message: "Not found" }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, details: err.details });
    const e = err as { code?: string; message?: string };
    if (e?.code === "P2002") return res.status(409).json({ message: "This record already exists (duplicate code, email or number)." });
    if (e?.code === "P2025") return res.status(404).json({ message: "Record not found" });
    console.error(err);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  });
  return app;
}
