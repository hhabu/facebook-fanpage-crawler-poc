import { closeDb, initializeDatabase } from "./lib/db";
import { createBot, getBots } from "./services/botService";

initializeDatabase();

const existing = getBots();

function ensureBot(name: string, input: Parameters<typeof createBot>[0]): void {
  if (!getBots().some((bot) => bot.name === name)) {
    createBot(input);
  }
}

if (existing.length === 0) {
  createBot({
    name: "Competitor Logistics Article Bot",
    type: "article",
    targetUrl: "https://www.dhl.com/global-en/home/press.html",
    browserProfile: "competitor-news-profile"
  });

  createBot({
    name: "Shopee Product Price Bot",
    type: "product",
    targetUrl: "https://shopee.vn",
    browserProfile: "shopee-price-profile"
  });

  createBot({
    name: "Social Metrics Bot",
    type: "social",
    targetUrl: "https://www.youtube.com",
    browserProfile: "social-lens-profile"
  });
}

ensureBot("Daily Logistics Policy Monitor", {
  name: "Daily Logistics Policy Monitor",
  type: "article",
  targetUrl: "https://news.google.com/rss/search?q=Vietnam%20logistics%20shipping%20policy%20tax%20customs%20import%20export&hl=vi&gl=VN&ceid=VN:vi",
  targetDomain: "news.google.com",
  browserProfile: "daily-logistics-policy-monitor",
  scheduleCron: "0 8 * * *",
  status: "active"
});

console.log(`Seed complete. Bots in database: ${getBots().length}`);
closeDb();
