const BLOCK_PAGE_PATH = "blocked.html";
const TIMER_ALARM = "website-blocker-timer";
const DASHBOARD_STATS_KEY = "dashboardStats";
const BROWSING_STATS_KEY = "browsingStats";
const BLOCK_EVENT_STATS_KEY = "blockEventStats";

const DEFAULT_STATS = {
  totalActiveMs: 0,
  activeDayKeys: [],
  sessionCount: 0,
  lastActivatedAt: 0,
  blockDailyMs: {},
};

const DEFAULT_BROWSING_STATS = {
  totalMs: 0,
  siteMs: {},
  dailyMs: {},
};

const DEFAULT_BLOCK_EVENT_STATS = {
  totalEvents: 0,
  siteEvents: {},
  dailyEvents: {},
};

let blockedSites = [];
let blockingEnabled = false;
let dashboardStats = { ...DEFAULT_STATS };
let browsingStats = { ...DEFAULT_BROWSING_STATS };
let blockEventStats = { ...DEFAULT_BLOCK_EVENT_STATS };
let browsingSession = null;

init();

async function init() {
  const syncData = await chrome.storage.sync.get(["blockedSites", "isBlocked", "endtime"]);
  const localData = await chrome.storage.local.get([
    DASHBOARD_STATS_KEY,
    BROWSING_STATS_KEY,
    BLOCK_EVENT_STATS_KEY,
  ]);

  blockedSites = normalizeBlockedList(syncData.blockedSites);
  blockingEnabled = Boolean(syncData.isBlocked);
  dashboardStats = normalizeStats(localData[DASHBOARD_STATS_KEY]);
  browsingStats = normalizeBrowsingStats(localData[BROWSING_STATS_KEY]);
  blockEventStats = normalizeBlockEventStats(localData[BLOCK_EVENT_STATS_KEY]);

  if (blockingEnabled && !dashboardStats.lastActivatedAt) {
    dashboardStats.lastActivatedAt = Date.now();
    addActiveDaysInRange(dashboardStats.lastActivatedAt, dashboardStats.lastActivatedAt);
    await persistStats();
  }

  await chrome.storage.sync.set({ blockedSites });
  await applyBlockingListener();
  await syncAlarmFromEndtime(syncData.endtime ?? 0);
  await configurePanelBehavior();
  await restoreBrowsingSession();
  bindBrowsingEvents();
}

function normalizeBlockedList(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return [...new Set(list.map((site) => normalizeHostname(site)).filter(Boolean))];
}

