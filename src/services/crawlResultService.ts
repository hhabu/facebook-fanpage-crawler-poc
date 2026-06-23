import { getDb } from "../lib/db";
import type { BotType } from "../lib/botTypes";
import type {
  AnalysisResult,
  ArticleSnapshot,
  CrawlResult,
  CrawlResultDetail,
  CrawlStatus,
  ProductSnapshot,
  SaveCrawlResultInput,
  SocialCommentSnapshot,
  SocialPostSnapshot,
  SocialSnapshot
} from "../lib/scraperTypes";

const POST_CONTENT_UNAVAILABLE = "(post content unavailable)";

interface CrawlResultRow {
  id: number;
  bot_id: number;
  type: BotType;
  url: string;
  title: string | null;
  raw_text: string | null;
  raw_html: string | null;
  screenshot_path: string | null;
  status: CrawlStatus;
  error_message: string | null;
  block_reason: string | null;
  render_engine: string | null;
  http_status: number | null;
  created_at: string;
}

interface ArticleSnapshotRow {
  id: number;
  crawl_result_id: number;
  title: string;
  publish_date: string | null;
  author: string | null;
  content: string;
  images_json: string | null;
}

interface ProductSnapshotRow {
  id: number;
  crawl_result_id: number;
  product_name: string;
  price: number | null;
  currency: string | null;
  availability: string | null;
  image_url: string | null;
  price_changed: number;
  previous_price: number | null;
}

interface SocialSnapshotRow {
  id: number;
  crawl_result_id: number;
  platform: string | null;
  post_count: number | null;
  posts_json: string | null;
  comments_json: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  downloads: number | null;
  engagement_rate: number | null;
  unavailable_reason: string | null;
}

interface AnalysisResultRow {
  id: number;
  crawl_result_id: number;
  summary: string;
  key_message: string;
  target_audience: string;
  content_structure: string;
  viewer_reaction: string;
  competitor_insight: string;
  value_score: number | null;
  viral_score: number | null;
  created_at: string;
}

interface SocialPostSnapshotRow {
  id: number;
  crawl_result_id: number;
  post_url: string;
  post_id: string | null;
  author: string | null;
  content: string;
  published_at: string | null;
  reaction_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  view_count: number | null;
  raw_text: string | null;
  created_at: string;
}

interface SocialCommentSnapshotRow {
  id: number;
  social_post_id: number;
  comment_id: string | null;
  author_name: string | null;
  author_url: string | null;
  content: string;
  reaction_count: number | null;
  created_at_text: string | null;
  parent_comment_id: string | null;
  created_at: string;
}

function mapCrawlResult(row: CrawlResultRow): CrawlResult {
  return {
    id: row.id,
    botId: row.bot_id,
    type: row.type,
    url: row.url,
    title: row.title,
    rawText: row.raw_text,
    rawHtml: row.raw_html,
    screenshotPath: row.screenshot_path,
    status: row.status,
    errorMessage: row.error_message,
    blockReason: row.block_reason,
    renderEngine: row.render_engine,
    httpStatus: row.http_status,
    createdAt: row.created_at
  };
}

function mapArticleSnapshot(row: ArticleSnapshotRow | undefined): ArticleSnapshot | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    crawlResultId: row.crawl_result_id,
    title: row.title,
    publishDate: row.publish_date,
    author: row.author,
    content: row.content,
    imagesJson: row.images_json
  };
}

function mapProductSnapshot(row: ProductSnapshotRow | undefined): ProductSnapshot | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    crawlResultId: row.crawl_result_id,
    productName: row.product_name,
    price: row.price,
    currency: row.currency,
    availability: row.availability,
    imageUrl: row.image_url,
    priceChanged: Boolean(row.price_changed),
    previousPrice: row.previous_price
  };
}

function mapSocialSnapshot(row: SocialSnapshotRow | undefined): SocialSnapshot | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    crawlResultId: row.crawl_result_id,
    platform: row.platform,
    postCount: row.post_count,
    postsJson: row.posts_json,
    commentsJson: row.comments_json,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
    downloads: row.downloads,
    engagementRate: row.engagement_rate,
    unavailableReason: row.unavailable_reason
  };
}

function mapAnalysisResult(row: AnalysisResultRow | undefined): AnalysisResult | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    crawlResultId: row.crawl_result_id,
    summary: row.summary,
    keyMessage: row.key_message,
    targetAudience: row.target_audience,
    contentStructure: row.content_structure,
    viewerReaction: row.viewer_reaction,
    competitorInsight: row.competitor_insight,
    valueScore: row.value_score,
    viralScore: row.viral_score,
    createdAt: row.created_at
  };
}

