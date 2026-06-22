import { Router } from "express";
import { getBots } from "../services/botService";
import {
  clearBrowserProfile,
  getBrowserProfileRuntime,
  listBrowserProfiles,
  markBrowserProfileWarmup,
  testBrowserProfile
} from "../browser/browserProfileManager";
import { closeProfileWarmup, getActiveProfileWarmups, startProfileWarmup } from "../services/profileWarmupService";

export const browserProfilesRouter = Router();

browserProfilesRouter.get("/", (_req, res) => {
  res.json(listBrowserProfiles());
});

browserProfilesRouter.post("/ensure/:botId", (req, res) => {
  const bot = getBots().find((item) => item.id === Number(req.params.botId));
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  res.status(201).json(getBrowserProfileRuntime(bot));
});

browserProfilesRouter.post("/open/:botId", (req, res) => {
  const bot = getBots().find((item) => item.id === Number(req.params.botId));
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  const profile = getBrowserProfileRuntime(bot);
  markBrowserProfileWarmup(profile);
  res.status(202).json({
    profile,
    message:
      "Warm-up marker saved. In production, launch this profile headful with CloakBrowser/Playwright, log in manually, then rerun bots to reuse the profile."
  });
});

browserProfilesRouter.get("/warmups", (_req, res) => {
  res.json(getActiveProfileWarmups());
});

browserProfilesRouter.post("/warm/:botId", async (req, res) => {
  const bot = getBots().find((item) => item.id === Number(req.params.botId));
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  try {
    const warmup = await startProfileWarmup(bot, req.body?.url);
    res.status(202).json({
      ...warmup,
      message: warmup.alreadyRunning
        ? "Warm-up browser is already open. Complete login/verification there, then click Save Session."
        : "Warm-up browser opened. Complete login/verification there, then click Save Session."
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to open warm-up browser"
    });
  }
});

browserProfilesRouter.post("/warm/:botId/close", async (req, res) => {
  const bot = getBots().find((item) => item.id === Number(req.params.botId));
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  try {
    res.json(await closeProfileWarmup(bot));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to save warm-up session"
    });
  }
});

browserProfilesRouter.get("/test/:botId", (req, res) => {
  const bot = getBots().find((item) => item.id === Number(req.params.botId));
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  res.json(testBrowserProfile(getBrowserProfileRuntime(bot)));
});

browserProfilesRouter.delete("/:name", (req, res) => {
  clearBrowserProfile(req.params.name);
  res.status(204).send();
});
