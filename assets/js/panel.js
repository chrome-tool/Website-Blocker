let countdownHandle = null;
let liveRefreshHandle = null;

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  bindEvents();
  await refreshPanel();
  startLiveRefresh();
});

function bindElements() {
  els.toggleSwitch = document.getElementById("toggleSwitch");
  els.statusText = document.getElementById("statusText");
  els.timerHours = document.getElementById("timerHours");
  els.timerMinutes = document.getElementById("timerMinutes");
  els.startTimerButton = document.getElementById("startTimerButton");
  els.timerDisplay = document.getElementById("timerDisplay");
  els.websiteInput = document.getElementById("websiteInput");
  els.addButton = document.getElementById("addButton");
  els.blockedSitesList = document.getElementById("blockedSitesList");
  els.feedback = document.getElementById("feedback");

  els.metricBlockToday = document.getElementById("metricBlockToday");
  els.metricBlockTotal = document.getElementById("metricBlockTotal");
  els.metricBrowseToday = document.getElementById("metricBrowseToday");
  els.metricBrowseTotal = document.getElementById("metricBrowseTotal");
  els.metricEventsToday = document.getElementById("metricEventsToday");
  els.metricEventsTotal = document.getElementById("metricEventsTotal");
  els.metricSessions = document.getElementById("metricSessions");
  els.metricSites = document.getElementById("metricSites");

  els.browsingTotal = document.getElementById("browsingTotal");
  els.browsingChart = document.getElementById("browsingChart");
  els.blockedTotal = document.getElementById("blockedTotal");
  els.blockedChart = document.getElementById("blockedChart");
}

function bindEvents() {
  els.toggleSwitch.addEventListener("change", onToggleBlocking);
  els.startTimerButton.addEventListener("click", onStartTimer);
  els.addButton.addEventListener("click", onAddSites);

  els.timerHours.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      onStartTimer();
    }
  });

  els.timerMinutes.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      onStartTimer();
    }
  });

  els.websiteInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      onAddSites();
    }
  });
}

async function onToggleBlocking(event) {
  const isBlocked = event.target.checked;
  await chrome.runtime.sendMessage({ action: "blockSite", isBlocked });
  setFeedback(isBlocked ? "Blocking enabled." : "Blocking disabled.");
  await refreshPanel();
}

async function onStartTimer() {
  const hours = Math.max(0, Number(els.timerHours.value) || 0);
  const minutes = Math.max(0, Number(els.timerMinutes.value) || 0);
  const totalMinutes = hours * 60 + minutes;

  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    setFeedback("Please enter a valid time (hours/minutes).");
    return;
  }

  const response = await chrome.runtime.sendMessage({
    action: "startTimer",
    minutes: totalMinutes,
  });
  if (!response?.ok) {
    setFeedback("Unable to start timer.");
    return;
  }

  setFeedback(`Timer started for ${hours}h ${minutes}m.`);
  await refreshPanel();
}

async function onAddSites() {
  const raw = els.websiteInput.value.trim();
  if (!raw) {
    setFeedback("Please enter at least one domain.");
    return;
  }

  const hostnames = raw
    .split(/[\s,]+/)
    .map((item) => extractHostname(item))
    .filter(Boolean);

  if (hostnames.length === 0) {
    setFeedback("No valid domain found.");
    return;
  }

  let added = 0;
  for (const hostname of hostnames) {
    const response = await chrome.runtime.sendMessage({
      action: "saveSite",
      hostname,
    });
    if (response?.ok) {
      added += 1;
    }
  }

  els.websiteInput.value = "";
  setFeedback(
    added > 0 ? `Added ${added} website(s).` : "All domains already exist.",
  );
  await refreshPanel();
}

async function refreshPanel() {
  const response = await chrome.runtime.sendMessage({
    action: "getDashboardData",
  });
  if (!response?.ok) {
    return;
  }

  renderStatus(response.isBlocked);
  renderCountdown(response.endtime);
  renderSites(response.blockedSites || []);
  renderMetrics(
    response.blocking || {},
    response.browsing || {},
    response.blockEvents || {},
    response.blockedSites || [],
  );
  renderBrowsingChart(response.browsing || {});
  renderBlockedChart(response.blockEvents || {});
}

function renderStatus(isBlocked) {
  els.toggleSwitch.checked = Boolean(isBlocked);
  els.statusText.textContent = isBlocked ? "Active" : "Inactive";
  els.statusText.className = `status ${isBlocked ? "active" : "inactive"}`;
}

function renderCountdown(endtime) {
  const end = Number(endtime) || 0;
  clearCountdown();

  if (end <= Date.now()) {
    els.timerDisplay.textContent = "00:00:00";
    return;
  }

  const tick = async () => {
    const secondsLeft = Math.floor((end - Date.now()) / 1000);
    if (secondsLeft <= 0) {
      clearCountdown();
      els.timerDisplay.textContent = "00:00:00";
      await chrome.runtime.sendMessage({
        action: "blockSite",
        isBlocked: false,
      });
      await refreshPanel();
      return;
    }

    els.timerDisplay.textContent = formatDuration(secondsLeft);
  };

  tick();
  countdownHandle = setInterval(tick, 1000);
}

