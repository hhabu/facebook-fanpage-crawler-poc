import type { Bot } from "../lib/botTypes";
import type { AnalysisResult, ArticleSnapshot, ProductSnapshot, ScraperOutput, SocialSnapshot } from "../lib/scraperTypes";
import { buildResearchBrief } from "../integrations/last30daysResearchAdapter";

function isArticle(data: ScraperOutput): data is ArticleSnapshot {
  return "content" in data;
}

function isProduct(data: ScraperOutput): data is ProductSnapshot {
  return "productName" in data;
}

function isSocial(data: ScraperOutput): data is SocialSnapshot {
  return "views" in data || "likes" in data;
}

function parsePostJson(postsJson: string | null | undefined): Array<{ text?: string; content?: string }> {
  if (!postsJson) {
    return [];
  }
  try {
    const parsed = JSON.parse(postsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseCommentJson(commentsJson: string | null | undefined): Array<{ text?: string }> {
  if (!commentsJson) {
    return [];
  }
  try {
    const parsed = JSON.parse(commentsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function analyzeScrapeResult(bot: Bot, data: ScraperOutput): AnalysisResult {
  if (isArticle(data)) {
    const firstSentence = data.content.split(/[.!?]/).find(Boolean)?.trim() || data.title;
    const sourceBrief = buildResearchBrief(bot.targetDomain, [
      {
        source: bot.type,
        url: bot.targetUrl,
        title: data.title,
        text: data.content,
        publishedAt: data.publishDate
      }
    ]);
    return {
      summary: `${data.title}: ${firstSentence}`,
      keyMessage: firstSentence,
      targetAudience: "Logistics operators, competitors, customers, and market researchers.",
      contentStructure: "Headline, publication metadata, body content, and supporting images.",
      viewerReaction: "Likely interest depends on operational relevance, freshness, and credibility of the source.",
      competitorInsight: `Track how ${bot.name} frames service quality, pricing pressure, speed, and market coverage.\n${sourceBrief}`,
      valueScore: 70,
      viralScore: 35
    };
  }

  if (isProduct(data)) {
    return {
      summary: `${data.productName} is listed as ${data.availability}${data.price ? ` at ${data.currency ?? ""} ${data.price}` : ""}.`,
      keyMessage: "Product availability and price movement should be monitored over time.",
      targetAudience: "Procurement, pricing, ecommerce, and competitor monitoring teams.",
      contentStructure: "Product name, price, currency, availability, and source URL.",
      viewerReaction: "Customers will likely compare price, stock state, and perceived seller reliability.",
      competitorInsight: "Repeated snapshots can reveal discount timing, stock pressure, and marketplace positioning.",
      valueScore: data.price ? 65 : null,
      viralScore: null
    };
  }

  if (isSocial(data)) {
    const posts = parsePostJson(data.postsJson);
    const commentSamples = parseCommentJson(data.commentsJson);
    const firstPost = posts.find((post) => post.text || post.content);
    const firstPostText = (firstPost?.text || firstPost?.content || "").replace(/\s+/g, " ").trim();
    const firstComment = commentSamples.find((comment) => comment.text)?.text?.replace(/\s+/g, " ").trim();
    return {
      summary: firstPostText
        ? `Captured ${data.postCount ?? posts.length} Facebook post(s). Latest visible post: ${firstPostText.slice(0, 220)}`
        : "Public engagement snapshot captured from the target URL.",
      keyMessage: firstPostText ? firstPostText.slice(0, 180) : "Engagement metrics indicate how visible or persuasive the content may be.",
      targetAudience: "Brand, marketing, and competitor intelligence teams.",
      contentStructure: firstPostText
        ? "Extracted visible Facebook feed posts, comment samples when visible, links when available, and public metrics."
        : "Public metrics grouped by views, likes, comments, shares, and saves.",
      viewerReaction: firstComment
        ? `Visible comment sample: ${firstComment.slice(0, 180)}`
        : data.comments || data.shares
        ? "Comments and shares suggest active audience response beyond passive views."
        : "Reaction is limited or hidden; review extracted post themes and rerun over time.",
      competitorInsight: firstPost
        ? `Track repeated themes, service promises, route announcements, promotions, and customer support language across ${data.postCount ?? posts.length} captured post(s).`
        : "Compare engagement patterns across posts to identify content formats that attract attention.",
      valueScore: null,
      viralScore: data.views && data.views > 10000 ? 80 : 40
    };
  }

  return {
    summary: `Custom bot ${bot.name} captured data from ${bot.targetUrl}.`,
    keyMessage: "Custom scraping result requires domain-specific interpretation.",
    targetAudience: "Analysts reviewing custom sources.",
    contentStructure: "Raw result payload.",
    viewerReaction: "Reaction cannot be inferred without a specialized parser.",
    competitorInsight: "Add a custom scraper to turn raw data into comparable intelligence.",
    valueScore: null,
    viralScore: null
  };
}
