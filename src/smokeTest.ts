import { app } from "./app";
import { closeDb } from "./lib/db";
import { cleanNormalPostCaptionForMetadataNoise, cleanNormalPostCommentForStorage, cleanRenderedTextPreview } from "./scrapers/facebookCrawler";

function listen(port: number): Promise<{ close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      resolve({
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          })
      });
    });
  });
}

async function api<T>(port: number, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`http://localhost:${port}${path}`, {
    headers: { "content-type": "application/json" },
    ...init
  });
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

function assertCaptionCleanup(input: string, expected: string): void {
  const actual = cleanNormalPostCaptionForMetadataNoise(input);
  if (actual !== expected) {
    throw new Error(`Caption cleanup failed.\nExpected: ${expected}\nActual:   ${actual}`);
  }
}

function runCaptionCleanupSmokeCases(): void {
  assertCaptionCleanup(
    'The Chandelier Cluster Every "lightbulb" ... Image credit: ESA/Hubble & NASA, A. Sarajedini, G. Piotto Xem bản dịch Tất cả cảm xúc: 19K 19K 474',
    'The Chandelier Cluster Every "lightbulb" ... Image credit: ESA/Hubble & NASA, A. Sarajedini, G. Piotto'
  );
  assertCaptionCleanup(
    "Hơi bụi ở MCG+08-11-002.… Xem thêm · Xem bản gốc · Xếp hạng bản dịch này Tất cả cảm xúc: 2,7K 2,7K 81",
    "Hơi bụi ở MCG+08-11-002."
  );
  assertCaptionCleanup(
    "NASA's James Webb Space Telescope p o s d S n r e t o f 0 l c n á f g 1 a l 4 3 t 5 6 a g t 7 4 h 3 0 6 i 7 2 : ú l 5 g 0 a 2 1 1 a a 1 3 9 2 l g · Ngôi sao bên túi … Xem thêm · Xem bản gốc · Xếp hạng bản dịch này Tất cả cảm xúc: 248 248 9",
    "Ngôi sao bên túi."
  );
  assertCaptionCleanup(
    "A cluster 27,000 light-years away formed 10 billion years ago. For more: https://go.nasa.gov/4f2MdW6",
    "A cluster 27,000 light-years away formed 10 billion years ago. For more: https://go.nasa.gov/4f2MdW6"
  );
  assertCaptionCleanup(
    "NASA's James Webb Space Telescope d s t r S o n e o p 5 2 t 2 2 t t i 2 6 c 0 3 7 g l g u 1 6 Ãº 0 1 Ã¡ 0 a l 8 c 8 0 6 1 i g c h c : h u n 4 i 2 h Â· NgÃ´i sao bÃªn tÃºi.",
    "NgÃ´i sao bÃªn tÃºi."
  );
  assertCaptionCleanup(
    "NASA's James Webb Space Telescope p s d r n S t o o e 2 7 c h 1 l 1 a Ã¡ m f 4 t 9 3 5 6 0 Ãº h 3 5 7 m h i 7 u a 4 7 0 l g c : t 1 5 2 g n c 6 0 2 Â· NgÃ´i sao bÃªn tÃºi.",
    "NgÃ´i sao bÃªn tÃºi."
  );
}

