const params = new URLSearchParams(window.location.search);
const site = params.get("site");
const fullUrl = params.get("url");

if (site) {
  document.getElementById("blockedDomain").textContent = site;
}

if (fullUrl) {
  document.getElementById("blockedUrl").textContent = fullUrl;
}
