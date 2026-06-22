# Multi-Bot Scraping Platform Architecture

This MVP adapts architecture patterns from three MIT-licensed reference repositories without copying their implementation code.

## Reference Influence

| Reference | What we borrow | Our module |
| --- | --- | --- |
| CloakBrowser | Separate browser identity, persistent browser data, future stealth/proxy/fingerprint boundary | `src/browser/browserProfileManager.ts` |
| last30days-skill | Resolve sources, gather in parallel later, score/synthesize evidence into a concise brief | `src/services/aiAnalysisService.ts`, future `src/research` |
| MoneyPrinterTurbo | Clear automation pipeline with staged work from input to generated output | `src/pipeline`, `src/scrapers/runBot.ts` |

## Final Architecture

```text
Dashboard/API
  -> Bot Service
  -> Pipeline Orchestrator
  -> Browser Profile Manager
  -> Scraper Worker
  -> Extracted Snapshot
  -> AI Analysis Service
  -> SQLite Storage
  -> Crawl Result History / Dashboard Detail
```

## Data Flow

```text
Bot
  -> Browser Profile
  -> Crawl
  -> Extract
  -> Analyze
  -> Store
  -> Dashboard
```

1. A bot stores task type, target URL/domain, schedule, status, and browser profile name.
2. The runner resolves a persistent browser profile directory for that bot.
3. The scraper for the bot type crawls the target URL.
4. The extractor returns an article, product, or social snapshot.
5. The analysis service creates summary, key message, audience, reaction, insight, and scores.
6. The crawl result, typed snapshot, and analysis are saved to SQLite.
7. The dashboard/API reads bot status, crawl history, and result details.

## MVP Modules

- `src/lib`: shared database and TypeScript types.
- `src/services/botService.ts`: bot CRUD and status updates.
- `src/services/crawlResultService.ts`: crawl result, snapshot, and analysis persistence.
- `src/browser/browserProfileManager.ts`: per-bot profile directory foundation.
- `src/scrapers`: article, product, social, and run dispatcher.
- `src/pipeline`: lightweight job/stage tracking for manual runs.
- `src/routes`: API endpoints for bots, crawl results, and manual run.

## Future Modules

- `src/browser/playwrightProfileLauncher.ts`: Playwright persistent contexts per profile.
- `src/browser/fingerprintPolicy.ts`: proxy, timezone, locale, user agent, viewport policy.
- `src/scheduler`: cron-based bot runs.
- `src/research`: source discovery, recent-source scoring, clustering, and citations.
- `src/jobs`: durable job queue, retries, cancellation, and run logs.
- `src/dashboard`: bot manager, crawl history, product monitor, competitor articles, analysis detail.
- `src/connectors`: Shopee, logistics sites, YouTube/TikTok/social adapters.

## License Note

The references are used as design inspiration only. No source code from the reference repositories is copied into this project.
