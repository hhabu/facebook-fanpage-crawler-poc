import { Router } from "express";
import { runBot } from "../scrapers/runBot";

export const runBotRouter = Router();

runBotRouter.post("/:id", async (req, res) => {
  try {
    const result = await runBot(Number(req.params.id));
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to run bot" });
  }
});
