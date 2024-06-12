let blockedSites = [];

chrome.storage.sync.get(["blockedSites"], async function (result) {
  if (result.blockedSites) {
    blockedSites = result.blockedSites;
    await updateBlockedSites();
  }
});

async function saveSite(hostname) {
  const isSiteBlocked = blockedSites.some((existingSite) => {
    return existingSite === hostname;
  });
  if (!isSiteBlocked) {
    blockedSites.push(hostname);
    await updateBlockedSites();
  }
}

async function blockSite(isBlocked) {
  await chrome.storage.sync.set({ isBlocked });
  await updateBlockedSites();
}

async function isBlocked() {
  return (await chrome.storage.sync.get("isBlocked")).isBlocked ?? false;
}

async function deleteBlockedSite(hostname) {
  const index = blockedSites.indexOf(hostname);
  if (index !== -1) {
    blockedSites.splice(index, 1);
    await updateBlockedSites();
  }
}

async function updateBlockedSites() {
  chrome.storage.sync.set({ blockedSites: blockedSites });
  const isblocked = await isBlocked();
  if (isblocked) {
    chrome.webNavigation.onBeforeNavigate.addListener(executeBlock);
  } else {
    chrome.webNavigation.onBeforeNavigate.removeListener(executeBlock);
  }
}


function executeBlock (details) {
  const url = new URL(details.url);
  const hostname = url.hostname;
  for (let blockSite of blockedSites) {
    if (hostname && blockSite.includes(hostname)) {
      chrome.tabs.update(details.tabId, { url: "blocked.html" });
    }
  }
}

let timeoutId;
function startTimer(minutes) {
  const intervalInMilliseconds = minutes * 60 * 1000;
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  timeoutId = setTimeout(async function () {
    await blockSite(false);
  }, intervalInMilliseconds);
}

// function unblockSites() {
//   blockedSites = [];
//   updateBlockedSites();
// }

chrome.runtime.onMessage.addListener(async function (
  request,
  sender,
  sendResponse
) {
  switch (request.action) {
    case "saveSite":
      await saveSite(request.hostname);
      break;
    case "blockSite":
      await blockSite(request.isBlocked);
      break;  
    case "startTimer":
      startTimer(request.minutes);
      break;
    case "getBlockedSites":
      sendResponse({ blockedSites });
      break;
    case "deleteBlockedSite":
      await deleteBlockedSite(request.hostname);
      break;
    case "openWebsiteManagement":
      chrome.tabs.create({
        url: chrome.runtime.getURL("website-management.html"),
      });
      break;
  }
  return true;
});
