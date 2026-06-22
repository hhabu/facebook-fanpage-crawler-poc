import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getBrowserProfileRuntime, markBrowserProfileWarmup } from "./browser/browserProfileManager";
import { getConfig, loadEnvFile } from "./config/env";
import { buildCloakBrowserLaunchPlan, launchCloakPersistentContext } from "./integrations/cloakBrowserClient";
import { closeDb, initializeDatabase } from "./lib/db";
import { getBotById } from "./services/botService";

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) {
    return process.argv[index + 1] ?? null;
  }

  return null;
}

async function main(): Promise<void> {
  loadEnvFile();
  initializeDatabase();

  const botId = Number(argValue("botId"));
  if (!Number.isFinite(botId)) {
    throw new Error("Missing --botId. Example: npm.cmd run profile:open -- --botId 6");
  }

  const bot = getBotById(botId);
  if (!bot) {
    throw new Error(`Bot ${botId} not found.`);
  }

  const profile = getBrowserProfileRuntime(bot);
  const targetUrl = argValue("url") || bot.targetUrl || `https://${bot.targetDomain}`;
  const config = getConfig();

  console.log(`Opening profile for bot #${bot.id}: ${bot.name}`);
  console.log(`Profile dir: ${profile.userDataDir}`);
  console.log(`Target URL: ${targetUrl}`);
  console.log("Login in the browser window, then come back here and press Enter.");

  const context = (await launchCloakPersistentContext({
    ...buildCloakBrowserLaunchPlan(bot, profile),
    headless: false,
    humanize: config.cloakHumanize,
    proxy: bot.proxyUrl || config.cloakProxy || undefined
  })) as any;

  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((error: unknown) => {
    console.warn(error instanceof Error ? error.message : "Navigation failed, browser is still open.");
  });

  const rl = readline.createInterface({ input, output });
  await rl.question("Press Enter after login/session warm-up is done...");
  rl.close();

  markBrowserProfileWarmup(profile);
  await context.close().catch(() => undefined);
  closeDb();
  console.log("Profile warm-up saved. Run the bot again from the dashboard.");
}

main().catch((error) => {
  console.error(error);
  closeDb();
  process.exitCode = 1;
});

