const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const captureCanvas = document.getElementById("captureCanvas");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const startCameraBtn = document.getElementById("startCameraBtn");
const stopCameraBtn = document.getElementById("stopCameraBtn");
const markBtn = document.getElementById("markBtn");
const detectedNameEl = document.getElementById("detectedName");
const recognitionStatusEl = document.getElementById("recognitionStatus");
const toastEl = document.getElementById("toast");
const modelStatusEl = document.getElementById("modelStatus");
const recordsBody = document.getElementById("recordsBody");
const recordsCountEl = document.getElementById("recordsCount");
const recordsDateLabel = document.getElementById("recordsDateLabel");
const dateSelect = document.getElementById("dateSelect");
const refreshRecordsBtn = document.getElementById("refreshRecordsBtn");

const registerVideo = document.getElementById("registerVideo");
const registerOverlay = document.getElementById("registerOverlay");
const registerCameraPlaceholder = document.getElementById("registerCameraPlaceholder");
const registerStartCameraBtn = document.getElementById("registerStartCameraBtn");
const registerStopCameraBtn = document.getElementById("registerStopCameraBtn");
const registerNameInput = document.getElementById("registerName");
const registerProgressText = document.getElementById("registerProgressText");
const registerProgressFill = document.getElementById("registerProgressFill");
const registerStatusEl = document.getElementById("registerStatus");
const registerToastEl = document.getElementById("registerToast");
const beginRegisterBtn = document.getElementById("beginRegisterBtn");
const saveRegisterBtn = document.getElementById("saveRegisterBtn");
const cancelRegisterBtn = document.getElementById("cancelRegisterBtn");
const registeredPeopleList = document.getElementById("registeredPeopleList");

const MIN_SAMPLES = 20;
const TARGET_SAMPLES = 100;

let markStream = null;
let registerStream = null;
let recognizeInterval = null;
let registerInterval = null;
let currentName = null;
let modelReady = false;
let registerActive = false;
let registerCaptured = 0;
let activeTab = "mark";

function showToast(el, message, type = "info") {
  el.textContent = message;
  el.className = `toast ${type}`;
}

function hideToast(el) {
  el.className = "toast hidden";
}

function speak(text) {
  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data.detail || data.error || "Request failed";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return data;
}

function captureFrame(sourceVideo) {
  const width = sourceVideo.videoWidth;
  const height = sourceVideo.videoHeight;
  if (!width || !height) return null;

  captureCanvas.width = width;
  captureCanvas.height = height;
  const ctx = captureCanvas.getContext("2d");
  ctx.drawImage(sourceVideo, 0, 0, width, height);
  return captureCanvas.toDataURL("image/jpeg", 0.85);
}

function drawBox(canvas, box, label = "") {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!box) return;

  ctx.strokeStyle = "#22c55e";
  ctx.lineWidth = 3;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  if (label) {
    ctx.fillStyle = "#22c55e";
    ctx.font = "16px Segoe UI, sans-serif";
    ctx.fillText(label, box.x, Math.max(20, box.y - 8));
  }
}

function clearOverlay(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function updateRegisterProgress(captured) {
  registerCaptured = captured;
  registerProgressText.textContent = `${captured} / ${TARGET_SAMPLES}`;
  registerProgressFill.style.width = `${(captured / TARGET_SAMPLES) * 100}%`;
  saveRegisterBtn.disabled = captured < MIN_SAMPLES;
}

async function checkHealth() {
  try {
    const data = await api("/api/health");
    modelReady = data.model_loaded;
    modelStatusEl.classList.add(modelReady ? "ready" : "error");
    modelStatusEl.querySelector("span:last-child").textContent = modelReady
      ? `${data.registered_count} people registered`
      : "No faces registered yet";

    if (!data.registered_names.length) {
      registeredPeopleList.innerHTML = `<li class="empty">No one registered yet</li>`;
    } else {
      registeredPeopleList.innerHTML = data.registered_names
        .map((name) => `<li>${name}</li>`)
        .join("");
    }
  } catch {
    modelStatusEl.classList.add("error");
    modelStatusEl.querySelector("span:last-child").textContent = "Server unavailable";
    registeredPeopleList.innerHTML = `<li class="empty">Could not load list</li>`;
  }
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`${tab.dataset.tab}Panel`).classList.add("active");

      activeTab = tab.dataset.tab;
      stopMarkCamera();
      stopRegisterCamera();

      if (activeTab === "records") {
        loadRecords();
      }
      if (activeTab === "register") {
        checkHealth();
      }
    });
  });
}

