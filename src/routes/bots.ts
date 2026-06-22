import { Router } from "express";
import { createBot, deleteBot, getBot, listBots, updateBot } from "../services/botService";

export const botsRouter = Router();

botsRouter.get("/", (_req, res) => {
  res.json(listBots());
});

botsRouter.get("/:id", (req, res) => {
  const bot = getBot(Number(req.params.id));
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  res.json(bot);
});

botsRouter.post("/", (req, res) => {
  const bot = createBot(req.body);
  res.status(201).json(bot);
});

botsRouter.put("/:id", (req, res) => {
  const bot = updateBot(Number(req.params.id), req.body);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  res.json(bot);
});

botsRouter.delete("/:id", (req, res) => {
  const deleted = deleteBot(Number(req.params.id));
  res.status(deleted ? 204 : 404).send();
});
