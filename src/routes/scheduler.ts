import { Router } from "express";
import { schedulerStatus, tickScheduler } from "../services/schedulerService";

export const schedulerRouter = Router();

schedulerRouter.get("/", (_req, res) => {
  res.json(schedulerStatus());
});

schedulerRouter.post("/tick", async (_req, res) => {
  await tickScheduler();
  res.status(202).json(schedulerStatus());
});
