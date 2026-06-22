import type { Bot } from "../lib/botTypes";
import type { ScraperOutput } from "../lib/scraperTypes";
import { getBrowserProfileRuntime } from "../browser/browserProfileManager";
import { renderTarget, type RenderedCrawlResult } from "../browser/renderedCrawler";
import { analyzeScrapeResult } from "../services/aiAnalysisService";
import { getBot, updateBot, updateBotStatus } from "../services/botService";
import { saveCrawlResult } from "../services/crawlResultService";
import {
  addJobLog,
  createJob,
  getJobById,
  getJobLogs,
  hasRunningJobForBot,
  updateJob,
  type BotJob
} from "../services/jobService";
import { extractArticleFromRendered } from "./articleScraper";
import { crawlFacebookPage } from "./facebookCrawler";
import { extractProductFromRendered } from "./productScraper";
import { extractSocialFromRendered } from "./socialScraper";

function isProductSnapshot(data: ScraperOutput): data is Extract<ScraperOutput, { productName: string }> {
  return "productName" in data;
}

function isSocialSnapshot(data: ScraperOutput): data is Extract<ScraperOutput, { views: number | null }> {
  return "views" in data && "comments" in data && "shares" in data && "saves" in data;
}

function extractByType(bot: Bot, rendered: RenderedCrawlResult): ScraperOutput {
  if (bot.type === "product") {
    return extractProductFromRendered(rendered);
  }
  if (bot.type === "social") {
    return extractSocialFromRendered(bot.targetUrl, rendered);
  }
  if (bot.type === "article") {
    return extractArticleFromRendered(rendered);
  }

  return {
    title: rendered.title || `Custom scrape for ${bot.name}`,
    publishDate: null,
    author: null,
    content: rendered.rawText || `No custom scraper is configured yet for ${bot.targetUrl}.`,
    imagesJson: "[]"
  };
}

