document.addEventListener("DOMContentLoaded", async function () {
  document.getElementById("addButton").addEventListener("click", addWebsite);
  document
    .getElementById("websiteInput")
    .addEventListener("change", checkInputValue);
  await loadBlockedSites();
});

async function addWebsite() {
  const websiteInput = document.getElementById("websiteInput").value;
  if (!websiteInput) {
    alert("Please Input Valid URL Or Hostname!");
    return;
  }
  let hostname;
  if (validateDomain(websiteInput)) {
    hostname = websiteInput;
  } else {
    hostname = new URL(websiteInput).hostname;
  }
  await chrome.runtime.sendMessage({
    action: "saveSite",
    hostname: hostname,
  });
  await loadBlockedSites();
}

async function loadBlockedSites() {
  const response = await chrome.runtime.sendMessage({
    action: "getBlockedSites",
  });
  const blockedSitesList = document.getElementById("blockedSitesList");
  blockedSitesList.innerHTML = "";
  if (response?.blockedSites?.length > 0) {
    const table = document.createElement("table");
    response.blockedSites.forEach(function (hostname, index) {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      const td2 = document.createElement("td");
      const td3 = document.createElement("td");
      const span = document.createElement("span");
      span.className = "domain-container";
      span.textContent = hostname;
      td1.style.width = "0.1em";
      td1.innerHTML = index + 1 + ".";
      td2.style.textAlign = "left";
      td2.style.width = "20em";
      td2.appendChild(span);
      const deleteButton = document.createElement("button");
      deleteButton.textContent = "Delete";
      deleteButton.className = "delete";
      td3.style.textAlign = "right";
      td3.appendChild(deleteButton);
      deleteButton.addEventListener("click", async function () {
        if (confirm("Can You Confirm To Delete It?")) {
          await deleteBlockedSite(hostname);
        }
      });
      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      table.appendChild(tr);
    });
    blockedSitesList.appendChild(table);
  } else {
    const span = document.createElement("span");
    span.textContent = "No sites blocked.";
    span.style.marginLeft = "1.5em";
    blockedSitesList.appendChild(span);
  }
}

async function deleteBlockedSite(hostname) {
  await chrome.runtime.sendMessage({
    action: "deleteBlockedSite",
    hostname: hostname,
  });
  await loadBlockedSites();
}

function checkInputValue(e) {
  const url = e.target.value;
  if (url && !validateDomain(url) && !validateURL(url)) {
    alert("Please Input Valid url Or Hostname!");
    return;
  }
}
function validateDomain(domain) {
  const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return domainRegex.test(domain);
}
function validateURL(url) {
  const urlRegex = /^(ftp|http|https):\/\/[^ "]+$/;
  return urlRegex.test(url);
}