function runCommentCleanupSmokeCases(): void {
  const daney = cleanNormalPostCommentForStorage(
    {
      commentId: null,
      authorName: "Daney Casey",
      authorUrl: null,
      content: "Theo dõi\nThật hoàn hảo\nThật hoàn hảo\n2 ngày\n2 ngày\nXem bản gốc (Tiếng Anh)",
      reactionCount: null,
      createdAtText: null,
      parentCommentId: null
    },
    "Ngôi sao bên túi"
  );
  if (!daney || daney.authorName !== "Daney Casey" || daney.content !== "Thật hoàn hảo" || daney.createdAtText !== "2 ngày") {
    throw new Error(`Daney comment cleanup failed: ${JSON.stringify(daney)}`);
  }

  const mario = cleanNormalPostCommentForStorage(
    {
      commentId: null,
      authorName: "Mario Lucas",
      authorUrl: null,
      content: "This is a beautiful and humbling view of the universe.\nThis is a beautiful and humbling view of the universe.\n1 ngày\n1 ngày\nXem bản gốc",
      reactionCount: null,
      createdAtText: null,
      parentCommentId: null
    },
    "Ngôi sao bên túi"
  );
  if (
    !mario ||
    mario.authorName !== "Mario Lucas" ||
    mario.content !== "This is a beautiful and humbling view of the universe." ||
    mario.createdAtText !== "1 ngày"
  ) {
    throw new Error(`Mario comment cleanup failed: ${JSON.stringify(mario)}`);
  }

  const leakedPostMetadata = cleanNormalPostCommentForStorage(
    {
      commentId: null,
      authorName: "NASA's Hubble Space Telescope",
      authorUrl: null,
      content: "Bài viết của NASA's Hubble Space Telescope\nNgôi sao bên túi\n… Xem thêm\nXem bản gốc",
      reactionCount: null,
      createdAtText: null,
      parentCommentId: null
    },
    "Ngôi sao bên túi"
  );
  if (leakedPostMetadata) {
    throw new Error(`Post metadata leakage cleanup failed: ${JSON.stringify(leakedPostMetadata)}`);
  }

  const metricLeakage = cleanNormalPostCommentForStorage(
    {
      commentId: null,
      authorName: "Astroventure",
      authorUrl: null,
      content: "2K lượt chia sẻ\nAstroventure",
      reactionCount: null,
      createdAtText: null,
      parentCommentId: null
    },
    "Ngôi sao bên túi"
  );
  if (metricLeakage) {
    throw new Error(`Metric leakage cleanup failed: ${JSON.stringify(metricLeakage)}`);
  }

  const dustCaptionLeakage = cleanNormalPostCommentForStorage(
    {
      commentId: null,
      authorName: "Clark Timothee",
      authorUrl: null,
      content: "Hơi bụi ở MCG+08-11-002.… Xem thêm\n· Xem bản gốc\n· Xếp hạng bản dịch này\nClark Timothee",
      reactionCount: null,
      createdAtText: null,
      parentCommentId: null
    },
    "Hơi bụi ở MCG+08-11-002."
  );
  if (dustCaptionLeakage) {
    throw new Error(`Dust caption leakage cleanup failed: ${JSON.stringify(dustCaptionLeakage)}`);
  }

  const rubinCaptionLeakage = cleanNormalPostCommentForStorage(
    {
      commentId: null,
      authorName: "Rubin Observatory",
      authorUrl: null,
      content: "H… Xem thêm\n· Xem bản gốc\n· Xếp hạng bản dịch này\nRubin Observatory",
      reactionCount: null,
      createdAtText: null,
      parentCommentId: null
    },
    "Rubin + Hubble"
  );
  if (rubinCaptionLeakage) {
    throw new Error(`Rubin caption leakage cleanup failed: ${JSON.stringify(rubinCaptionLeakage)}`);
  }

  const marioUiLeakage = cleanNormalPostCommentForStorage(
    {
      commentId: null,
      authorName: "Mario Lucas",
      authorUrl: null,
      content: "· Xem bản gốc\n· Xếp hạng bản dịch này\nMario Lucas",
      reactionCount: null,
      createdAtText: null,
      parentCommentId: null
    },
    "Ngôi sao bên túi"
  );
  if (marioUiLeakage) {
    throw new Error(`Mario UI leakage cleanup failed: ${JSON.stringify(marioUiLeakage)}`);
  }

  const arun = cleanNormalPostCommentForStorage(
    {
      commentId: null,
      authorName: "Arun Kumar",
      authorUrl: null,
      content: "Arun Kumar\n\nArun Kumar\nMỘT VŨ TRỤ LỚN VÀ TUYỆT VỜI",
      reactionCount: null,
      createdAtText: null,
      parentCommentId: null
    },
    "Ngôi sao bên túi"
  );
  if (!arun || arun.authorName !== "Arun Kumar" || arun.content !== "MỘT VŨ TRỤ LỚN VÀ TUYỆT VỜI") {
    throw new Error(`Arun duplicate cleanup failed: ${JSON.stringify(arun)}`);
  }
}

function runRenderedPreviewCleanupSmokeCases(): void {
  const actual = cleanRenderedTextPreview(
    [
      "[facebook-collected-post-url-raw=https://www.facebook.com/raw-post]",
      "--- FACEBOOK ROUTED POST ---",
      "[facebook-post-router=post]",
      "clean content only"
    ].join("\n")
  );
  if (actual !== "clean content only") {
    throw new Error(`Rendered preview cleanup failed.\nExpected: clean content only\nActual:   ${actual}`);
  }
}

async function main(): Promise<void> {
  runCaptionCleanupSmokeCases();
  runCommentCleanupSmokeCases();
  runRenderedPreviewCleanupSmokeCases();
  const port = 4100 + Math.floor(Math.random() * 1000);
  const server = await listen(port);

  try {
    const html = await fetch(`http://localhost:${port}/`).then((response) => response.text());
    if (!html.includes("Multi-Bot Crawler")) {
      throw new Error("Dashboard did not render.");
    }

    const doc =
      '<html><head><title>Setup Smoke Product</title><script type="application/ld+json">{"@type":"Product","name":"Setup Smoke Product","offers":{"price":"99000","priceCurrency":"VND","availability":"InStock"}}</script></head><body><h1>Setup Smoke Product</h1><p>Price VND 99000 available</p></body></html>';
    const targetUrl = `data:text/html,${encodeURIComponent(doc)}`;
    const created = await api<{ id: number }>(port, "/api/bots", {
      method: "POST",
      body: JSON.stringify({
        name: "Setup Smoke Product Bot",
        type: "product",
        targetUrl,
        browserProfile: "setup-smoke-profile",
        browserEngine: "fetch",
        retryLimit: 1,
        status: "active"
      })
    });

    const run = await api<{ crawlResultId: number; job: { id: number; status: string } }>(port, `/api/run-bot/${created.id}`, {
      method: "POST"
    });
    const detail = await api<{ result: { status: string }; productSnapshot: { price: number } }>(
      port,
      `/api/crawl-results/${run.crawlResultId}`
    );
    const job = await api<{ logs: unknown[] }>(port, `/api/jobs/${run.job.id}`);

    await fetch(`http://localhost:${port}/api/bots/${created.id}`, { method: "DELETE" });

    if (detail.result.status !== "success" || detail.productSnapshot.price !== 99000 || job.logs.length === 0) {
      throw new Error("Smoke crawl did not produce expected result.");
    }

    console.log("Smoke test passed");
    console.log(`Crawl result: ${run.crawlResultId}`);
    console.log(`Job logs: ${job.logs.length}`);
  } finally {
    await server.close();
    closeDb();
  }
}

main().catch((error) => {
  console.error(error);
  closeDb();
  process.exitCode = 1;
});