async function startMarkCamera() {
  try {
    markStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    video.srcObject = markStream;
    cameraPlaceholder.classList.add("hidden");
    startCameraBtn.disabled = true;
    stopCameraBtn.disabled = false;
    markBtn.disabled = !modelReady;
    recognitionStatusEl.textContent = modelReady
      ? "Scanning for faces..."
      : "Register a face first to enable recognition";

    overlay.width = video.videoWidth || 640;
    overlay.height = video.videoHeight || 480;

    if (modelReady) {
      recognizeInterval = setInterval(recognizeFrame, 800);
    }
  } catch {
    showToast(toastEl, "Could not access camera. Check permissions.", "error");
    recognitionStatusEl.textContent = "Camera access denied";
  }
}

function stopMarkCamera() {
  if (recognizeInterval) {
    clearInterval(recognizeInterval);
    recognizeInterval = null;
  }
  if (markStream) {
    markStream.getTracks().forEach((track) => track.stop());
    markStream = null;
  }
  video.srcObject = null;
  cameraPlaceholder.classList.remove("hidden");
  startCameraBtn.disabled = false;
  stopCameraBtn.disabled = true;
  markBtn.disabled = true;
  currentName = null;
  detectedNameEl.textContent = "—";
  recognitionStatusEl.textContent = "Camera stopped";
  hideToast(toastEl);
  clearOverlay(overlay);
}

async function recognizeFrame() {
  if (!markStream || !modelReady) return;

  const image = captureFrame(video);
  if (!image) return;

  try {
    const data = await api("/api/recognize", {
      method: "POST",
      body: JSON.stringify({ image }),
    });

    if (!data.face_detected) {
      currentName = null;
      detectedNameEl.textContent = "—";
      recognitionStatusEl.textContent = "No face detected — look at the camera";
      clearOverlay(overlay);
      return;
    }

    currentName = data.name;
    detectedNameEl.textContent = data.name;
    drawBox(overlay, data.box, data.name);

    if (data.already_marked) {
      recognitionStatusEl.textContent = `${data.name} already marked today`;
      markBtn.disabled = true;
    } else {
      recognitionStatusEl.textContent = "Ready to mark attendance";
      markBtn.disabled = false;
    }
  } catch {
    recognitionStatusEl.textContent = "Recognition error — retrying...";
  }
}

async function markAttendance() {
  if (!currentName) {
    showToast(toastEl, "No person recognized yet", "error");
    return;
  }

  markBtn.disabled = true;
  try {
    const data = await api("/api/mark-attendance", {
      method: "POST",
      body: JSON.stringify({ name: currentName }),
    });
    showToast(toastEl, data.message, "success");
    speak(`Hello ${data.name}, your attendance has been marked at ${data.time}`);
    recognitionStatusEl.textContent = `${data.name} marked at ${data.time}`;
  } catch (err) {
    showToast(toastEl, err.message, "error");
    markBtn.disabled = false;
  }
}

async function startRegisterCamera() {
  try {
    registerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    registerVideo.srcObject = registerStream;
    registerCameraPlaceholder.classList.add("hidden");
    registerStartCameraBtn.disabled = true;
    registerStopCameraBtn.disabled = false;
    beginRegisterBtn.disabled = registerActive || !registerNameInput.value.trim();
    registerStatusEl.textContent = "Camera ready — enter a name and begin capture";

    registerOverlay.width = registerVideo.videoWidth || 640;
    registerOverlay.height = registerVideo.videoHeight || 480;
  } catch {
    showToast(registerToastEl, "Could not access camera. Check permissions.", "error");
    registerStatusEl.textContent = "Camera access denied";
  }
}

function stopRegisterCamera() {
  stopRegisterCapture();
  if (registerStream) {
    registerStream.getTracks().forEach((track) => track.stop());
    registerStream = null;
  }
  registerVideo.srcObject = null;
  registerCameraPlaceholder.classList.remove("hidden");
  registerStartCameraBtn.disabled = false;
  registerStopCameraBtn.disabled = true;
  beginRegisterBtn.disabled = !registerNameInput.value.trim();
  clearOverlay(registerOverlay);
}

function stopRegisterCapture() {
  if (registerInterval) {
    clearInterval(registerInterval);
    registerInterval = null;
  }
  registerActive = false;
  beginRegisterBtn.disabled = !registerStream || !registerNameInput.value.trim();
  cancelRegisterBtn.disabled = true;
}

