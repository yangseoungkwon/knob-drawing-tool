const safeLimitBoardEl = document.getElementById("safeLimitBoard");
const safeRecordBoardEl = document.getElementById("safeRecordBoard");
const safeStartBtn = document.getElementById("safeStartBtn");
const safeResetBtn = document.getElementById("safeResetBtn");
const safeStartOverlay = document.getElementById("safeStartOverlay");
const safeStartControlBtn = document.getElementById("safeStartControlBtn");
const safeResultOverlay = document.getElementById("safeResultOverlay");
const safeResultTitle = document.getElementById("safeResultTitle");
const safeResultText = document.getElementById("safeResultText");
const safeNextBtn = document.getElementById("safeNextBtn");
const safeReplayBtn = document.getElementById("safeReplayBtn");
const safeMessageEl = document.getElementById("safeMessage");

const safeDifficultyStateEl = document.getElementById("safeDifficultyState");
const safeStageStateEl = document.getElementById("safeStageState");
const safePinStateEl = document.getElementById("safePinState");
const safeDialAStateEl = document.getElementById("safeDialAState");
const safeDialBStateEl = document.getElementById("safeDialBState");
const safeBestRecordStateEl = document.getElementById("safeBestRecordState");

const dialAEl = document.getElementById("dialA");
const dialBEl = document.getElementById("dialB");
const pinTrackEl = document.getElementById("pinTrack");

const difficultyButtons = document.querySelectorAll(".difficulty-btn");

const DIFFICULTY_LABEL = {
  easy: "초급",
  normal: "중급",
  hard: "고급"
};

const DIFFICULTY_PRESETS = {
  easy:   { basePins: 3, baseTolerance: 4, sensitivity: 0.45 },
  normal: { basePins: 4, baseTolerance: 3, sensitivity: 0.55 },
  hard:   { basePins: 5, baseTolerance: 2, sensitivity: 0.7 }
};

const STAGE_LIMIT_SECONDS_BY_DIFFICULTY = {
  // Easy: mission completion focused, much more forgiving.
  easy: [80, 80, 110, 110, 140, 140, 170, 170, 200, 200],
  // Normal: tighter pacing.
  normal: [35, 35, 50, 50, 65, 65, 80, 80, 95, 95],
  // Hard: very tight.
  hard: [28, 28, 40, 40, 52, 52, 64, 64, 76, 76]
};
const TOTAL_STAGES = STAGE_LIMIT_SECONDS_BY_DIFFICULTY.easy.length;

const DIAL_MAX = 100;
const PENALTY_MS = 3000;
const RANKING_STORAGE_KEY = "dual-knob-safe-best-records-v1";

const safeState = {
  difficulty: "easy",
  stageIndex: 0,
  pins: [],
  currentPinIndex: 0,
  dialA: 0,
  dialB: 0,
  controlStarted: false,
  cleared: false,
  pendingNextStage: false,
  timeLeftMs: 0,
  totalElapsedMs: 0,
  stageElapsedMs: 0,
  timerId: null
};

const mouseMoveState = {
  active: false,
  lastX: 0,
  lastY: 0
};
const pointerState = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

// ─── Dial rendering ─────────────────────────────────────────────

function buildDialDecorations(svgEl) {
  const ticks = svgEl.querySelector(".dial-ticks");
  const numbers = svgEl.querySelector(".dial-numbers");
  if (!ticks || !numbers) return;
  ticks.innerHTML = "";
  numbers.innerHTML = "";

  const cx = 100;
  const cy = 100;
  const outer = 92;
  const minor = 84;
  const major = 78;

  for (let i = 0; i < DIAL_MAX; i += 1) {
    const isMajor = i % 10 === 0;
    const angleRad = (i / DIAL_MAX) * Math.PI * 2 - Math.PI / 2;
    const inner = isMajor ? major : minor;
    const x1 = cx + Math.cos(angleRad) * inner;
    const y1 = cy + Math.sin(angleRad) * inner;
    const x2 = cx + Math.cos(angleRad) * outer;
    const y2 = cy + Math.sin(angleRad) * outer;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    if (isMajor) {
      line.classList.add("major");
      const lx = cx + Math.cos(angleRad) * (major - 10);
      const ly = cy + Math.sin(angleRad) * (major - 10);
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", lx);
      text.setAttribute("y", ly);
      text.textContent = String(i).padStart(2, "0");
      numbers.appendChild(text);
    }
    ticks.appendChild(line);
  }
}

