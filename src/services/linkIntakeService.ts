import { inferTargetDomain } from "../lib/botTypes";
import { createBot } from "./botService";

export interface SocialLinkIntakeInput {
  linksText: string;
  competitorName?: string;
  runNow?: boolean;
}

export interface CreatedSocialBot {
  botId: number;
  name: string;
  targetUrl: string;
  platform: string;
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s,]+/gi) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[)\].,]+$/, "")))];
}

function detectPlatform(url: string): string {
  const domain = inferTargetDomain(url).replace(/^www\./, "");
  if (domain.includes("facebook.com") || domain.includes("fb.watch")) {
    return "facebook";
  }
  if (domain.includes("tiktok.com")) {
    return "tiktok";
  }
  if (domain.includes("youtube.com") || domain.includes("youtu.be")) {
    return "youtube";
  }
  return domain || "social";
}

export function createSocialBotsFromLinks(input: SocialLinkIntakeInput): CreatedSocialBot[] {
  const competitorName = input.competitorName?.trim() || "Competitor";

  return extractUrls(input.linksText).map((targetUrl, index) => {
    const platform = detectPlatform(targetUrl);
    const bot = createBot({
      name: `${competitorName} ${platform} watch ${index + 1}`,
      type: "social",
      targetUrl,
      browserProfile: `${competitorName}-${platform}-${index + 1}`.toLowerCase().replace(/[^a-z0-9-_]+/g, "-"),
      status: "active"
    });

    return {
      botId: bot.id,
      name: bot.name,
      targetUrl: bot.targetUrl,
      platform
    };
  });
}
