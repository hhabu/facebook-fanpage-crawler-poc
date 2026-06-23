# Facebook Fanpage Crawler Guide

## Overview

This crawler collects publicly visible data from Facebook fanpages using Playwright and stores the results in SQLite.

### Features

* Crawl Facebook fanpage posts
* Extract post URL and post ID
* Extract engagement metrics (reactions, comments, shares)
* Crawl visible comments and replies
* Remove duplicated entries
* Save results into SQLite database
* Export crawl results as JSON
* Support browser profile sessions
* Retry and logging support

---

## Requirements

* Node.js 20+
* Google Chrome
* npm

---

## Installation

```bash
npm install
```

Start the application:

```bash
npm run dev
```

Server:

```text
http://localhost:4000
```

---

## Login Session

1. Create a Facebook bot.
2. Click "Warm Login".
3. Login to Facebook in the opened browser.
4. Click "Save Session".
5. Close the warm-up browser.

The session will be stored under:

```text
data/browser-profiles/
```

---

## Running a Crawl

Input:

```text
https://www.facebook.com/NASAHubble
```

Steps:

1. Create a Social Bot.
2. Enter Facebook Fanpage URL.
3. Click Run.
4. Wait for crawler completion.
5. Inspect results in History.

---

## Database

SQLite database:

```text
database/mvp.sqlite
```

Main tables:

### social_post_snapshots

Stores crawled Facebook posts.

### social_comment_snapshots

Stores comments and replies.

### crawl_results

Stores crawl metadata and raw results.

### bot_job_logs

Stores execution logs.

---

## JSON Export

All crawl results:

```text
GET /api/exports/crawl-results.json
```

Single crawl result:

```text
GET /api/exports/crawl-results/{id}.json
```

Example output:

```text
docs/sample-facebook-output.json
```

---

## Current Limitations

* Facebook may hide some content behind login requirements.
* Full historical crawling depends on Facebook UI availability.
* Some post captions may not be accessible through the current DOM structure.
* When a post caption cannot be extracted safely, the crawler stores:

```text
(post content unavailable)
```

instead of saving incorrect content.
