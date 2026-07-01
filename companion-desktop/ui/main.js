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

listen("mm-log", (e) => appendLog(e.payload));
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
