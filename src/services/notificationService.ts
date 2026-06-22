import { getBots } from "./botService";
import { getCrawlResults } from "./crawlResultService";

export interface NotificationItem {
  level: "info" | "warning" | "error";
  title: string;
  message: string;
  createdAt: string;
}

export function getNotifications(): NotificationItem[] {
  const bots = getBots();
  const results = getCrawlResults();
  const notifications: NotificationItem[] = [];

  for (const bot of bots.filter((item) => item.status === "error")) {
    notifications.push({
      level: "error",
      title: `Bot error: ${bot.name}`,
      message: `Check target ${bot.targetUrl}`,
      createdAt: bot.updatedAt
    });
  }

  for (const result of results.slice(0, 5)) {
    notifications.push({
      level: result.status === "failed" ? "warning" : "info",
      title: result.status === "failed" ? "Crawl failed" : "New crawl result",
      message: `${result.title || result.url} (${result.type})`,
      createdAt: result.createdAt
    });
  }

  return notifications.slice(0, 10);
}