function resultTitle(data: ScraperOutput, rendered: RenderedCrawlResult): string | null {
  if ("title" in data) {
    return data.title;
  }
  if ("productName" in data) {
    return data.productName;
  }
  return rendered.title;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFacebookTarget(bot: Bot): boolean {
  return bot.targetDomain.includes("facebook.com") || bot.targetDomain.includes("fb.watch");
}

async function runAttempt(bot: Bot, job: BotJob, attempt: number): Promise<number> {
  addJobLog(job.id, "initialize_browser", "started", bot.browserEngine);
  const browserProfile = getBrowserProfileRuntime(bot);
  addJobLog(job.id, "load_profile", "success", browserProfile.userDataDir);

  if (isFacebookTarget(bot)) {
    addJobLog(job.id, "facebook_page", "started", "collect post URLs and crawl post details");
    const facebook = await crawlFacebookPage(bot, 5);
    addJobLog(job.id, "facebook_page", "success", `posts=${facebook.socialPosts.length}`);

    addJobLog(job.id, "analyze", "started");
    const analysisResult = analyzeScrapeResult(bot, facebook.socialSnapshot);
    addJobLog(job.id, "analyze", "success");

    addJobLog(job.id, "save", "started");
    const crawlResult = saveCrawlResult({
      botId: bot.id,
      type: "social",
      url: bot.targetUrl,
      title: facebook.rendered.title,
      rawText: facebook.rendered.rawText,
      rawHtml: facebook.rendered.rawHtml,
      screenshotPath: facebook.rendered.screenshotPath,
      status: "success",
      renderEngine: facebook.rendered.engine,
      httpStatus: facebook.rendered.httpStatus,
      socialSnapshot: facebook.socialSnapshot,
      socialPosts: facebook.socialPosts,
      analysisResult
    });
    addJobLog(job.id, "save", "success", `crawlResultId=${crawlResult.id}`);
    updateJob(job.id, {
      status: "success",
      attempt,
      crawlResultId: crawlResult.id,
      finishedAt: new Date().toISOString()
    });
    updateBot(bot.id, {
      status: "active",
      lastRunAt: new Date().toISOString()
    });
    return crawlResult.id;
  }

  addJobLog(job.id, "navigate", "started", bot.targetUrl);
  const rendered = await renderTarget(bot, browserProfile);
  addJobLog(
    job.id,
    "render",
    rendered.blocked ? "blocked" : "success",
    `${rendered.engine}${rendered.fallbackUsed ? " fallback" : ""}`
  );

  if (rendered.blocked) {
    const crawlResult = saveCrawlResult({
      botId: bot.id,
      type: bot.type,
      url: bot.targetUrl,
      title: rendered.title,
      rawText: rendered.rawText,
      rawHtml: rendered.rawHtml,
      screenshotPath: rendered.screenshotPath,
      status: "blocked",
      blockReason: rendered.blockReason,
      renderEngine: rendered.engine,
      httpStatus: rendered.httpStatus
    });
    updateJob(job.id, {
      status: "blocked",
      attempt,
      blockReason: rendered.blockReason,
      crawlResultId: crawlResult.id,
      finishedAt: new Date().toISOString()
    });
    updateBotStatus(bot.id, "error");
    return crawlResult.id;
  }

  addJobLog(job.id, "extract", "started", bot.type);
  const data = extractByType(bot, rendered);
  addJobLog(job.id, "extract", "success");

  addJobLog(job.id, "analyze", "started");
  const analysisResult = analyzeScrapeResult(bot, data);
  addJobLog(job.id, "analyze", "success");

  addJobLog(job.id, "save", "started");
  const crawlResult = saveCrawlResult({
    botId: bot.id,
    type: bot.type,
    url: bot.targetUrl,
    title: resultTitle(data, rendered),
    rawText: rendered.rawText || ("content" in data ? data.content : JSON.stringify(data)),
    rawHtml: rendered.rawHtml,
    screenshotPath: rendered.screenshotPath,
    status: "success",
    renderEngine: rendered.engine,
    httpStatus: rendered.httpStatus,
    productSnapshot: isProductSnapshot(data) ? data : undefined,
    socialSnapshot: isSocialSnapshot(data) ? data : undefined,
    articleSnapshot: !isProductSnapshot(data) && !isSocialSnapshot(data) ? data : undefined,
    analysisResult
  });
  addJobLog(job.id, "save", "success", `crawlResultId=${crawlResult.id}`);
  updateJob(job.id, {
    status: "success",
    attempt,
    crawlResultId: crawlResult.id,
    finishedAt: new Date().toISOString()
  });
  updateBot(bot.id, {
    status: "active",
    lastRunAt: new Date().toISOString()
  });
  return crawlResult.id;
}

export async function runBot(botId: number): Promise<{ crawlResultId: number; job: BotJob; logs: unknown[] }> {
  const bot = getBot(botId);
  if (!bot) {
    throw new Error(`Bot ${botId} was not found.`);
  }
  if (bot.status === "paused") {
    throw new Error(`Bot ${botId} is paused.`);
  }
  if (hasRunningJobForBot(bot.id)) {
    throw new Error(`Bot ${botId} already has a running job.`);
  }

  const maxAttempts = Math.max(1, bot.retryLimit + 1);
  const job = createJob(bot.id, maxAttempts);
  updateJob(job.id, { status: "running", startedAt: new Date().toISOString() });

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    updateJob(job.id, { status: attempt > 1 ? "retrying" : "running", attempt });
    addJobLog(job.id, "attempt", attempt > 1 ? "retrying" : "started", `attempt ${attempt}/${maxAttempts}`);

    try {
      const crawlResultId = await runAttempt(bot, job, attempt);
      const finalJob = getJobById(job.id)!;
      return { crawlResultId, job: finalJob, logs: getJobLogs(job.id) };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "Unknown crawl error";
      addJobLog(job.id, "attempt", "failed", message);
      if (attempt < maxAttempts) {
        await wait(800 * attempt);
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown crawl error";
  const crawlResult = saveCrawlResult({
    botId: bot.id,
    type: bot.type,
    url: bot.targetUrl,
    status: "failed",
    errorMessage: message
  });
  updateJob(job.id, {
    status: "failed",
    errorMessage: message,
    crawlResultId: crawlResult.id,
    finishedAt: new Date().toISOString()
  });
  updateBotStatus(bot.id, "error");
  throw new Error(message);
}
