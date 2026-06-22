import { Router } from "express";
import { getJobById, getJobLogs, getJobs } from "../services/jobService";

export const jobsRouter = Router();

jobsRouter.get("/", (req, res) => {
  res.json(getJobs(Number(req.query.limit ?? 50)));
});

jobsRouter.get("/:id", (req, res) => {
  const job = getJobById(Number(req.params.id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({ job, logs: getJobLogs(job.id) });
});
