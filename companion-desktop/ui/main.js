// Mission Mate desktop — window UI. All sidecar orchestration lives in Rust
// (src-tauri/src/lib.rs); this just calls commands and renders streamed output.
// Uses the global Tauri API (withGlobalTauri), so no bundler is needed.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const lampEl = document.getElementById("lamp");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const tokenEl = document.getElementById("token");
const connectBtn = document.getElementById("connect");
const stopBtn = document.getElementById("stop");
const logFileEl = document.getElementById("logfile");
const pathEl = document.getElementById("logpath-value");
const pathTagEl = document.getElementById("logpath-tag");
const pathHintEl = document.getElementById("logpath-hint");
const chooseLogBtn = document.getElementById("choose-log");
const clearLogBtn = document.getElementById("clear-log");

function setStatus(state, text) {
  lampEl.dataset.state = state;
  statusEl.textContent = text;
  const running = state === "watching" || state === "connecting";
  connectBtn.disabled = running;
  stopBtn.disabled = !running;
}

function appendLog(line) {
  if (!line) return;
  const atBottom =
    logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 24;
  logEl.textContent += line + "\n";
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}

// --- Game.log row -----------------------------------------------------------

function renderLogStatus(status) {
  const { resolvedLogPath, savedLogPath, configPath } = status || {};
  clearLogBtn.hidden = !savedLogPath;

  if (resolvedLogPath) {
    logFileEl.dataset.alert = "0";
    pathTagEl.textContent = savedLogPath ? "Chosen by you" : "Found automatically";
    pathTagEl.dataset.state = "found";
    pathEl.textContent = resolvedLogPath;
    pathHintEl.textContent = savedLogPath
      ? "Moved the game, or switched to PTU? Choose the new file."
      : "Found in the usual install folder. Nothing to do.";
    return;
  }

  logFileEl.dataset.alert = "1";
  pathTagEl.textContent = "Not found";
  pathTagEl.dataset.state = "missing";
  pathEl.textContent = savedLogPath
    ? `Saved path no longer exists: ${savedLogPath}`
    : "Not in any of the usual Star Citizen install folders.";
  pathHintEl.textContent =
    "Click Choose Game.log… and pick the file. It sits in your Star Citizen " +
    "folder, inside the build you play (LIVE, or PTU). Mission Mate remembers " +
    "it from then on" +
    (configPath ? `, in ${configPath}.` : ".");
}

async function refreshLogStatus() {
  try {
    renderLogStatus(await invoke("log_status"));
  } catch {
    /* leave whatever is on screen */
  }
}

chooseLogBtn.addEventListener("click", async () => {
  chooseLogBtn.disabled = true;
  try {
    renderLogStatus(await invoke("choose_log_file"));
  } catch (err) {
    appendLog("Error: " + err);
  } finally {
    chooseLogBtn.disabled = false;
  }
});

clearLogBtn.addEventListener("click", async () => {
  try {
    renderLogStatus(await invoke("clear_log_file"));
  } catch (err) {
    appendLog("Error: " + err);
  }
});

listen("mm-log", (e) => {
  appendLog(e.payload);
  // The companion's own "can't find it" message is the moment the picker
  // matters most — pull the row's attention state back in sync with it.
  if (/Could not find your Star Citizen Game\.log|saved Game\.log path does not exist/i.test(e.payload || "")) {
    refreshLogStatus();
  }
});
listen("mm-status", (e) => setStatus(e.payload.state, e.payload.text));

connectBtn.addEventListener("click", async () => {
  const token = tokenEl.value.trim();
  if (!token) {
    appendLog("Paste your haulerHelperAuth value first.");
    return;
  }
  setStatus("connecting", "Connecting…");
  try {
    await invoke("connect", { token });
    tokenEl.value = ""; // don't leave the token sitting in the field
  } catch (err) {
    appendLog("Error: " + err);
    setStatus("error", "Error");
  }
});

stopBtn.addEventListener("click", () => invoke("stop"));

document.getElementById("open-site").addEventListener("click", (e) => {
  e.preventDefault();
  invoke("open_site");
});

refreshLogStatus();