function normalizeHostname(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  let hostname = value.trim().toLowerCase();
  if (!hostname) {
    return "";
  }

  hostname = hostname.replace(/^https?:\/\//, "");
  hostname = hostname.replace(/^www\./, "");
  hostname = hostname.split("/")[0];

  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
  return domainRegex.test(hostname) ? hostname : "";
}

function getDayKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function splitDurationByDay(startMs, endMs, callback) {
  let cursor = startMs;

  while (cursor < endMs) {
    const start = new Date(cursor);
    const nextDay = new Date(start);
    nextDay.setHours(24, 0, 0, 0);

    const segmentEnd = Math.min(nextDay.getTime(), endMs);
    const duration = Math.max(0, segmentEnd - cursor);

    if (duration > 0) {
      callback(getDayKey(cursor), duration);
    }

    cursor = segmentEnd;
  }
}

function normalizeNumberMap(raw, keyNormalizer) {
  const map = {};

  if (!raw || typeof raw !== "object") {
    return map;
  }

  Object.entries(raw).forEach(([key, value]) => {
    const normalizedKey = keyNormalizer(key);
    const normalizedValue = Number(value) || 0;

    if (normalizedKey && normalizedValue > 0) {
      map[normalizedKey] = normalizedValue;
    }
  });

  return map;
}

function normalizeDayKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function normalizeStats(raw) {
  const next = {
    totalActiveMs: Number(raw?.totalActiveMs) || 0,
    activeDayKeys: Array.isArray(raw?.activeDayKeys) ? raw.activeDayKeys.filter(Boolean) : [],
    sessionCount: Number(raw?.sessionCount) || 0,
    lastActivatedAt: Number(raw?.lastActivatedAt) || 0,
    blockDailyMs: normalizeNumberMap(raw?.blockDailyMs, normalizeDayKey),
  };

  next.activeDayKeys = [...new Set(next.activeDayKeys)];
  return next;
}

function normalizeBrowsingStats(raw) {
  return {
    totalMs: Number(raw?.totalMs) || 0,
    siteMs: normalizeNumberMap(raw?.siteMs, normalizeHostname),
    dailyMs: normalizeNumberMap(raw?.dailyMs, normalizeDayKey),
  };
}

function normalizeBlockEventStats(raw) {
  return {
    totalEvents: Number(raw?.totalEvents) || 0,
    siteEvents: normalizeNumberMap(raw?.siteEvents, normalizeHostname),
    dailyEvents: normalizeNumberMap(raw?.dailyEvents, normalizeDayKey),
  };
}

async function persistStats() {
  await chrome.storage.local.set({ [DASHBOARD_STATS_KEY]: dashboardStats });
}

async function persistBrowsingStats() {
  await chrome.storage.local.set({ [BROWSING_STATS_KEY]: browsingStats });
}

async function persistBlockEventStats() {
  await chrome.storage.local.set({ [BLOCK_EVENT_STATS_KEY]: blockEventStats });
}

function addActiveDaysInRange(startMs, endMs, targetSet) {
  const set = targetSet || new Set(dashboardStats.activeDayKeys);
  const start = new Date(startMs);
  const end = new Date(endMs);

  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  while (start <= end) {
    set.add(getDayKey(start.getTime()));
    start.setDate(start.getDate() + 1);
  }

  if (!targetSet) {
    dashboardStats.activeDayKeys = [...set];
  }

  return set;
}

async function finalizeActiveSession(endMs = Date.now()) {
  const startMs = Number(dashboardStats.lastActivatedAt) || 0;
  if (!startMs) {
    return;
  }

  const elapsed = Math.max(0, endMs - startMs);
  dashboardStats.totalActiveMs += elapsed;
  dashboardStats.sessionCount += 1;
  addActiveDaysInRange(startMs, endMs);

  splitDurationByDay(startMs, endMs, (dayKey, duration) => {
    dashboardStats.blockDailyMs[dayKey] = (dashboardStats.blockDailyMs[dayKey] || 0) + duration;
  });

  dashboardStats.lastActivatedAt = 0;
  await persistStats();
}

function trackableHostnameFromUrl(urlValue) {
  if (!urlValue || typeof urlValue !== "string") {
    return "";
  }

  try {
    const parsed = new URL(urlValue);
    if (!/^https?:$/.test(parsed.protocol)) {
      return "";
    }
    return normalizeHostname(parsed.hostname);
  } catch {
    return "";
  }
}

async function closeBrowsingSession(endMs = Date.now()) {
  if (!browsingSession?.hostname) {
    browsingSession = null;
    return;
  }

  const elapsed = Math.max(0, endMs - browsingSession.startedAt);
  if (elapsed > 0) {
    browsingStats.totalMs += elapsed;
    browsingStats.siteMs[browsingSession.hostname] =
      (browsingStats.siteMs[browsingSession.hostname] || 0) + elapsed;

    splitDurationByDay(browsingSession.startedAt, endMs, (dayKey, duration) => {
      browsingStats.dailyMs[dayKey] = (browsingStats.dailyMs[dayKey] || 0) + duration;
    });

    await persistBrowsingStats();
  }

  browsingSession = null;
}

async function refreshBrowsingSession() {
  let activeTab;
  try {
    [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {
    await closeBrowsingSession();
    return;
  }

  const nextTabId = activeTab?.id;
  const nextHostname = trackableHostnameFromUrl(activeTab?.url);
  const isSameSession =
    browsingSession &&
    browsingSession.tabId === nextTabId &&
    browsingSession.hostname === nextHostname;

  if (isSameSession) {
    return;
  }

  await closeBrowsingSession();

  if (typeof nextTabId === "number" && nextHostname) {
    browsingSession = {
      tabId: nextTabId,
      hostname: nextHostname,
      startedAt: Date.now(),
    };
  }
}

async function restoreBrowsingSession() {
  await refreshBrowsingSession();
}

function bindBrowsingEvents() {
  chrome.tabs.onActivated.addListener(() => {
    refreshBrowsingSession();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.active && (typeof changeInfo.url === "string" || changeInfo.status === "complete")) {
      refreshBrowsingSession();
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (browsingSession?.tabId === tabId) {
      closeBrowsingSession();
    }
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      closeBrowsingSession();
      return;
    }

    refreshBrowsingSession();
  });
}

function buildBrowsingSnapshot() {
  const todayKey = getDayKey(Date.now());
  const siteMs = { ...browsingStats.siteMs };
  const dailyMs = { ...browsingStats.dailyMs };
  let totalMs = browsingStats.totalMs;

  if (browsingSession?.hostname) {
    const now = Date.now();
    const liveMs = Math.max(0, now - browsingSession.startedAt);

    totalMs += liveMs;
    siteMs[browsingSession.hostname] = (siteMs[browsingSession.hostname] || 0) + liveMs;

    splitDurationByDay(browsingSession.startedAt, now, (dayKey, duration) => {
      dailyMs[dayKey] = (dailyMs[dayKey] || 0) + duration;
    });
  }

  const topSites = Object.entries(siteMs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([site, ms]) => ({
      site,
      ms,
      minutes: Math.max(1, Math.round(ms / 60000)),
    }));

  return {
    totalMs,
    totalHours: Number((totalMs / (1000 * 60 * 60)).toFixed(1)),
    todayMs: dailyMs[todayKey] || 0,
    todayHours: Number(((dailyMs[todayKey] || 0) / (1000 * 60 * 60)).toFixed(1)),
    topSites,
  };
}

function buildBlockSnapshot() {
  const todayKey = getDayKey(Date.now());
  const dailyBlockMs = { ...dashboardStats.blockDailyMs };
  let totalBlockMs = dashboardStats.totalActiveMs;

  if (blockingEnabled && dashboardStats.lastActivatedAt) {
    const now = Date.now();
    const liveMs = Math.max(0, now - dashboardStats.lastActivatedAt);
    totalBlockMs += liveMs;

    splitDurationByDay(dashboardStats.lastActivatedAt, now, (dayKey, duration) => {
      dailyBlockMs[dayKey] = (dailyBlockMs[dayKey] || 0) + duration;
    });
  }

  const todayBlockMs = dailyBlockMs[todayKey] || 0;
  return {
    totalBlockMs,
    totalBlockHours: Number((totalBlockMs / (1000 * 60 * 60)).toFixed(1)),
    todayBlockMs,
    todayBlockHours: Number((todayBlockMs / (1000 * 60 * 60)).toFixed(1)),
    sessionCount: dashboardStats.sessionCount + (blockingEnabled ? 1 : 0),
  };
}

function buildBlockEventSnapshot() {
  const todayKey = getDayKey(Date.now());

  const topBlockedSites = Object.entries(blockEventStats.siteEvents)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([site, count]) => ({ site, count: Math.round(count) }));

  return {
    totalEvents: Math.round(blockEventStats.totalEvents || 0),
    todayEvents: Math.round(blockEventStats.dailyEvents[todayKey] || 0),
    topBlockedSites,
  };
}

async function recordBlockEvent(hostname) {
  const todayKey = getDayKey(Date.now());
  blockEventStats.totalEvents += 1;
  blockEventStats.siteEvents[hostname] = (blockEventStats.siteEvents[hostname] || 0) + 1;
  blockEventStats.dailyEvents[todayKey] = (blockEventStats.dailyEvents[todayKey] || 0) + 1;
  await persistBlockEventStats();
}

function isSiteBlocked(hostname) {
  return blockedSites.some(
    (blockedSite) => hostname === blockedSite || hostname.endsWith(`.${blockedSite}`)
  );
}

async function saveSite(hostname) {
  const normalized = normalizeHostname(hostname);
  if (!normalized || blockedSites.includes(normalized)) {
    return { ok: false };
  }

  blockedSites.push(normalized);
  blockedSites.sort();
  await chrome.storage.sync.set({ blockedSites });
  return { ok: true };
}

async function deleteBlockedSite(hostname) {
  const normalized = normalizeHostname(hostname);
  const nextList = blockedSites.filter((site) => site !== normalized);

  if (nextList.length === blockedSites.length) {
    return { ok: false };
  }

  blockedSites = nextList;
  await chrome.storage.sync.set({ blockedSites });
  return { ok: true };
}

async function setBlockingState(isBlocked) {
  const nextState = Boolean(isBlocked);

  if (nextState === blockingEnabled) {
    return blockingEnabled;
  }

  if (nextState) {
    const now = Date.now();
    dashboardStats.lastActivatedAt = now;
    addActiveDaysInRange(now, now);
    await persistStats();
    blockingEnabled = true;
  } else {
    await finalizeActiveSession(Date.now());
    blockingEnabled = false;
    await clearTimer();
  }

  await chrome.storage.sync.set({ isBlocked: blockingEnabled });
  await applyBlockingListener();
  return blockingEnabled;
}

async function applyBlockingListener() {
  const hasListener = chrome.webNavigation.onBeforeNavigate.hasListener(executeBlock);

  if (blockingEnabled && !hasListener) {
    chrome.webNavigation.onBeforeNavigate.addListener(executeBlock);
    return;
  }

  if (!blockingEnabled && hasListener) {
    chrome.webNavigation.onBeforeNavigate.removeListener(executeBlock);
  }
}

async function startTimer(minutes) {
  const totalMinutes = Number(minutes);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return { ok: false };
  }

  const endtime = Date.now() + Math.round(totalMinutes * 60 * 1000);
  await chrome.storage.sync.set({ endtime });
  await chrome.alarms.clear(TIMER_ALARM);
  await chrome.alarms.create(TIMER_ALARM, { when: endtime });
  await setBlockingState(true);
  return { ok: true, endtime };
}