function mapSocialComment(row: SocialCommentSnapshotRow): SocialCommentSnapshot {
  return {
    id: row.id,
    socialPostId: row.social_post_id,
    commentId: row.comment_id,
    authorName: row.author_name,
    authorUrl: row.author_url,
    content: row.content,
    reactionCount: row.reaction_count,
    createdAtText: row.created_at_text,
    parentCommentId: row.parent_comment_id,
    createdAt: row.created_at
  };
}

function mapSocialPost(row: SocialPostSnapshotRow, comments: SocialCommentSnapshot[] = []): SocialPostSnapshot {
  return {
    id: row.id,
    crawlResultId: row.crawl_result_id,
    postUrl: row.post_url,
    postId: row.post_id,
    author: row.author,
    content: row.content,
    publishedAt: row.published_at,
    reactionCount: row.reaction_count,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    shareCount: row.share_count,
    viewCount: row.view_count,
    rawText: row.raw_text,
    comments,
    createdAt: row.created_at
  };
}

export function saveCrawlResult(input: SaveCrawlResultInput): CrawlResult {
  const db = getDb();

  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO crawl_results (
          bot_id, type, url, title, raw_text, raw_html, screenshot_path, status, error_message,
          block_reason, render_engine, http_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.botId,
        input.type,
        input.url,
        input.title ?? null,
        input.rawText ?? null,
        input.rawHtml ?? null,
        input.screenshotPath ?? null,
        input.status,
        input.errorMessage ?? null,
        input.blockReason ?? null,
        input.renderEngine ?? null,
        input.httpStatus ?? null
      );

    const crawlResultId = Number(result.lastInsertRowid);

    if (input.articleSnapshot) {
      saveArticleSnapshot(crawlResultId, input.articleSnapshot);
    }

    if (input.productSnapshot) {
      saveProductSnapshot(crawlResultId, input.productSnapshot);
    }

    if (input.socialSnapshot) {
      saveSocialSnapshot(crawlResultId, input.socialSnapshot);
    }

    if (input.socialPosts?.length) {
      saveSocialPosts(crawlResultId, input.socialPosts);
    }

    if (input.analysisResult) {
      saveAnalysisResult(crawlResultId, input.analysisResult);
    }

    return getCrawlResultById(crawlResultId)!;
  })();
}

export function getCrawlResults(): CrawlResult[] {
  const rows = getDb().prepare("SELECT * FROM crawl_results ORDER BY created_at DESC").all() as CrawlResultRow[];
  return rows.map(mapCrawlResult);
}

export function getCrawlResultById(id: number): CrawlResult | null {
  const row = getDb().prepare("SELECT * FROM crawl_results WHERE id = ?").get(id) as CrawlResultRow | undefined;
  return row ? mapCrawlResult(row) : null;
}

export function getCrawlResultDetail(id: number): CrawlResultDetail | null {
  const result = getCrawlResultById(id);
  if (!result) {
    return null;
  }

  const db = getDb();
  const articleRow = db.prepare("SELECT * FROM article_snapshots WHERE crawl_result_id = ?").get(id) as
    | ArticleSnapshotRow
    | undefined;
  const productRow = db.prepare("SELECT * FROM product_snapshots WHERE crawl_result_id = ?").get(id) as
    | ProductSnapshotRow
    | undefined;
  const socialRow = db.prepare("SELECT * FROM social_snapshots WHERE crawl_result_id = ?").get(id) as
    | SocialSnapshotRow
    | undefined;
  const analysisRow = db.prepare("SELECT * FROM analysis_results WHERE crawl_result_id = ?").get(id) as
    | AnalysisResultRow
    | undefined;
  const socialPostRows = db
    .prepare("SELECT * FROM social_post_snapshots WHERE crawl_result_id = ? ORDER BY id ASC")
    .all(id) as SocialPostSnapshotRow[];
  const socialPosts = socialPostRows.map((post) => {
    const commentRows = db
      .prepare("SELECT * FROM social_comment_snapshots WHERE social_post_id = ? ORDER BY id ASC")
      .all(post.id) as SocialCommentSnapshotRow[];
    return mapSocialPost(post, commentRows.map(mapSocialComment));
  });

  return {
    result,
    articleSnapshot: mapArticleSnapshot(articleRow),
    productSnapshot: mapProductSnapshot(productRow),
    socialSnapshot: mapSocialSnapshot(socialRow),
    socialPosts,
    analysisResult: mapAnalysisResult(analysisRow)
  };
}

export function deleteCrawlResult(id: number): boolean {
  const result = getDb().prepare("DELETE FROM crawl_results WHERE id = ?").run(id);
  return result.changes > 0;
}

export function deleteAllCrawlResults(): number {
  const result = getDb().prepare("DELETE FROM crawl_results").run();
  return result.changes;
}

