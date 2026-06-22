const state = {
  bots: [],
  profiles: [],
  results: [],
  notifications: [],
  selectedResultId: null
};

const els = {
  botCount: document.querySelector("#botCount"),
  profileCount: document.querySelector("#profileCount"),
  resultCount: document.querySelector("#resultCount"),
  botList: document.querySelector("#botList"),
  profileList: document.querySelector("#profileList"),
  resultList: document.querySelector("#resultList"),
  resultDetail: document.querySelector("#resultDetail"),
  runStatus: document.querySelector("#runStatus"),
  botForm: document.querySelector("#botForm"),
  socialIntakeForm: document.querySelector("#socialIntakeForm"),
  researchMonitorForm: document.querySelector("#researchMonitorForm"),
  notificationList: document.querySelector("#notificationList"),
  refreshButton: document.querySelector("#refreshButton"),
  deleteAllResultsButton: document.querySelector("#deleteAllResultsButton"),
  resetFormButton: document.querySelector("#resetFormButton")
};

function formValue(id) {
  return document.querySelector(`#${id}`).value.trim();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function truncateText(value, max = 280) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

function kv(label, value) {
  return `
    <div class="kv">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatValue(value))}</strong>
    </div>
  `;
}

function parseJsonArray(value) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderAnalysisCard(analysis) {
  if (!analysis) {
    return '<article class="detailCard"><h3>Analysis</h3><p class="muted">No analysis saved.</p></article>';
  }

  return `
    <article class="detailCard">
      <h3>Social Lens Analysis</h3>
      <div class="analysisText">
        <p><strong>Summary:</strong> ${escapeHtml(analysis.summary)}</p>
        <p><strong>Key message:</strong> ${escapeHtml(analysis.keyMessage)}</p>
        <p><strong>Target audience:</strong> ${escapeHtml(analysis.targetAudience)}</p>
        <p><strong>Content structure:</strong> ${escapeHtml(analysis.contentStructure)}</p>
        <p><strong>Viewer reaction:</strong> ${escapeHtml(analysis.viewerReaction)}</p>
        <p><strong>Competitor insight:</strong> ${escapeHtml(analysis.competitorInsight)}</p>
      </div>
      <div class="kvGrid" style="margin-top:10px">
        ${kv("Value score", analysis.valueScore)}
        ${kv("Viral score", analysis.viralScore)}
      </div>
    </article>
  `;
}

function renderSnapshotCard(detail) {
  if (detail.socialSnapshot) {
    const s = detail.socialSnapshot;
    const posts = detail.socialPosts?.length ? detail.socialPosts : parseJsonArray(s.postsJson);
    const comments = parseJsonArray(s.commentsJson);
    return `
      <article class="detailCard">
        <h3>Social Metrics</h3>
        <div class="kvGrid">
          ${kv("Platform", s.platform)}
          ${kv("Post count", s.postCount)}
          ${kv("Comment samples", comments.length)}
          ${kv("Views", s.views)}
          ${kv("Likes", s.likes)}
          ${kv("Comments", s.comments)}
          ${kv("Shares", s.shares)}
          ${kv("Saves", s.saves)}
          ${kv("Downloads", s.downloads)}
          ${kv("Engagement rate", s.engagementRate ? `${s.engagementRate}%` : null)}
          ${kv("Unavailable reason", s.unavailableReason)}
        </div>
      </article>
      <article class="detailCard">
        <h3>Extracted Posts</h3>
        ${
          posts.length
            ? posts
                .map(
                  (post) => `
                    <div class="postBlock">
                      <div class="itemMeta">
                        <span>Post #${escapeHtml(post.index || post.id || "")}</span>
                        ${post.postUrl || post.permalink ? `<a href="${escapeHtml(post.postUrl || post.permalink)}" target="_blank" rel="noreferrer">Open</a>` : ""}
                        ${post.reactionCount || post.likeCount ? `<span>Reactions: ${escapeHtml(post.reactionCount || post.likeCount)}</span>` : ""}
                        ${post.commentCount ? `<span>Comments: ${escapeHtml(post.commentCount)}</span>` : ""}
                        ${post.shareCount ? `<span>Shares: ${escapeHtml(post.shareCount)}</span>` : ""}
                      </div>
                      <p>${escapeHtml(truncateText(post.content || post.text, 1200))}</p>
                      ${
                        Array.isArray(post.comments) && post.comments.length
                          ? `<div class="commentList">
                              <strong>Visible comments</strong>
                              ${post.comments
                                .map(
                                  (comment) => `
                                    <div class="commentBlock">
                                      <span>${escapeHtml(comment.authorName || comment.author || "Comment")}</span>
                                      <p>${escapeHtml(truncateText(comment.content || comment.text, 350))}</p>
                                    </div>
                                  `
                                )
                                .join("")}
                            </div>`
                          : '<p class="muted">No visible comments captured for this post.</p>'
                      }
                    </div>
                  `
                )
                .join("")
            : '<p class="muted">No post content extracted. Make sure the Facebook profile is logged in and the page feed is visible.</p>'
        }
      </article>
    `;
  }

  if (detail.productSnapshot) {
    const p = detail.productSnapshot;
    return `
      <article class="detailCard">
        <h3>Product Snapshot</h3>
        <div class="kvGrid">
          ${kv("Product", p.productName)}
          ${kv("Price", p.price)}
          ${kv("Currency", p.currency)}
          ${kv("Availability", p.availability)}
          ${kv("Price changed", p.priceChanged ? "yes" : "no")}
          ${kv("Previous price", p.previousPrice)}
        </div>
      </article>
    `;
  }

  if (detail.articleSnapshot) {
    const a = detail.articleSnapshot;
    return `
      <article class="detailCard">
        <h3>Article Snapshot</h3>
        <div class="kvGrid">
          ${kv("Title", a.title)}
          ${kv("Publish date", a.publishDate)}
          ${kv("Author", a.author)}
        </div>
        <p style="margin-top:10px">${escapeHtml(truncateText(a.content, 700))}</p>
      </article>
    `;
  }

  return '<article class="detailCard"><h3>Snapshot</h3><p class="muted">No typed snapshot saved.</p></article>';
}

function renderResultDetail(detail) {
  const result = detail.result;
  return `
    <div class="detailGrid">
      <article class="detailCard">
        <h3>${escapeHtml(result.title || result.url)}</h3>
        <div class="kvGrid">
          ${kv("Status", result.status)}
          ${kv("Type", result.type)}
          ${kv("Bot", `#${result.botId}`)}
          ${kv("Render engine", result.renderEngine)}
          ${kv("HTTP status", result.httpStatus)}
          ${kv("Block reason", result.blockReason)}
          ${kv("Created", result.createdAt)}
          ${kv("Screenshot", result.screenshotPath)}
        </div>
      </article>
      ${renderSnapshotCard(detail)}
      ${renderAnalysisCard(detail.analysisResult)}
      <article class="detailCard">
        <h3>Source</h3>
        <p><a href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">${escapeHtml(result.url)}</a></p>
        <details style="margin-top:10px">
          <summary>Rendered text preview</summary>
          <div class="rawBlock">${escapeHtml(truncateText(result.rawText, 4000))}</div>
        </details>
        <details style="margin-top:10px">
          <summary>Raw HTML preview</summary>
          <div class="rawBlock">${escapeHtml(truncateText(result.rawHtml, 4000))}</div>
        </details>
      </article>
    </div>
  `;
}

function renderJobDetail(detail) {
  return `
    <div class="detailGrid">
      <article class="detailCard">
        <h3>Job #${escapeHtml(detail.job.id)}</h3>
        <div class="kvGrid">
          ${kv("Bot", `#${detail.job.botId}`)}
          ${kv("Status", detail.job.status)}
          ${kv("Attempt", `${detail.job.attempt}/${detail.job.maxAttempts}`)}
          ${kv("Result", detail.job.crawlResultId)}
          ${kv("Block reason", detail.job.blockReason)}
          ${kv("Error", detail.job.errorMessage)}
        </div>
      </article>
      <article class="detailCard">
        <h3>Logs</h3>
        <div class="list">
          ${detail.logs
            .map(
              (log) => `
                <div class="item">
                  <strong>${escapeHtml(log.stage)}</strong>
                  <span class="badge ${escapeHtml(log.status)}">${escapeHtml(log.status)}</span>
                  <div class="itemMeta">
                    <span>${escapeHtml(log.message || "")}</span>
                    <span>${escapeHtml(log.createdAt)}</span>
                  </div>
                </div>
              `
            )
            .join("")}
        </div>
      </article>
      <details>
        <summary>Raw job JSON</summary>
        <div class="rawBlock">${escapeHtml(JSON.stringify(detail, null, 2))}</div>
      </details>
    </div>
  `;
}

function renderMetrics() {
  els.botCount.textContent = state.bots.length;
  els.profileCount.textContent = state.profiles.length;
  els.resultCount.textContent = state.results.length;
}

function renderBots() {
  if (!state.bots.length) {
    els.botList.innerHTML = '<p class="muted">No bots yet. Create one above.</p>';
    return;
  }

  els.botList.innerHTML = state.bots
    .map(
      (bot) => `
        <article class="item">
          <div class="itemActions">
            <div>
              <h3>${escapeHtml(bot.name)}</h3>
              <span class="badge ${escapeHtml(bot.status)}">${escapeHtml(bot.status)}</span>
              <span class="badge">${escapeHtml(bot.type)}</span>
            </div>
            <div class="itemActions">
              <button class="button" data-run="${bot.id}">Run</button>
              <button class="button secondary" data-warm="${bot.id}">Warm Login</button>
              <button class="button secondary" data-save-session="${bot.id}">Save Session</button>
              <button class="button secondary" data-edit="${bot.id}">Edit</button>
              <button class="button danger" data-delete="${bot.id}">Delete</button>
            </div>
          </div>
          <div class="itemMeta">
            <span>${escapeHtml(bot.targetDomain)}</span>
            <span>${escapeHtml(bot.targetUrl)}</span>
            <span>Profile: ${escapeHtml(bot.browserProfile)}</span>
            <span>Cron: ${escapeHtml(bot.scheduleCron || "manual")}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderProfiles() {
  if (!state.profiles.length) {
    els.profileList.innerHTML = '<p class="muted">No profile folders yet. Run a bot to create one.</p>';
    return;
  }

  els.profileList.innerHTML = state.profiles
    .map(
      (profile) => `
        <article class="item">
          <h3>${escapeHtml(profile.sourceName || profile.name)}</h3>
          <div class="itemMeta">
            <span>${escapeHtml(profile.targetDomain)}</span>
            <span>Bot #${escapeHtml(profile.ownerBotId)}</span>
            <span>${escapeHtml(profile.stealthMode)}</span>
            <span>Session: ${profile.sessionReady ? "ready" : "not warmed"}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderResults() {
  if (!state.results.length) {
    els.resultList.innerHTML = '<p class="muted">No crawl results yet.</p>';
    return;
  }

  els.resultList.innerHTML = state.results
    .map(
      (result) => `
        <article class="item">
          <div class="itemActions">
            <div>
              <h3>${escapeHtml(result.title || result.url)}</h3>
              <span class="badge ${escapeHtml(result.status)}">${escapeHtml(result.status)}</span>
              <span class="badge">${escapeHtml(result.type)}</span>
            </div>
            <div class="itemActions">
              <button class="button secondary" data-result="${result.id}">Inspect</button>
              <button class="button danger" data-delete-result="${result.id}">Delete</button>
            </div>
          </div>
          <div class="itemMeta">
            <span>Bot #${escapeHtml(result.botId)}</span>
            <span>${escapeHtml(result.createdAt)}</span>
            ${result.blockReason ? `<span>Block: ${escapeHtml(result.blockReason)}</span>` : ""}
            ${result.status === "blocked" ? `<span>Action: warm profile/login, then rerun</span>` : ""}
          </div>
        </article>
      `
    )
    .join("");
}

function renderNotifications() {
  if (!state.notifications.length) {
    els.notificationList.innerHTML = '<p class="muted">No notifications yet.</p>';
    return;
  }

  els.notificationList.innerHTML = state.notifications
    .map(
      (item) => `
        <article class="item">
          <h3>${escapeHtml(item.title)}</h3>
          <span class="badge ${escapeHtml(item.level)}">${escapeHtml(item.level)}</span>
          <div class="itemMeta">
            <span>${escapeHtml(item.message)}</span>
            <span>${escapeHtml(item.createdAt)}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function resetForm() {
  els.botForm.reset();
  document.querySelector("#botId").value = "";
  document.querySelector("#browserEngine").value = "auto";
  document.querySelector("#retryLimit").value = "2";
  document.querySelector("#cooldownSeconds").value = "60";
  document.querySelector("#status").value = "active";
}

async function refresh() {
  const [bots, profiles, results, notifications] = await Promise.all([
    api("/api/bots"),
    api("/api/browser-profiles"),
    api("/api/crawl-results"),
    api("/api/mentor/notifications")
  ]);

  state.bots = bots;
  state.profiles = profiles;
  state.results = results;
  state.notifications = notifications;

  renderMetrics();
  renderBots();
  renderProfiles();
  renderResults();
  renderNotifications();
}

async function saveBot(event) {
  event.preventDefault();
  const id = formValue("botId");
  const payload = {
    name: formValue("name"),
    type: formValue("type"),
    targetUrl: formValue("targetUrl"),
    browserProfile: formValue("browserProfile"),
    browserEngine: formValue("browserEngine"),
    proxyUrl: formValue("proxyUrl") || null,
    userAgent: formValue("userAgent") || null,
    retryLimit: Number(formValue("retryLimit") || 2),
    cooldownSeconds: Number(formValue("cooldownSeconds") || 60),
    scheduleCron: formValue("scheduleCron") || null,
    status: formValue("status")
  };

  if (id) {
    await api(`/api/bots/${id}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    await api("/api/bots", { method: "POST", body: JSON.stringify(payload) });
  }

  resetForm();
  await refresh();
}

function fillForm(bot) {
  document.querySelector("#botId").value = bot.id;
  document.querySelector("#name").value = bot.name;
  document.querySelector("#type").value = bot.type;
  document.querySelector("#targetUrl").value = bot.targetUrl;
  document.querySelector("#browserProfile").value = bot.browserProfile;
  document.querySelector("#browserEngine").value = bot.browserEngine || "auto";
  document.querySelector("#proxyUrl").value = bot.proxyUrl || "";
  document.querySelector("#userAgent").value = bot.userAgent || "";
  document.querySelector("#retryLimit").value = bot.retryLimit ?? 2;
  document.querySelector("#cooldownSeconds").value = bot.cooldownSeconds ?? 60;
  document.querySelector("#scheduleCron").value = bot.scheduleCron || "";
  document.querySelector("#status").value = bot.status;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function runBot(id) {
  els.runStatus.textContent = `Running bot #${id}...`;
  try {
    const response = await api(`/api/run-bot/${id}`, { method: "POST" });
    els.runStatus.textContent = `Run complete. Crawl result #${response.crawlResultId}`;
    if (response.crawlResultId) {
      await inspectResult(response.crawlResultId);
    }
  } catch (error) {
    els.runStatus.textContent = error.message;
  }
  await refresh();
}

async function warmProfile(id) {
  els.runStatus.textContent = `Opening warm-up browser for bot #${id}...`;
  const response = await api(`/api/browser-profiles/warm/${id}`, {
    method: "POST",
    body: JSON.stringify({ url: "https://www.facebook.com" })
  });
  els.runStatus.textContent =
    `Warm-up browser is open for bot #${id}. Login/verify in that window, then click Save Session.`;
  els.resultDetail.innerHTML = `<div class="detailCard"><h3>Profile Warm-up</h3><p>${escapeHtml(response.message)}</p><div class="rawBlock">${escapeHtml(JSON.stringify(response, null, 2))}</div></div>`;
  await refresh();
}

async function saveSession(id) {
  const response = await api(`/api/browser-profiles/warm/${id}/close`, { method: "POST" });
  els.runStatus.textContent = `Session saved for bot #${id}. Run the bot again.`;
  els.resultDetail.innerHTML = `<div class="detailCard"><h3>Session Saved</h3><div class="rawBlock">${escapeHtml(JSON.stringify(response, null, 2))}</div></div>`;
  await refresh();
}

async function inspectResult(id) {
  const detail = await api(`/api/crawl-results/${id}`);
  state.selectedResultId = id;
  els.resultDetail.innerHTML = renderResultDetail(detail);
}

async function deleteResult(id) {
  const result = state.results.find((item) => String(item.id) === String(id));
  const label = result?.title || result?.url || `result #${id}`;
  if (!window.confirm(`Delete crawl result "${label}"?`)) {
    return;
  }

  await api(`/api/crawl-results/${id}`, { method: "DELETE" });
  if (String(state.selectedResultId) === String(id)) {
    state.selectedResultId = null;
    els.resultDetail.innerHTML = "Select a result to inspect details.";
  }
  els.runStatus.textContent = `Deleted crawl result #${id}.`;
  await refresh();
}

async function deleteAllResults() {
  if (!state.results.length) {
    els.runStatus.textContent = "No crawl results to delete.";
    return;
  }

  const confirmed = window.confirm(`Delete all ${state.results.length} crawl result(s)? This cannot be undone.`);
  if (!confirmed) {
    return;
  }

  const response = await api("/api/crawl-results", { method: "DELETE" });
  state.selectedResultId = null;
  els.resultDetail.innerHTML = "Select a result to inspect details.";
  els.runStatus.textContent = `Deleted ${response.deletedCount} crawl result(s).`;
  await refresh();
}

async function importSocialLinks(event) {
  event.preventDefault();
  els.runStatus.textContent = "Importing social links...";
  const response = await api("/api/mentor/social-links", {
    method: "POST",
    body: JSON.stringify({
      competitorName: formValue("competitorName"),
      linksText: formValue("socialLinksText"),
      runNow: document.querySelector("#socialRunNow").checked
    })
  });
  els.runStatus.textContent = `Created ${response.created.length} social bot(s).`;
  document.querySelector("#socialLinksText").value = "";
  await refresh();
}

async function runResearchMonitor(event) {
  event.preventDefault();
  els.runStatus.textContent = "Running logistics monitor...";
  const response = await api("/api/mentor/research-monitor/run", {
    method: "POST",
    body: JSON.stringify({
      query: formValue("researchQuery"),
      limit: Number(formValue("researchLimit") || 5)
    })
  });
  els.runStatus.textContent = `Saved ${response.items.length} research result(s).`;
  await refresh();
}

els.botForm.addEventListener("submit", saveBot);
els.socialIntakeForm.addEventListener("submit", importSocialLinks);
els.researchMonitorForm.addEventListener("submit", runResearchMonitor);
els.refreshButton.addEventListener("click", refresh);
els.deleteAllResultsButton.addEventListener("click", deleteAllResults);
els.resetFormButton.addEventListener("click", resetForm);

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const runId = target.dataset.run;
  const editId = target.dataset.edit;
  const deleteId = target.dataset.delete;
  const deleteResultId = target.dataset.deleteResult;
  const resultId = target.dataset.result;
  const warmId = target.dataset.warm;
  const saveSessionId = target.dataset.saveSession;

  if (runId) {
    await runBot(runId);
  }

  if (editId) {
    const bot = state.bots.find((item) => String(item.id) === editId);
    if (bot) {
      fillForm(bot);
    }
  }

  if (warmId) {
    await warmProfile(warmId);
  }

  if (saveSessionId) {
    await saveSession(saveSessionId);
  }

  if (deleteId) {
    await api(`/api/bots/${deleteId}`, { method: "DELETE" });
    await refresh();
  }

  if (deleteResultId) {
    await deleteResult(deleteResultId);
  }

  if (resultId) {
    await inspectResult(resultId);
  }

});

refresh().catch((error) => {
  els.runStatus.textContent = error.message;
});