async function clearTimer() {
  await chrome.alarms.clear(TIMER_ALARM);
  await chrome.storage.sync.set({ endtime: 0 });
}

async function syncAlarmFromEndtime(endtime) {
  const expiresAt = Number(endtime);
  await chrome.alarms.clear(TIMER_ALARM);

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    if (blockingEnabled) {
      await setBlockingState(false);
    } else {
      await chrome.storage.sync.set({ endtime: 0 });
    }
    return;
  }

  await chrome.alarms.create(TIMER_ALARM, { when: expiresAt });
}

async function configurePanelBehavior() {
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
}

function executeBlock(details) {
  if (!blockingEnabled || details.frameId !== 0) {
    return;
  }

  let url;
  try {
    url = new URL(details.url);
  } catch {
    return;
  }

  if (!/^https?:$/.test(url.protocol)) {
    return;
  }

  const blockedPageUrl = chrome.runtime.getURL(BLOCK_PAGE_PATH);
  if (details.url.startsWith(blockedPageUrl)) {
    return;
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || !isSiteBlocked(hostname)) {
    return;
  }

  recordBlockEvent(hostname);

  const redirectUrl = `${blockedPageUrl}?site=${encodeURIComponent(hostname)}&url=${encodeURIComponent(
    details.url
  )}`;

  chrome.tabs.update(details.tabId, { url: redirectUrl }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  configurePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  configurePanelBehavior();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === TIMER_ALARM) {
    await setBlockingState(false);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    switch (request.action) {
      case "saveSite":
        sendResponse(await saveSite(request.hostname));
        break;
      case "blockSite":
        sendResponse({ ok: true, isBlocked: await setBlockingState(request.isBlocked) });
        break;
      case "startTimer":
        sendResponse(await startTimer(request.minutes));
        break;
      case "getBlockedSites":
        sendResponse({ blockedSites });
        break;
      case "deleteBlockedSite":
        sendResponse(await deleteBlockedSite(request.hostname));
        break;
      case "getDashboardData": {
        const { endtime = 0 } = await chrome.storage.sync.get(["endtime"]);
        const expiresAt = Number(endtime) || 0;

        if (blockingEnabled && expiresAt > 0 && expiresAt <= Date.now()) {
          await setBlockingState(false);
        }

        const { endtime: syncedEndtime = 0 } = await chrome.storage.sync.get(["endtime"]);
        sendResponse({
          ok: true,
          isBlocked: blockingEnabled,
          endtime: syncedEndtime,
          blockedSites,
          browsing: buildBrowsingSnapshot(),
          blocking: buildBlockSnapshot(),
          blockEvents: buildBlockEventSnapshot(),
        });
        break;
      }
      default:
        sendResponse({ ok: false });
        break;
    }
  })();

  return true;
});