function clearCountdown() {
  if (countdownHandle) {
    clearInterval(countdownHandle);
    countdownHandle = null;
  }
}

function startLiveRefresh() {
  if (liveRefreshHandle) {
    clearInterval(liveRefreshHandle);
  }

  liveRefreshHandle = setInterval(() => {
    refreshPanel();
  }, 10000);
}

function renderSites(sites) {
  els.blockedSitesList.innerHTML = "";

  if (!sites.length) {
    els.blockedSitesList.innerHTML =
      '<p class="empty">No blocked websites yet.</p>';
    return;
  }

  sites.forEach((site, index) => {
    const row = document.createElement("div");
    row.className = "site-row";

    const idx = document.createElement("span");
    idx.className = "site-index";
    idx.textContent = `${index + 1}.`;

    const domain = document.createElement("span");
    domain.className = "site-domain";
    domain.textContent = site;

    const btn = document.createElement("button");
    btn.className = "delete";
    btn.textContent = "Delete";
    btn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({
        action: "deleteBlockedSite",
        hostname: site,
      });
      setFeedback(`Removed ${site}.`);
      await refreshPanel();
    });

    row.appendChild(idx);
    row.appendChild(domain);
    row.appendChild(btn);
    els.blockedSitesList.appendChild(row);
  });
}

function renderMetrics(blocking, browsing, blockEvents, blockedSites) {
  els.metricBlockToday.textContent = `${(Number(blocking.todayBlockHours) || 0).toFixed(1)}h`;
  els.metricBlockTotal.textContent = `${(Number(blocking.totalBlockHours) || 0).toFixed(1)}h`;
  els.metricBrowseToday.textContent = `${(Number(browsing.todayHours) || 0).toFixed(1)}h`;
  els.metricBrowseTotal.textContent = `${(Number(browsing.totalHours) || 0).toFixed(1)}h`;
  els.metricEventsToday.textContent = String(
    Number(blockEvents.todayEvents) || 0,
  );
  els.metricEventsTotal.textContent = String(
    Number(blockEvents.totalEvents) || 0,
  );
  els.metricSessions.textContent = String(Number(blocking.sessionCount) || 0);
  els.metricSites.textContent = String(blockedSites.length || 0);
}

function renderBrowsingChart(browsing) {
  const totalMinutes = Math.round((Number(browsing.totalMs) || 0) / 60000);
  els.browsingTotal.textContent = `${totalMinutes} min total`;
  els.browsingChart.innerHTML = "";

  const topSites = Array.isArray(browsing.topSites) ? browsing.topSites : [];
  if (!topSites.length) {
    els.browsingChart.innerHTML =
      '<p class="empty">No browsing time data yet.</p>';
    return;
  }

  const maxMs = Math.max(...topSites.map((item) => Number(item.ms) || 0), 1);

  topSites.forEach((item) => {
    const row = buildChartRow(
      item.site,
      Number(item.ms) || 0,
      maxMs,
      `${item.minutes}m`,
    );
    els.browsingChart.appendChild(row);
  });
}

function renderBlockedChart(blockEvents) {
  const totalBlocks = Number(blockEvents.totalEvents) || 0;
  els.blockedTotal.textContent = `${totalBlocks} blocks total`;
  els.blockedChart.innerHTML = "";

  const topBlockedSites = Array.isArray(blockEvents.topBlockedSites)
    ? blockEvents.topBlockedSites
    : [];
  if (!topBlockedSites.length) {
    els.blockedChart.innerHTML = '<p class="empty">No block events yet.</p>';
    return;
  }

  const maxCount = Math.max(
    ...topBlockedSites.map((item) => Number(item.count) || 0),
    1,
  );

  topBlockedSites.forEach((item) => {
    const row = buildChartRow(
      item.site,
      Number(item.count) || 0,
      maxCount,
      `${item.count}x`,
    );
    els.blockedChart.appendChild(row);
  });
}

function buildChartRow(label, value, maxValue, valueText) {
  const row = document.createElement("div");
  row.className = "chart-row";

  const site = document.createElement("span");
  site.className = "chart-site";
  site.title = label;
  site.textContent = label;

  const track = document.createElement("div");
  track.className = "chart-track";

  const fill = document.createElement("div");
  fill.className = "chart-fill";
  const widthPct = Math.max(5, Math.round((value / maxValue) * 100));
  fill.style.width = `${widthPct}%`;

  track.appendChild(fill);

  const valueEl = document.createElement("span");
  valueEl.className = "chart-value";
  valueEl.textContent = valueText;

  row.appendChild(site);
  row.appendChild(track);
  row.appendChild(valueEl);

  return row;
}

function extractHostname(value) {
  let input = String(value || "")
    .trim()
    .toLowerCase();
  if (!input) {
    return "";
  }

  if (!/^https?:\/\//.test(input)) {
    input = `https://${input}`;
  }

  try {
    const hostname = new URL(input).hostname.replace(/^www\./, "");
    const domainRegex =
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
    return domainRegex.test(hostname) ? hostname : "";
  } catch {
    return "";
  }
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

function pad(value) {
  return value < 10 ? `0${value}` : String(value);
}

function setFeedback(message) {
  els.feedback.textContent = message;
}
