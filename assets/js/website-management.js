document.addEventListener("DOMContentLoaded", async () => {
  const addButton = document.getElementById("addButton");
  const websiteInput = document.getElementById("websiteInput");

  addButton.addEventListener("click", addWebsite);
  websiteInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      await addWebsite();
    }
  });

  await loadBlockedSites();
});

async function addWebsite() {
  const websiteInput = document.getElementById("websiteInput");
  const raw = websiteInput.value.trim();

  if (!raw) {
    setFeedback("Please enter at least one domain.", "error");
    return;
  }

  const candidates = raw
    .split(/[\s,]+/)
    .map((item) => extractHostname(item))
    .filter(Boolean);

  if (candidates.length === 0) {
    setFeedback("No valid domain detected.", "error");
    return;
  }

  let addedCount = 0;
  for (const hostname of candidates) {
    const response = await chrome.runtime.sendMessage({
      action: "saveSite",
      hostname,
    });

    if (response?.ok) {
      addedCount += 1;
    }
  }

  websiteInput.value = "";
  await loadBlockedSites();

  if (addedCount === 0) {
    setFeedback("All websites were already in the blocked list.", "info");
    return;
  }

  setFeedback(`Added ${addedCount} website(s).`, "success");
}

async function loadBlockedSites() {
  const response = await chrome.runtime.sendMessage({ action: "getBlockedSites" });
  const blockedSites = response?.blockedSites ?? [];
  const blockedSitesList = document.getElementById("blockedSitesList");

  blockedSitesList.innerHTML = "";

  if (blockedSites.length === 0) {
    blockedSitesList.innerHTML = '<p class="empty">No sites blocked yet.</p>';
    return;
  }

  const table = document.createElement("table");

  blockedSites.forEach((hostname, index) => {
    const row = document.createElement("tr");

    const indexCell = document.createElement("td");
    indexCell.className = "index";
    indexCell.textContent = `${index + 1}.`;

    const domainCell = document.createElement("td");
    domainCell.className = "domain";
    domainCell.textContent = hostname;

    const actionCell = document.createElement("td");
    actionCell.className = "actions";

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "Delete";
    deleteButton.className = "delete";
    deleteButton.addEventListener("click", async () => {
      await deleteBlockedSite(hostname);
    });

    actionCell.appendChild(deleteButton);
    row.appendChild(indexCell);
    row.appendChild(domainCell);
    row.appendChild(actionCell);
    table.appendChild(row);
  });

  blockedSitesList.appendChild(table);
}

async function deleteBlockedSite(hostname) {
  const response = await chrome.runtime.sendMessage({
    action: "deleteBlockedSite",
    hostname,
  });

  if (response?.ok) {
    setFeedback(`Removed ${hostname}.`, "info");
  }

  await loadBlockedSites();
}

function extractHostname(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  let input = value.trim().toLowerCase();
  if (!input) {
    return "";
  }

  if (!/^https?:\/\//.test(input)) {
    input = `https://${input}`;
  }

  try {
    const hostname = new URL(input).hostname.replace(/^www\./, "");
    const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
    return domainRegex.test(hostname) ? hostname : "";
  } catch {
    return "";
  }
}

function setFeedback(message, type) {
  const feedback = document.getElementById("feedback");
  feedback.textContent = message;
  feedback.className = `feedback ${type}`;
}
