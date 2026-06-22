import { Router } from "express";
import { runBot } from "../scrapers/runBot";
import { createSocialBotsFromLinks } from "../services/linkIntakeService";
import { getNotifications } from "../services/notificationService";
import { runResearchMonitor } from "../services/researchMonitorService";

export const mentorMvpRouter = Router();

mentorMvpRouter.post("/social-links", async (req, res) => {
  try {
    const created = createSocialBotsFromLinks({
      linksText: String(req.body.linksText || ""),
      competitorName: req.body.competitorName,
      runNow: Boolean(req.body.runNow)
    });

    const runs = req.body.runNow
      ? await Promise.allSettled(created.map((bot) => runBot(bot.botId)))
      : [];

    res.status(201).json({ created, runs });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to import social links" });
  }
});

mentorMvpRouter.post("/research-monitor/run", async (req, res) => {
  try {
    const items = await runResearchMonitor({
      query: req.body.query,
      limit: req.body.limit
    });
    res.status(201).json({ items });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to run research monitor" });
  }
});

mentorMvpRouter.get("/notifications", (_req, res) => {
  res.json(getNotifications());
});
