import type { BotType } from "./botTypes";

export type CrawlStatus = "success" | "failed" | "blocked";

export interface CrawlResult {
  id: number;
  botId: number;
  type: BotType;
  url: string;
  title: string | null;
  rawText: string | null;
  rawHtml: string | null;
  screenshotPath: string | null;
  status: CrawlStatus;
  errorMessage: string | null;
  blockReason: string | null;
  renderEngine: string | null;
  httpStatus: number | null;
  createdAt: string;
}

export interface SaveCrawlResultInput {
  botId: number;
  type: BotType;
  url: string;
  title?: string | null;
  rawText?: string | null;
  rawHtml?: string | null;
  screenshotPath?: string | null;
  status: CrawlStatus;
  errorMessage?: string | null;
  blockReason?: string | null;
  renderEngine?: string | null;
  httpStatus?: number | null;
  articleSnapshot?: Omit<ArticleSnapshot, "id" | "crawlResultId">;
  productSnapshot?: Omit<ProductSnapshot, "id" | "crawlResultId">;
  socialSnapshot?: Omit<SocialSnapshot, "id" | "crawlResultId">;
  socialPosts?: Array<Omit<SocialPostSnapshot, "id" | "crawlResultId" | "comments" | "createdAt"> & {
    comments?: Array<Omit<SocialCommentSnapshot, "id" | "socialPostId" | "createdAt">>;
  }>;
  analysisResult?: Omit<AnalysisResult, "id" | "crawlResultId" | "createdAt">;
}

export interface ArticleSnapshot {
  id?: number;
  crawlResultId?: number;
  title: string;
  publishDate: string | null;
  author: string | null;
  content: string;
  imagesJson: string | null;
}

export interface ProductSnapshot {
  id?: number;
  crawlResultId?: number;
  productName: string;
  price: number | null;
  currency: string | null;
  availability: string | null;
  imageUrl: string | null;
  priceChanged?: boolean;
  previousPrice?: number | null;
}

export interface SocialSnapshot {
  id?: number;
  crawlResultId?: number;
  platform: string | null;
  postCount?: number | null;
  postsJson?: string | null;
  commentsJson?: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  downloads: number | null;
  engagementRate: number | null;
  unavailableReason?: string | null;
}

export interface SocialCommentSnapshot {
  id?: number;
  socialPostId?: number;
  commentId: string | null;
  authorName: string | null;
  authorUrl: string | null;
  content: string;
  reactionCount: number | null;
  createdAtText: string | null;
  parentCommentId: string | null;
  createdAt?: string;
}

export interface SocialPostSnapshot {
  id?: number;
  crawlResultId?: number;
  postUrl: string;
  postId: string | null;
  author: string | null;
  content: string;
  publishedAt: string | null;
  reactionCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  viewCount: number | null;
  rawText: string | null;
  comments?: SocialCommentSnapshot[];
  createdAt?: string;
}

export interface AnalysisResult {
  id?: number;
  crawlResultId?: number;
  summary: string;
  keyMessage: string;
  targetAudience: string;
  contentStructure: string;
  viewerReaction: string;
  competitorInsight: string;
  valueScore: number | null;
  viralScore: number | null;
  createdAt?: string;
}

export type ScraperOutput = ArticleSnapshot | ProductSnapshot | SocialSnapshot;

export interface CrawlResultDetail {
  result: CrawlResult;
  articleSnapshot: ArticleSnapshot | null;
  productSnapshot: ProductSnapshot | null;
  socialSnapshot: SocialSnapshot | null;
  socialPosts: SocialPostSnapshot[];
  analysisResult: AnalysisResult | null;
}