function dialValueToAngle(value) {
  return (value / DIAL_MAX) * 360;
}

function renderDial(svgEl, value, target, tolerance) {
  const pointerLine = svgEl.querySelector(".dial-pointer");
  const valueText = svgEl.querySelector(".dial-value");
  if (pointerLine) {
    const angleRad = (value / DIAL_MAX) * Math.PI * 2 - Math.PI / 2;
    const cx = 100;
    const cy = 100;
    const tipRadius = 82;
    const tipX = cx + Math.cos(angleRad) * tipRadius;
    const tipY = cy + Math.sin(angleRad) * tipRadius;
    pointerLine.setAttribute("x1", cx);
    pointerLine.setAttribute("y1", cy);
    pointerLine.setAttribute("x2", tipX);
    pointerLine.setAttribute("y2", tipY);
  }
  if (valueText) {
    valueText.textContent = String(Math.round(value)).padStart(2, "0");
  }

  svgEl.classList.remove("is-warm", "is-hot");
  if (target !== null && target !== undefined) {
    const distance = circularDistance(value, target);
    if (distance <= tolerance) {
      svgEl.classList.add("is-hot");
    } else if (distance <= tolerance * 3) {
      svgEl.classList.add("is-warm");
    }
  }
}

function circularDistance(a, b) {
  const diff = Math.abs(a - b) % DIAL_MAX;
  return Math.min(diff, DIAL_MAX - diff);
}

function clampDial(value) {
  let v = value % DIAL_MAX;
  if (v < 0) v += DIAL_MAX;
  return v;
}

// ─── Pin generation ─────────────────────────────────────────────

function getPinCountForStage(stageIndex) {
  const preset = DIFFICULTY_PRESETS[safeState.difficulty];
  const extra = Math.floor(stageIndex / 2);
  return Math.min(preset.basePins + extra, 8);
}

function getToleranceForStage(stageIndex) {
  const preset = DIFFICULTY_PRESETS[safeState.difficulty];
  const reduction = Math.floor(stageIndex / 3);
  return Math.max(preset.baseTolerance - reduction, 1);
}

function generatePins(stageIndex) {
  const count = getPinCountForStage(stageIndex);
  const tolerance = getToleranceForStage(stageIndex);
  const pins = [];
  for (let i = 0; i < count; i += 1) {
    pins.push({
      targetA: Math.floor(Math.random() * DIAL_MAX),
      targetB: Math.floor(Math.random() * DIAL_MAX),
      tolerance,
      solved: false
    });
  }
  return pins;
}

function renderPinTrack() {
  pinTrackEl.innerHTML = "";
  safeState.pins.forEach((pin, idx) => {
    const row = document.createElement("div");
    row.className = "pin-row";
    if (pin.solved) row.classList.add("is-solved");
    if (!pin.solved && idx === safeState.currentPinIndex) {
      row.classList.add("is-current");
    }

    const showTarget = pin.solved || idx === safeState.currentPinIndex;
    const aLabel = showTarget ? String(pin.targetA).padStart(2, "0") : "??";
    const bLabel = showTarget ? String(pin.targetB).padStart(2, "0") : "??";

    row.innerHTML = `
      <span class="pin-index">${String(idx + 1).padStart(2, "0")}</span>
      <span class="pin-targets">
        <span>A ${aLabel}</span>
        <span>B ${bLabel}</span>
      </span>
    `;
    pinTrackEl.appendChild(row);
  });
}

// ─── Timer / status ─────────────────────────────────────────────

