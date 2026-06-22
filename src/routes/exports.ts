import { Router } from "express";
import { getCrawlResultDetail, getCrawlResults } from "../services/crawlResultService";

export const exportsRouter = Router();

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

exportsRouter.get("/crawl-results.json", (_req, res) => {
  res.json(getCrawlResults());
});

exportsRouter.get("/crawl-results.csv", (_req, res) => {
  const rows = getCrawlResults();
  const header = ["id", "botId", "type", "status", "title", "url", "createdAt", "blockReason", "renderEngine"];
  const csv = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.id,
        row.botId,
        row.type,
        row.status,
        row.title,
        row.url,
        row.createdAt,
        row.blockReason,
        row.renderEngine
      ]
        .map(csvEscape)
        .join(",")
    )
  ].join("\n");
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.send(csv);
});

exportsRouter.get("/crawl-results/:id.json", (req, res) => {
  const detail = getCrawlResultDetail(Number(req.params.id));
  if (!detail) {
    res.status(404).json({ error: "Crawl result not found" });
    return;
  }
  res.json(detail);
});
