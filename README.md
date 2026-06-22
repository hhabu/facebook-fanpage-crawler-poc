# Multi-Bot Scraping and Analysis Tool

MVP architecture for managing scraping bots, running simple workers, storing results in SQLite, and generating structured analysis records.

## Setup on Windows

Run from this folder:

```powershell
D:\Internship AmazingTech\multi-bot scraping and analysis tool
```

Install dependencies:

```powershell
npm.cmd install
```

Create `.env`, initialize SQLite, create data folders, and seed demo bots:

```powershell
npm.cmd run setup
```

Verify the crawler:

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd run smoke
```

Start the dev server:

```powershell
npm.cmd run dev
```

API server defaults to `http://localhost:4000`.

The dashboard is served by the same app:

```text
http://localhost:4000
```

## Useful endpoints

- `GET /health`
- `GET /api/bots`
- `GET /api/browser-profiles`
- `POST /api/bots`
- `PUT /api/bots/:id`
- `DELETE /api/bots/:id`
- `POST /api/run-bot/:id`
- `GET /api/crawl-results`
- `GET /api/crawl-results/:id`

## Configuration

Edit `.env` after running setup:

```text
PORT=4000
SCHEDULER_ENABLED=false
CRAWLER_MAX_CONCURRENCY=2
CLOAK_HEADLESS=true
CLOAK_HUMANIZE=true
CLOAK_LOCALE=vi-VN
CLOAK_TIMEZONE=Asia/Ho_Chi_Minh
CLOAK_PROXY=
DEFAULT_RETRY_LIMIT=2
DEFAULT_COOLDOWN_SECONDS=60
```

For first production-like tests, keep bot `browserEngine` as `fetch` for simple pages and use `auto`/`cloak` for JS-heavy product/social pages. CloakBrowser may download/use its managed Chromium on first browser run.

## Facebook / TikTok Blocked Or Captcha

If a Facebook crawl result shows `status: blocked` and `blockReason: captcha`, the crawler is being shown a verification page. This is expected for many Facebook public URLs.

Facebook profile warm-up and Facebook-domain crawling now use native Google Chrome via Playwright persistent context, matching the simpler approach used in `facebook_multi_account_manager`:

```text
NATIVE_CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

Warm up the bot profile from the dashboard:

1. Click `Warm Login` on the bot.
2. A visible browser should open.
3. Log in or complete verification there.
4. Click `Save Session`.
5. Run the bot again.

Or warm it from terminal:

```powershell
npm.cmd run profile:open -- --botId 6 --url https://www.facebook.com
```

Then:

1. Log in or complete verification in the opened browser.
2. Return to the terminal and press Enter.
3. Run the bot again from the dashboard.

The bot will reuse the same persistent profile folder, including cookies/session data. If Facebook still blocks, use a clean profile, residential proxy, or lower run frequency.

## Notes

The MVP scrapers use lightweight HTML extraction and are intended as replaceable worker modules. Browser profile names are stored on each bot so Playwright persistent browser contexts can be added later without changing the bot model.

See [docs/architecture.md](docs/architecture.md) for the reference-inspired architecture:

- CloakBrowser style: per-bot browser profile boundary.
- last30days-skill style: future recent-source research and synthesis.
- MoneyPrinterTurbo style: staged automation pipeline.

See [docs/reuse-report.md](docs/reuse-report.md) for the concrete reuse audit and integration decisions.

See [docs/production-upgrade.md](docs/production-upgrade.md) for the production crawler foundation.

## Production Endpoints

- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/scheduler`
- `POST /api/scheduler/tick`
- `GET /api/exports/crawl-results.csv`
- `GET /api/exports/crawl-results.json`
- `POST /api/browser-profiles/open/:botId`
- `GET /api/browser-profiles/test/:botId`