function stopTimer() {
  if (safeState.timerId !== null) {
    clearInterval(safeState.timerId);
    safeState.timerId = null;
  }
}

function startTimer() {
  stopTimer();
  safeState.timerId = setInterval(() => {
    safeState.timeLeftMs -= 100;
    safeState.totalElapsedMs += 100;
    safeState.stageElapsedMs += 100;
    if (safeState.timeLeftMs <= 0) {
      safeState.timeLeftMs = 0;
      updateStatus();
      onStageFailed();
      return;
    }
    updateStatus();
  }, 100);
}

function formatTimeSec(ms) {
  const sec = Math.max(ms, 0) / 1000;
  const min = Math.floor(sec / 60);
  const remain = (sec % 60).toFixed(1).padStart(4, "0");
  return `${String(min).padStart(2, "0")}:${remain}`;
}

function loadBestRecords() {
  try {
    const raw = localStorage.getItem(RANKING_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch (_error) {
    return {};
  }
}

function getBestRecordMs(difficulty) {
  const records = loadBestRecords();
  const value = records[difficulty];
  return Number.isFinite(value) ? value : null;
}

function saveBestRecordIfNeeded(difficulty, elapsedMs) {
  const records = loadBestRecords();
  const current = records[difficulty];
  const isNewRecord = !Number.isFinite(current) || elapsedMs < current;
  if (isNewRecord) {
    records[difficulty] = elapsedMs;
    localStorage.setItem(RANKING_STORAGE_KEY, JSON.stringify(records));
  }
  return isNewRecord;
}

function getCurrentPin() {
  return safeState.pins[safeState.currentPinIndex] || null;
}

function updateStatus() {
  const pin = getCurrentPin();
  const tolerance = pin ? pin.tolerance : 0;
  renderDial(dialAEl, safeState.dialA, pin ? pin.targetA : null, tolerance);
  renderDial(dialBEl, safeState.dialB, pin ? pin.targetB : null, tolerance);

  const limitText = formatTimeSec(safeState.timeLeftMs);
  safeLimitBoardEl.textContent = limitText;
  safeRecordBoardEl.textContent = formatTimeSec(safeState.totalElapsedMs);

  safeDifficultyStateEl.textContent = `Difficulty: ${DIFFICULTY_LABEL[safeState.difficulty]}`;
  safeStageStateEl.textContent = `${safeState.stageIndex + 1}단계 / ${TOTAL_STAGES}단계`;

  const totalPins = safeState.pins.length;
  const solvedCount = safeState.pins.filter((p) => p.solved).length;
  safePinStateEl.textContent = `Pins: ${solvedCount}/${totalPins}`;
  safeDialAStateEl.textContent = `Dial A: ${String(Math.round(safeState.dialA)).padStart(2, "0")}`;
  safeDialBStateEl.textContent = `Dial B: ${String(Math.round(safeState.dialB)).padStart(2, "0")}`;

  const best = getBestRecordMs(safeState.difficulty);
  safeBestRecordStateEl.textContent = `Best(${DIFFICULTY_LABEL[safeState.difficulty]}): ${
    best === null ? "-" : formatTimeSec(best)
  }`;
}

function placeResultDialogNearPointer() {
  const dialog = safeResultOverlay.querySelector(".dialog");
  if (!dialog || safeResultOverlay.classList.contains("hidden")) return;
  const margin = 12;
  const rect = dialog.getBoundingClientRect();
  const x = Math.min(
    Math.max(pointerState.x - rect.width / 2, margin),
    window.innerWidth - rect.width - margin
  );
  const y = Math.min(
    Math.max(pointerState.y - rect.height / 2, margin),
    window.innerHeight - rect.height - margin
  );
  dialog.style.position = "fixed";
  dialog.style.left = `${x}px`;
  dialog.style.top = `${y}px`;
  dialog.style.margin = "0";
}

// ─── Stage flow ─────────────────────────────────────────────────

function setupStage(stageIndex) {
  safeState.stageIndex = stageIndex;
  safeState.pins = generatePins(stageIndex);
  safeState.currentPinIndex = 0;
  safeState.dialA = 0;
  safeState.dialB = 0;
  safeState.controlStarted = true;
  safeState.cleared = false;
  safeState.pendingNextStage = false;
  safeState.stageElapsedMs = 0;
  const stageLimits = STAGE_LIMIT_SECONDS_BY_DIFFICULTY[safeState.difficulty];
  safeState.timeLeftMs = stageLimits[Math.min(stageIndex, stageLimits.length - 1)] * 1000;

  mouseMoveState.active = false;

  safeStartOverlay.classList.add("hidden");
  safeResultOverlay.classList.add("hidden");
  safeNextBtn.classList.add("hidden");

  safeMessageEl.textContent = `${stageIndex + 1}단계 / ${TOTAL_STAGES}단계: 핀 ${safeState.pins.length}개를 풀어 금고를 여세요!`;
  renderPinTrack();
  updateStatus();
  startTimer();
}

function startArcadeWithDifficulty() {
  safeState.totalElapsedMs = 0;
  safeState.stageElapsedMs = 0;
  setupStage(0);
}

function moveNextStage() {
  const next = safeState.stageIndex + 1;
  if (next >= TOTAL_STAGES) {
    finishAllStages();
    return;
  }
  setupStage(next);
}

function finishAllStages() {
  stopTimer();
  safeState.controlStarted = false;
  safeState.pendingNextStage = false;
  safeNextBtn.classList.add("hidden");
  const isNewRecord = saveBestRecordIfNeeded(safeState.difficulty, safeState.totalElapsedMs);
  safeResultTitle.textContent = `${TOTAL_STAGES}판 ALL CLEAR`;
  safeResultText.textContent = `총 클리어 시간: ${formatTimeSec(safeState.totalElapsedMs)}${
    isNewRecord ? " (신기록!)" : ""
  }`;
  safeResultOverlay.classList.remove("hidden");
  requestAnimationFrame(placeResultDialogNearPointer);
  safeMessageEl.textContent = `${TOTAL_STAGES}판 클리어 완료! 총 기록 ${formatTimeSec(safeState.totalElapsedMs)}`;
  updateStatus();
}

function onStageClear() {
  safeState.cleared = true;
  stopTimer();
  safeState.pendingNextStage = true;
  safeState.controlStarted = false;
  const stageElapsed = safeState.stageElapsedMs;
  safeResultTitle.textContent = `${safeState.stageIndex + 1}단계 CLEAR`;
  safeResultText.textContent = `스테이지 기록: ${formatTimeSec(stageElapsed)} / 누적 기록: ${formatTimeSec(
    safeState.totalElapsedMs
  )}`;
  safeNextBtn.classList.remove("hidden");
  safeResultOverlay.classList.remove("hidden");
  requestAnimationFrame(placeResultDialogNearPointer);
  safeMessageEl.textContent = `금고 해제! 스테이지 기록 ${formatTimeSec(stageElapsed)}`;
  updateStatus();
}

function onStageFailed() {
  stopTimer();
  safeState.controlStarted = false;
  safeState.pendingNextStage = false;
  safeNextBtn.classList.add("hidden");
  safeResultTitle.textContent = "TIME OVER";
  safeResultText.textContent = `${safeState.stageIndex + 1}단계 실패! 현재 누적 기록: ${formatTimeSec(
    safeState.totalElapsedMs
  )}`;
  safeResultOverlay.classList.remove("hidden");
  requestAnimationFrame(placeResultDialogNearPointer);
  safeMessageEl.textContent = "시간 초과! 다시 도전하세요.";
  updateStatus();
}

function openStartOverlay() {
  stopTimer();
  safeState.controlStarted = false;
  safeState.cleared = false;
  safeState.pendingNextStage = false;
  safeStartOverlay.classList.remove("hidden");
  safeResultOverlay.classList.add("hidden");
  safeNextBtn.classList.add("hidden");
  safeMessageEl.textContent = "난이도를 선택하고 시작 버튼을 누르세요.";
  safeState.pins = [];
  renderPinTrack();
  updateStatus();
}

// ─── Knob input pipeline ────────────────────────────────────────

function consumeMouseMoveDelta(dx, dy) {
  if (!safeState.controlStarted || safeState.cleared) return;
  const sensitivity = DIFFICULTY_PRESETS[safeState.difficulty].sensitivity;
  // Right knob (X) -> Dial B, Left knob (Y) -> Dial A
  // Invert Dial A direction to match expected clockwise behavior on-screen.
  if (dx !== 0) {
    safeState.dialB = clampDial(safeState.dialB + dx * sensitivity);
  }
  if (dy !== 0) {
    safeState.dialA = clampDial(safeState.dialA - dy * sensitivity);
  }
  updateStatus();
}

function attemptUnlock() {
  if (!safeState.controlStarted || safeState.cleared) return;
  const pin = getCurrentPin();
  if (!pin || pin.solved) return;

  const distA = circularDistance(safeState.dialA, pin.targetA);
  const distB = circularDistance(safeState.dialB, pin.targetB);
  if (distA <= pin.tolerance && distB <= pin.tolerance) {
    pin.solved = true;
    safeState.currentPinIndex += 1;
    safeMessageEl.textContent = `핀 해제! (${
      safeState.pins.filter((p) => p.solved).length
    }/${safeState.pins.length})`;
    if (safeState.pins.every((p) => p.solved)) {
      onStageClear();
    } else {
      renderPinTrack();
      updateStatus();
    }
  } else {
    safeState.timeLeftMs = Math.max(safeState.timeLeftMs - PENALTY_MS, 0);
    safeMessageEl.textContent = `실패! 시간 -${PENALTY_MS / 1000}초 (정답까지 A:${distA.toFixed(
      0
    )} / B:${distB.toFixed(0)})`;
    if (safeState.timeLeftMs === 0) {
      onStageFailed();
    } else {
      updateStatus();
    }
  }
}

// ─── Event wiring ───────────────────────────────────────────────

window.addEventListener("contextmenu", (event) => {
  if (safeState.controlStarted) event.preventDefault();
});

window.addEventListener("mousemove", (event) => {
  pointerState.x = event.clientX;
  pointerState.y = event.clientY;
  if (!safeState.controlStarted) return;
  if (!mouseMoveState.active) {
    mouseMoveState.active = true;
    mouseMoveState.lastX = event.clientX;
    mouseMoveState.lastY = event.clientY;
    return;
  }
  const dx = event.clientX - mouseMoveState.lastX;
  const dy = event.clientY - mouseMoveState.lastY;
  mouseMoveState.lastX = event.clientX;
  mouseMoveState.lastY = event.clientY;
  consumeMouseMoveDelta(dx, dy);
});

window.addEventListener("mousedown", (event) => {
  if (!safeState.controlStarted) return;
  if (event.buttons === 3 || event.button === 1) {
    event.preventDefault();
    return;
  }
  if (event.button === 0 || event.button === 2) {
    event.preventDefault();
    attemptUnlock();
  }
});

difficultyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    difficultyButtons.forEach((target) => target.classList.remove("active"));
    button.classList.add("active");
    safeState.difficulty = button.dataset.difficulty;
    updateStatus();
  });
});

safeStartControlBtn.addEventListener("click", () => {
  startArcadeWithDifficulty();
});

safeStartBtn.addEventListener("click", () => {
  openStartOverlay();
});

safeReplayBtn.addEventListener("click", () => {
  openStartOverlay();
});

safeNextBtn.addEventListener("click", () => {
  if (!safeState.pendingNextStage) return;
  safeResultOverlay.classList.add("hidden");
  moveNextStage();
});

safeResetBtn.addEventListener("click", () => {
  stopTimer();
  setupStage(safeState.stageIndex);
});

// ─── Boot ───────────────────────────────────────────────────────

buildDialDecorations(dialAEl);
buildDialDecorations(dialBEl);
difficultyButtons[0].classList.add("active");
openStartOverlay();
