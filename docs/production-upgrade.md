# Production Crawler Upgrade

This upgrade keeps the MVP working while adding the production foundation requested by the mentor.

## Implemented

- Browser engine abstraction:
  - `FetchEngine`
  - `CloakBrowserEngine`
  - `PlaywrightEngine` wrapper placeholder
- Per-bot persistent profile directories.
- Per-bot config:
  - browser engine
  - proxy URL
  - user agent
  - retry limit
  - cooldown seconds
  - cron schedule
- Rendered crawl pipeline:
  - initialize browser/profile
  - navigate
  - render
  - extract
  - analyze
  - save
- Raw HTML, rendered text, HTTP status, render engine, screenshot path fields.
- Block detection:
  - captcha
  - access denied
  - robot check
  - login required
  - rate limited
- SQLite job tables:
  - `bot_jobs`
  - `bot_job_logs`
- Job status:
  - pending
  - running
  - success
  - failed
  - blocked
  - retrying
- Product extraction upgrade:
  - JSON-LD product parsing
  - meta/title fallback
  - price history table
  - price change fields
- Social extraction upgrade:
  - visible text metrics
  - engagement rate
  - unavailable reason such as `metric_not_visible`
- RSS/policy monitor dedupe.
- Scheduler foundation:
  - cron field support
  - manual tick endpoint
  - disabled by default unless `SCHEDULER_ENABLED=true`
- Export endpoints:
  - CSV
  - JSON
- Dashboard upgrade:
  - Job Queue / Run Logs
  - export links
  - production bot config fields
  - scheduler status

## Reused / Adapted References

- CloakBrowser:
  - installed `cloakbrowser`
  - wrapper in `src/integrations/cloakBrowserClient.ts`
  - production browser engine in `src/browser/cloakBrowserEngine.ts`
- last30days-skill:
  - adapted recent-source scoring and research brief boundary in `src/integrations/last30daysResearchAdapter.ts`
  - RSS policy monitor uses dedupe and source metadata storage
- MoneyPrinterTurbo:
  - adapted staged task pipeline and job status pattern through `bot_jobs` and `bot_job_logs`

## Not Fully Implemented Yet

- Real human login UI that opens a visible browser window from the dashboard.
- Proxy pool rotation.
- CAPTCHA solving.
- Site-specific TikTok/Facebook/YouTube DOM adapters.
- Durable distributed worker queue.
- Full cron parser for all cron fields.

The current foundation is ready for those modules without rewriting the crawler core.

## Run

```powershell
npm.cmd run seed
npm.cmd run dev
```

Dashboard:

```text
http://localhost:4000
```

Enable scheduler:

```powershell
$env:SCHEDULER_ENABLED='true'
npm.cmd run dev
```
