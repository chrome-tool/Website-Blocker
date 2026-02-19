let timer = null;

document.addEventListener("DOMContentLoaded", async () => {
  const toggleSwitch = document.getElementById("toggleSwitch");
  const startTimerButton = document.getElementById("startTimerButton");
  const openManagementButton = document.getElementById("openManagementButton");
  const timerInput = document.getElementById("timerMinutes");

  await refreshState();

  toggleSwitch.addEventListener("change", async (event) => {
    const enabled = event.target.checked;
    await chrome.runtime.sendMessage({
      action: "blockSite",
      isBlocked: enabled,
    });

    if (!enabled) {
      stopTimer();
      displayTimeLeft(0);
      setFeedback("Blocking disabled.", "info");
    } else {
      setFeedback("Blocking enabled.", "success");
    }

    await refreshState();
  });

  startTimerButton.addEventListener("click", startTimer);

  timerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      startTimer();
    }
  });

  openManagementButton.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ action: "openWebsiteManagement" });
  });
});

async function refreshState() {
  const { isBlocked = false, endtime = 0 } = await chrome.storage.sync.get([
    "isBlocked",
    "endtime",
  ]);
  const toggleSwitch = document.getElementById("toggleSwitch");

  toggleSwitch.checked = Boolean(isBlocked);
  updateStatusText(Boolean(isBlocked));

  if (Number(endtime) > Date.now()) {
    startCountdown(Number(endtime));
  } else {
    stopTimer();
    displayTimeLeft(0);
  }
}

async function startTimer() {
  const timerInput = document.getElementById("timerMinutes");
  const timerMinutes = Number(timerInput.value);

  if (!Number.isFinite(timerMinutes) || timerMinutes <= 0) {
    setFeedback("Please enter a valid number of minutes.", "error");
    return;
  }

  const response = await chrome.runtime.sendMessage({
    action: "startTimer",
    minutes: timerMinutes,
  });

  if (!response?.ok || !response.endtime) {
    setFeedback("Unable to start timer. Please try again.", "error");
    return;
  }

  document.getElementById("toggleSwitch").checked = true;
  updateStatusText(true);
  startCountdown(response.endtime);
  setFeedback(
    `Blocking enabled for ${Math.round(timerMinutes)} minute(s).`,
    "success",
  );
}

function startCountdown(endTime) {
  stopTimer();

  const tick = async () => {
    const secondsLeft = Math.round((endTime - Date.now()) / 1000);
    if (secondsLeft <= 0) {
      stopTimer();
      displayTimeLeft(0);
      updateStatusText(false);
      document.getElementById("toggleSwitch").checked = false;
      await chrome.storage.sync.set({ endtime: 0, isBlocked: false });
      setFeedback("Timer finished. Blocking disabled.", "info");
      return;
    }

    displayTimeLeft(secondsLeft);
  };

  tick();
  timer = setInterval(tick, 1000);
}

function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function displayTimeLeft(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  const display = `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
  document.getElementById("timer").textContent = display;
}

function pad(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function updateStatusText(isBlocked) {
  const statusText = document.getElementById("statusText");
  statusText.textContent = isBlocked ? "Active" : "Inactive";
  statusText.className = `status-text ${isBlocked ? "active" : "inactive"}`;
}

function setFeedback(message, type) {
  const feedback = document.getElementById("feedback");
  feedback.textContent = message;
  feedback.className = `feedback ${type}`;
}