async function beginRegisterCapture() {
  const name = registerNameInput.value.trim();
  if (!name) {
    showToast(registerToastEl, "Enter a name first", "error");
    return;
  }
  if (!registerStream) {
    showToast(registerToastEl, "Start the camera first", "error");
    return;
  }

  try {
    await api("/api/register/start", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    registerActive = true;
    updateRegisterProgress(0);
    beginRegisterBtn.disabled = true;
    saveRegisterBtn.disabled = true;
    cancelRegisterBtn.disabled = false;
    registerNameInput.disabled = true;
    registerStatusEl.textContent = `Capturing samples for ${name}...`;
    hideToast(registerToastEl);

    registerInterval = setInterval(captureRegisterSample, 300);
  } catch (err) {
    showToast(registerToastEl, err.message, "error");
  }
}

async function captureRegisterSample() {
  if (!registerActive || !registerStream) return;

  const name = registerNameInput.value.trim();
  const image = captureFrame(registerVideo);
  if (!image) return;

  try {
    const data = await api("/api/register/sample", {
      method: "POST",
      body: JSON.stringify({ name, image }),
    });

    updateRegisterProgress(data.captured);
    if (data.face_detected) {
      drawBox(registerOverlay, data.box, name);
      registerStatusEl.textContent = `Captured ${data.captured} of ${TARGET_SAMPLES} samples`;
    } else if (data.complete) {
      registerStatusEl.textContent = "Capture complete — click Save Person";
      stopRegisterCapture();
    } else {
      registerStatusEl.textContent = "Look at the camera to capture samples";
    }

    if (data.complete) {
      stopRegisterCapture();
      registerStatusEl.textContent = "Capture complete — click Save Person";
    }
  } catch (err) {
    registerStatusEl.textContent = err.message;
  }
}

async function finishRegister() {
  const name = registerNameInput.value.trim();
  try {
    const data = await api("/api/register/finish", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    showToast(registerToastEl, data.message, "success");
    registerStatusEl.textContent = `${name} saved successfully`;
    resetRegisterForm();
    await checkHealth();
    modelReady = true;
  } catch (err) {
    showToast(registerToastEl, err.message, "error");
  }
}

async function cancelRegister() {
  const name = registerNameInput.value.trim();
  stopRegisterCapture();
  if (name) {
    try {
      await api("/api/register/cancel", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    } catch {
      // ignore cancel errors
    }
  }
  resetRegisterForm();
  registerStatusEl.textContent = "Registration cancelled";
}

function resetRegisterForm() {
  stopRegisterCapture();
  updateRegisterProgress(0);
  registerNameInput.disabled = false;
  beginRegisterBtn.disabled = !registerStream || !registerNameInput.value.trim();
  saveRegisterBtn.disabled = true;
  cancelRegisterBtn.disabled = true;
  clearOverlay(registerOverlay);
}

async function loadDates() {
  try {
    const data = await api("/api/dates");
    dateSelect.innerHTML = "";
    const today = new Date().toISOString().slice(0, 10);
    const dates = data.dates.length ? data.dates : [today];

    dates.forEach((date) => {
      const option = document.createElement("option");
      option.value = date;
      option.textContent = date;
      dateSelect.appendChild(option);
    });

    if (!data.dates.includes(today)) {
      const option = document.createElement("option");
      option.value = today;
      option.textContent = today;
      dateSelect.prepend(option);
    }
    dateSelect.value = dates[0] || today;
  } catch {
    const today = new Date().toISOString().slice(0, 10);
    dateSelect.innerHTML = `<option value="${today}">${today}</option>`;
  }
}

async function loadRecords() {
  const date = dateSelect.value;
  recordsDateLabel.textContent = `Showing records for ${date}`;
  recordsBody.innerHTML = `<tr><td colspan="3" class="empty">Loading...</td></tr>`;

  try {
    const data = await api(`/api/attendance?date=${encodeURIComponent(date)}`);
    if (!data.records.length) {
      recordsBody.innerHTML = `<tr><td colspan="3" class="empty">No attendance recorded for this date</td></tr>`;
    } else {
      recordsBody.innerHTML = data.records
        .map(
          (row, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${row.Name}</td>
              <td>${row.Time}</td>
            </tr>`
        )
        .join("");
    }
    recordsCountEl.textContent = `${data.count} record(s)`;
  } catch {
    recordsBody.innerHTML = `<tr><td colspan="3" class="empty">Failed to load records</td></tr>`;
    recordsCountEl.textContent = "";
  }
}

startCameraBtn.addEventListener("click", startMarkCamera);
stopCameraBtn.addEventListener("click", stopMarkCamera);
markBtn.addEventListener("click", markAttendance);
refreshRecordsBtn.addEventListener("click", loadRecords);
dateSelect.addEventListener("change", loadRecords);

registerStartCameraBtn.addEventListener("click", startRegisterCamera);
registerStopCameraBtn.addEventListener("click", stopRegisterCamera);
beginRegisterBtn.addEventListener("click", beginRegisterCapture);
saveRegisterBtn.addEventListener("click", finishRegister);
cancelRegisterBtn.addEventListener("click", cancelRegister);
registerNameInput.addEventListener("input", () => {
  if (!registerActive) {
    beginRegisterBtn.disabled = !registerStream || !registerNameInput.value.trim();
  }
});

setupTabs();
checkHealth();
loadDates();
