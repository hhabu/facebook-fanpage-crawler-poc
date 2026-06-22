import cors from "cors";
import express from "express";
import path from "node:path";
import { loadEnvFile } from "./config/env";
import { initializeDatabase } from "./lib/db";
import { browserProfilesRouter } from "./routes/browser-profiles";
import { botsRouter } from "./routes/bots";
import { crawlResultsRouter } from "./routes/crawl-results";
import { exportsRouter } from "./routes/exports";
import { jobsRouter } from "./routes/jobs";
import { mentorMvpRouter } from "./routes/mentor-mvp";
import { runBotRouter } from "./routes/run-bot";
import { schedulerRouter } from "./routes/scheduler";
import { startScheduler } from "./services/schedulerService";

loadEnvFile();
initializeDatabase();

export const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "multi-bot-mvp" });
});

app.use("/api/bots", botsRouter);
app.use("/api/browser-profiles", browserProfilesRouter);
app.use("/api/crawl-results", crawlResultsRouter);
app.use("/api/exports", exportsRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/mentor", mentorMvpRouter);
app.use("/api/run-bot", runBotRouter);
app.use("/api/scheduler", schedulerRouter);

startScheduler();
