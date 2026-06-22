/*
 * Source repo: https://github.com/mvanhorn/last30days-skill
 * Reuse reason: The project is an MIT-licensed Python/agent skill with strong research
 * mechanics: source discovery, freshness/relevance/engagement scoring, clustering, and
 * synthesis. Its CLI requires Python 3.12+ and agent-tool context, so we keep a TypeScript
 * adapter boundary now and can wire a vendored/external CLI later without disturbing the MVP.
 */

export interface ResearchSignal {
  source: string;
  url: string;
  title: string;
  text: string;
  publishedAt?: string | null;
  engagement?: {
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
  };
}

export interface ScoredResearchSignal extends ResearchSignal {
  relevanceScore: number;
  freshnessScore: number;
  engagementScore: number;
  totalScore: number;
}

function daysOld(publishedAt?: string | null): number {
  if (!publishedAt) {
    return 30;
  }

  const timestamp = Date.parse(publishedAt);
  if (Number.isNaN(timestamp)) {
    return 30;
  }

  return Math.max(0, (Date.now() - timestamp) / 86400000);
}

export function scoreResearchSignal(signal: ResearchSignal, topic: string): ScoredResearchSignal {
  const normalizedTopic = topic.toLowerCase();
  const searchable = `${signal.title} ${signal.text}`.toLowerCase();
  const relevanceScore = searchable.includes(normalizedTopic) ? 1 : 0.35;
  const freshnessScore = Math.max(0, 1 - daysOld(signal.publishedAt) / 30);
  const engagementRaw =
    (signal.engagement?.views ?? 0) * 0.1 +
    (signal.engagement?.likes ?? 0) +
    (signal.engagement?.comments ?? 0) * 2 +
    (signal.engagement?.shares ?? 0) * 3 +
    (signal.engagement?.saves ?? 0) * 2;
  const engagementScore = Math.min(1, Math.log10(engagementRaw + 1) / 6);
  const totalScore = relevanceScore * 0.45 + freshnessScore * 0.25 + engagementScore * 0.3;

  return {
    ...signal,
    relevanceScore,
    freshnessScore,
    engagementScore,
    totalScore
  };
}

export function buildResearchBrief(topic: string, signals: ResearchSignal[]): string {
  const ranked = signals
    .map((signal) => scoreResearchSignal(signal, topic))
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 5);

  if (ranked.length === 0) {
    return `No recent source signals were captured for ${topic}.`;
  }

  return ranked
    .map((signal, index) => `${index + 1}. ${signal.title} (${signal.source}) - ${signal.url}`)
    .join("\n");
}
