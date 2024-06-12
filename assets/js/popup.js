let timer;
document.addEventListener("DOMContentLoaded", async function () {
  const toggleSwitch = document.getElementById("toggleSwitch");
  const startTimerButton = document.getElementById("startTimerButton");
  const openManagementButton = document.getElementById("openManagementButton");
  toggleSwitch.checked = await isBlocked();
  toggleSwitch.addEventListener("change", async function (e) {
    if (!e.target.checked) {
      if (timer) clearInterval(timer);
      const timerDisplay = document.getElementById("timer");
      timerDisplay.innerText = "00:00:00";
      await setEndtime(0);
    }
    await chrome.runtime.sendMessage({
      action: "blockSite",
      isBlocked: e.target.checked,
    });
  });
  if (timer) clearInterval(timer);
  const endTime = await getEndtime();
  if (endTime > 0) {
    timer = setInterval(() => {
      const secondsLeft = Math.round((endTime - Date.now()) / 1000);
      if (secondsLeft < 0) {
        if (timer) clearInterval(timer);
        toggleSwitch.checked = false;
        return;
      }
      displayTimeLeft(secondsLeft);
    }, 1000);
  }
  startTimerButton.addEventListener("click", startTimer);
  openManagementButton.addEventListener("click", function () {
    chrome.runtime.sendMessage({ action: "openWebsiteManagement" });
  });
});

async function startTimer() {
  const timerMinutes = document.getElementById("timerMinutes").value;
  if (!timerMinutes || timerMinutes <= 0) {
    alert("Please Input Valid Minutes");
    return;
  }
  await chrome.runtime.sendMessage({
    action: "startTimer",
    minutes: parseInt(timerMinutes),
  });

  const toggleSwitch = document.getElementById("toggleSwitch");
  toggleSwitch.checked = true;
  await chrome.runtime.sendMessage({
    action: "blockSite",
    isBlocked: true,
  });

  if (timer) clearInterval(timer);
  const duration = parseInt(timerMinutes) * 60 * 1000;
  const endTime = Date.now() + duration;
  await setEndtime(endTime);
  displayTimeLeft(Math.round((endTime - Date.now()) / 1000));
  timer = setInterval(() => {
    const secondsLeft = Math.round((endTime - Date.now()) / 1000);
    if (secondsLeft < 0) {
      if (timer) clearInterval(timer);
      document.getElementById("toggleSwitch").checked = false;
      return;
    }
    displayTimeLeft(secondsLeft);
  }, 1000);
}

function displayTimeLeft(seconds) {
  let timerDisplay = document.getElementById("timer");
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const display = `${hours < 10 ? "0" : ""}${hours}:${
    minutes < 10 ? "0" : ""
  }${minutes}:${remainingSeconds < 10 ? "0" : ""}${remainingSeconds}`;
  timerDisplay.textContent = display;
}

function validateDomain(domain) {
  const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return domainRegex.test(domain);
}

function validateURL(url) {
  const urlRegex = /^(ftp|http|https):\/\/[^ "]+$/;
  return urlRegex.test(url);
}

async function isBlocked() {
  return (await chrome.storage.sync.get("isBlocked")).isBlocked ?? false;
}

async function getEndtime() {
  return (await chrome.storage.sync.get("endtime")).endtime ?? 0;
}

async function setEndtime(endtime) {
  await chrome.storage.sync.set({ endtime: endtime });
}
