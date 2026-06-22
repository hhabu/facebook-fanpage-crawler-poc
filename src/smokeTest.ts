import { app } from "./app";
import { closeDb } from "./lib/db";

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

async function main(): Promise<void> {
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

