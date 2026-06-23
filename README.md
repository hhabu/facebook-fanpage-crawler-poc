# Facebook Fanpage Crawler (Playwright + SQLite)

A Facebook Fanpage crawler built with Playwright, TypeScript, and SQLite for collecting public Facebook post and comment data.

## Features

### Facebook Crawling

* Crawl public Facebook fanpages
* Extract Facebook post URLs
* Extract Facebook post IDs
* Extract engagement metrics

  * Reactions
  * Comments
  * Shares
* Support persistent browser profiles
* Warm-login session management

### Comment Collection

* Expand visible comment threads
* Expand visible replies
* Extract comment author names
* Extract comment content
* Collect reaction counts when available
* Deduplicate extracted comments

### Data Storage

* SQLite database storage
* Structured post snapshots
* Structured comment snapshots
* Crawl history tracking
* Job execution logs

### Export

* JSON export
* CSV export
* Crawl result inspection API

---

## Technology Stack

* Node.js
* TypeScript
* Playwright
* Express
* SQLite
* better-sqlite3

---

## Project Structure

```text
database/
docs/
public/
src/
```

Important files:

```text
database/mvp.sqlite
docs/facebook-crawler-guide.md
docs/sample-facebook-output.json
src/scrapers/facebookCrawler.ts
```

---

## Installation

Clone repository:

```bash
git clone https://github.com/hhabu/facebook-fanpage-crawler-poc.git
cd facebook-fanpage-crawler-poc
```

Install dependencies:

```bash
npm install
```

Run setup:

```bash
npm run setup
```

Verify project:

```bash
npm run check
npm run build
```

Start development server:

```bash
npm run dev
```

Server:

```text
http://localhost:4000
```

---

## Facebook Login Session

Warm up Facebook session:

1. Click **Warm Login**
2. Login to Facebook
3. Complete any verification
4. Click **Save Session**
5. Run the crawler

Or:

```bash
npm run profile:open -- --botId 6 --url https://www.facebook.com
```

Session data is stored under:

```text
data/browser-profiles/
```

---

## Database

Database file:

```text
database/mvp.sqlite
```

Main tables:

### social_post_snapshots

Stores:

* post_url
* post_id
* author
* content
* reaction_count
* comment_count
* share_count

### social_comment_snapshots

Stores:

* comment_id
* author_name
* content
* reaction_count
* parent_comment_id

### crawl_results

Stores crawl metadata.

### bot_jobs

Stores crawler execution jobs.

### bot_job_logs

Stores crawler logs.

---

## Export APIs

Get all crawl results:

```http
GET /exports/crawl-results.json
```

Export CSV:

```http
GET /exports/crawl-results.csv
```

Get crawl result detail:

```http
GET /exports/crawl-results/{id}.json
```

---

## Sample Output

Sample Facebook crawl result:

```text
docs/sample-facebook-output.json
```

---

## Current Limitations

Facebook changes its DOM frequently.

Current crawler:

* Works best with logged-in sessions
* Extracts visible comments and replies
* Depends on page accessibility
* May not always extract post captions reliably

When a post caption cannot be extracted safely, the crawler stores:

```text
(post content unavailable)
```

instead of saving incorrect data.

---

## Future Improvements

* Full historical post scrolling
* Incremental crawling
* Scheduled crawling
* Better post caption extraction
* Media extraction
* Improved reply threading
* Multi-page crawling

---

## Project Status

Current status: MVP / Proof of Concept

Implemented:

* Facebook page crawling
* Post URL extraction
* Post ID extraction
* Comment extraction
* Reply expansion
* SQLite persistence
* JSON export
* Session persistence

In progress:

* More reliable post content extraction
* Full-history crawling
* Advanced reply mapping
* Incremental updates
