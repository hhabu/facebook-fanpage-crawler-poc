# Reuse Report

This report records what was inspected and what was safely reused for the MVP.

## CloakBrowser

License: MIT for the npm package and repo source. Binary licensing is separate in `BINARY-LICENSE.md`, so we avoid vendoring binaries.

Reusable files/modules inspected:

| Repo path | Feature | Decision |
| --- | --- | --- |
| `js/src/index.ts` | Exports Playwright/Puppeteer-compatible launcher APIs | Use package import |
| `js/src/playwright.ts` | `launch`, `launchContext`, `launchPersistentContext`, `buildLaunchOptions` | Use package import |
| `js/src/types.ts` | Launch option types including proxy, locale, timezone, humanize, persistent profile | Adapt interface locally |
| `js/src/proxy.ts` | Proxy parsing/session isolation support | Reference through package |
| `js/src/download.ts` | Binary download/cache management | Reference through package |

Implemented:

- Installed `cloakbrowser` and `playwright-core`.
- Added `src/integrations/cloakBrowserClient.ts` as an optional runtime wrapper.
- Kept the MVP fetch scraper as default so the app works without downloading/running a browser binary.

## last30days-skill

License: MIT.

Reusable files/modules inspected:

| Repo path | Feature | Decision |
| --- | --- | --- |
| `skills/last30days/SKILL.md` | Research workflow and source matrix | Adapt workflow |
| `skills/last30days/scripts/last30days.py` | CLI pipeline, source orchestration | Reference only |
| `skills/last30days/scripts/store.py` | SQLite research accumulator, WAL, dedupe, FTS | Reference for future research store |
| `skills/last30days/scripts/lib/*` | Research engine internals | Do not vendor yet |

Reason not directly copied: the useful implementation is a Python 3.12 agent skill with many optional external services and agent-tool assumptions. Vendoring it whole would add a second runtime and many credentials before the MVP needs them.

Implemented:

- Added `src/integrations/last30daysResearchAdapter.ts`.
- Reused the safe behavior boundary: source signals, freshness/relevance/engagement scoring, brief synthesis.

## MoneyPrinterTurbo

License: MIT.

Reusable files/modules inspected:

| Repo path | Feature | Decision |
| --- | --- | --- |
| `app/services/task.py` | Stage-based task orchestration | Adapt pattern |
| `app/config/config.py` | TOML config loading and environment-aware defaults | Reference for future config module |
| `app/models/schema.py` | Strong typed task params | Reference for future bot/task schema validation |
| `main.py`, `app/router.py` | API/Web split | Reference only |

Reason not directly copied: the code is Python and focused on AI video generation, media downloads, subtitles, and rendering. The reusable value for this crawler is the stage/status orchestration pattern, not the video-specific implementation.

Implemented:

- Added `src/integrations/moneyPrinterPipelineAdapter.ts`.
- Kept the existing TypeScript pipeline but exposed a reusable stage runner.

## What Was Not Reused

- CloakBrowser binary code or source patches: use package-managed binary download instead.
- last30days full CLI: too broad for MVP, Python 3.12+, many optional providers.
- MoneyPrinterTurbo video services: unrelated to scraping and analysis.

## Test

```bash
npm.cmd run check
npm.cmd run build
npm.cmd run seed
```
