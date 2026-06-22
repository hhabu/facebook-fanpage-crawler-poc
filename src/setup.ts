import fs from "node:fs";
import path from "node:path";
import { getConfig, loadEnvFile } from "./config/env";
import { closeDb, initializeDatabase } from "./lib/db";
import { createBot, getBots } from "./services/botService";
import { isCloakBrowserAvailable } from "./integrations/cloakBrowserClient";

function ensureEnvFile(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  const examplePath = path.resolve(process.cwd(), ".env.example");
  if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log("Created .env from .env.example");
  }
}

function ensureDataDirs(): void {
  for (const dir of ["data", "data/browser-profiles", "data/screenshots", "database"]) {
    fs.mkdirSync(path.resolve(process.cwd(), dir), { recursive: true });
  }
}

function ensureDemoBots(): void {
  const bots = getBots();
  const names = new Set(bots.map((bot) => bot.name));

  if (!names.has("Competitor Logistics Article Bot")) {
    createBot({
      name: "Competitor Logistics Article Bot",
      type: "article",
      targetUrl: "https://www.dhl.com/global-en/home/press.html",
      browserProfile: "competitor-news-profile"
    });
  }

  if (!names.has("Shopee Product Price Bot")) {
    createBot({
      name: "Shopee Product Price Bot",
      type: "product",
      targetUrl: "https://shopee.vn",
      browserProfile: "shopee-price-profile"
    });
  }

  if (!names.has("Social Metrics Bot")) {
    createBot({
      name: "Social Metrics Bot",
      type: "social",
      targetUrl: "https://www.youtube.com",
      browserProfile: "social-lens-profile"
    });
  }

  if (!names.has("Daily Logistics Policy Monitor")) {
    createBot({
      name: "Daily Logistics Policy Monitor",
      type: "article",
      targetUrl:
        "https://news.google.com/rss/search?q=Vietnam%20logistics%20shipping%20policy%20tax%20customs%20import%20export&hl=vi&gl=VN&ceid=VN:vi",
      targetDomain: "news.google.com",
      browserProfile: "daily-logistics-policy-monitor",
      scheduleCron: "0 8 * * *",
      status: "active"
    });
  }
}

async function main(): Promise<void> {
  ensureEnvFile();
  loadEnvFile();
  ensureDataDirs();
  initializeDatabase();
  ensureDemoBots();

  const config = getConfig();
  const cloakAvailable = await isCloakBrowserAvailable();

  console.log("Setup complete");
  console.log(`Dashboard: http://localhost:${config.port}`);
  console.log(`Bots: ${getBots().length}`);
  console.log(`Scheduler enabled: ${config.schedulerEnabled}`);
  console.log(`CloakBrowser package available: ${cloakAvailable}`);
  closeDb();
}

main().catch((error) => {
  console.error(error);
  closeDb();
  process.exitCode = 1;
});