export function saveArticleSnapshot(crawlResultId: number, snapshot: Omit<ArticleSnapshot, "id" | "crawlResultId">): void {
  getDb()
    .prepare(
      `INSERT INTO article_snapshots (
        crawl_result_id, title, publish_date, author, content, images_json
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(crawlResultId, snapshot.title, snapshot.publishDate, snapshot.author, snapshot.content, snapshot.imagesJson);
}

export function saveProductSnapshot(crawlResultId: number, snapshot: Omit<ProductSnapshot, "id" | "crawlResultId">): void {
  const crawlResult = getCrawlResultById(crawlResultId);
  const lastPriceRow = crawlResult
    ? (getDb()
        .prepare(
          `SELECT price FROM product_price_history
           WHERE bot_id = ? AND product_name = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 1`
        )
        .get(crawlResult.botId, snapshot.productName) as { price: number | null } | undefined)
    : undefined;
  const previousPrice = snapshot.previousPrice ?? lastPriceRow?.price ?? null;
  const priceChanged =
    snapshot.priceChanged ?? (previousPrice !== null && snapshot.price !== null && Number(previousPrice) !== Number(snapshot.price));

  getDb()
    .prepare(
      `INSERT INTO product_snapshots (
        crawl_result_id, product_name, price, currency, availability, image_url, price_changed, previous_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      crawlResultId,
      snapshot.productName,
      snapshot.price,
      snapshot.currency,
      snapshot.availability,
      snapshot.imageUrl,
      priceChanged ? 1 : 0,
      previousPrice
    );

  if (crawlResult) {
    getDb()
      .prepare(
        `INSERT INTO product_price_history (
          bot_id, crawl_result_id, product_name, price, currency, availability
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(crawlResult.botId, crawlResultId, snapshot.productName, snapshot.price, snapshot.currency, snapshot.availability);
  }
}

export function saveSocialSnapshot(crawlResultId: number, snapshot: Omit<SocialSnapshot, "id" | "crawlResultId">): void {
  getDb()
    .prepare(
      `INSERT INTO social_snapshots (
        crawl_result_id, platform, post_count, posts_json, comments_json, views, likes, comments, shares, saves, downloads, engagement_rate,
        unavailable_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      crawlResultId,
      snapshot.platform,
      snapshot.postCount ?? null,
      snapshot.postsJson ?? null,
      snapshot.commentsJson ?? null,
      snapshot.views,
      snapshot.likes,
      snapshot.comments,
      snapshot.shares,
      snapshot.saves,
      snapshot.downloads,
      snapshot.engagementRate,
      snapshot.unavailableReason ?? null
    );
}

export function saveSocialPosts(
  crawlResultId: number,
  posts: Array<Omit<SocialPostSnapshot, "id" | "crawlResultId" | "comments" | "createdAt"> & {
    comments?: Array<Omit<SocialCommentSnapshot, "id" | "socialPostId" | "createdAt">>;
  }>
): void {
  const db = getDb();
  const insertPost = db.prepare(
    `INSERT INTO social_post_snapshots (
      crawl_result_id, post_url, post_id, author, content, published_at, reaction_count,
      like_count, comment_count, share_count, view_count, raw_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertComment = db.prepare(
    `INSERT INTO social_comment_snapshots (
      social_post_id, comment_id, author_name, author_url, content, reaction_count, created_at_text,
      parent_comment_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const post of posts) {
    const sanitizedContent = post.content?.replace(/\s+/g, " ").trim() || POST_CONTENT_UNAVAILABLE;
    const result = insertPost.run(
      crawlResultId,
      post.postUrl,
      post.postId,
      post.author,
      sanitizedContent,
      post.publishedAt,
      post.reactionCount,
      post.likeCount,
      post.commentCount,
      post.shareCount,
      post.viewCount,
      post.rawText
    );
    const socialPostId = Number(result.lastInsertRowid);
    for (const comment of post.comments ?? []) {
      insertComment.run(
        socialPostId,
        comment.commentId,
        comment.authorName,
        comment.authorUrl,
        comment.content,
        comment.reactionCount,
        comment.createdAtText,
        comment.parentCommentId
      );
    }
  }
}

export function saveAnalysisResult(crawlResultId: number, analysis: Omit<AnalysisResult, "id" | "crawlResultId" | "createdAt">): void {
  getDb()
    .prepare(
      `INSERT INTO analysis_results (
        crawl_result_id, summary, key_message, target_audience, content_structure,
        viewer_reaction, competitor_insight, value_score, viral_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      crawlResultId,
      analysis.summary,
      analysis.keyMessage,
      analysis.targetAudience,
      analysis.contentStructure,
      analysis.viewerReaction,
      analysis.competitorInsight,
      analysis.valueScore,
      analysis.viralScore
    );
}

export const createCrawlResult = saveCrawlResult;
export const listCrawlResults = getCrawlResults;
export const getCrawlResult = getCrawlResultById;
