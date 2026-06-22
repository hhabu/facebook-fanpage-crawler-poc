import { Router } from "express";
import { deleteAllCrawlResults, deleteCrawlResult, getCrawlResultDetail, listCrawlResults } from "../services/crawlResultService";

export const crawlResultsRouter = Router();

crawlResultsRouter.get("/", (_req, res) => {
  res.json(listCrawlResults());
});

crawlResultsRouter.delete("/", (_req, res) => {
  const deletedCount = deleteAllCrawlResults();
  res.json({ deletedCount });
});

crawlResultsRouter.get("/:id", (req, res) => {
  const detail = getCrawlResultDetail(Number(req.params.id));
  if (!detail) {
    res.status(404).json({ error: "Crawl result not found" });
    return;
  }

  res.json(detail);
});

crawlResultsRouter.delete("/:id", (req, res) => {
  const deleted = deleteCrawlResult(Number(req.params.id));
  res.status(deleted ? 204 : 404).send();
});
