const mazeCanvas = document.getElementById("mazeCanvas");
const mazeCtx = mazeCanvas.getContext("2d");

const leftToggleStateEl = document.getElementById("leftToggleState");
const rightToggleStateEl = document.getElementById("rightToggleState");
const mazeLevelStateEl = document.getElementById("mazeLevelState");
const mazeDifficultyStateEl = document.getElementById("mazeDifficultyState");
const mazeStageStateEl = document.getElementById("mazeStageState");
const mazeTimerStateEl = document.getElementById("mazeTimerState");
const mazeLimitBoardEl = document.getElementById("mazeLimitBoard");
const mazeRecordBoardEl = document.getElementById("mazeRecordBoard");
const mazeScoreStateEl = document.getElementById("mazeScoreState");
const mazeBestRecordStateEl = document.getElementById("mazeBestRecordState");
const mazeMessageEl = document.getElementById("mazeMessage");
const mazeStartBtn = document.getElementById("mazeStartBtn");
const mazeStartOverlay = document.getElementById("mazeStartOverlay");
const mazeStartControlBtn = document.getElementById("mazeStartControlBtn");
const mazeResetBtn = document.getElementById("mazeResetBtn");
const difficultyButtons = document.querySelectorAll(".difficulty-btn");
const mazeResultOverlay = document.getElementById("mazeResultOverlay");
const mazeResultTitle = document.getElementById("mazeResultTitle");
const mazeResultText = document.getElementById("mazeResultText");
const mazeNextBtn = document.getElementById("mazeNextBtn");
const mazeReplayBtn = document.getElementById("mazeReplayBtn");

const LEVEL_PRESETS = {
  easy: [15, 15, 21, 21, 21, 31, 31, 31, 31, 31],
  normal: [31, 31, 31, 41, 41, 41, 41, 51, 51, 51],
  hard: [51, 51, 51, 51, 51, 51, 51, 51, 51, 51]
};

const DIFFICULTY_LABEL = {
  easy: "초급",
  normal: "중급",
  hard: "고급"
};

const DIFFICULTY_TIME_SCALE = {
  easy: 1.2,
  normal: 1.0,
  hard: 0.82
};
const STAGE_LIMIT_SECONDS = [30, 30, 50, 50, 70, 70, 90, 90, 100, 100];

const mazeState = {
  size: 15,
  grid: [],
  cellPx: 24,
  player: { x: 1, y: 1 },
  goal: { x: 13, y: 13 },
  leftEnabled: false,
  rightBoost: false,
  cleared: false,
  controlStarted: false,
  difficulty: "easy",
  stageIndex: 0,
  pendingNextStage: false,
  pendingStageElapsedMs: 0,
  totalElapsedMs: 0,
  stageElapsedMs: 0,
  timeLeftMs: 0,
  timerId: null
};

const mouseMoveState = {
  active: false,
  lastX: 0,
  lastY: 0,
  accX: 0,
  accY: 0
};

const MOUSE_MOVE_THRESHOLD = 18;
const RANKING_STORAGE_KEY = "dual-knob-maze-best-records-v1";

function createEmptyGrid(size) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateMaze(size) {
  const grid = createEmptyGrid(size);
  const stack = [{ x: 1, y: 1 }];
  grid[1][1] = 1;

  const dirs = [
    { x: 2, y: 0 },
    { x: -2, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: -2 }
  ];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const candidates = shuffle(dirs).filter((dir) => {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      return nx > 0 && ny > 0 && nx < size - 1 && ny < size - 1 && grid[ny][nx] === 0;
    });

    if (candidates.length === 0) {
      stack.pop();
      continue;
    }

    const next = candidates[0];
    const wallX = current.x + next.x / 2;
    const wallY = current.y + next.y / 2;
    const nextX = current.x + next.x;
    const nextY = current.y + next.y;

    grid[wallY][wallX] = 1;
    grid[nextY][nextX] = 1;
    stack.push({ x: nextX, y: nextY });
  }

  grid[size - 2][size - 2] = 1;
  return grid;
}

function stopTimer() {
  if (mazeState.timerId) {
    clearInterval(mazeState.timerId);
    mazeState.timerId = null;
  }
}

function formatTimeSec(ms) {
  const sec = Math.max(ms, 0) / 1000;
  const min = Math.floor(sec / 60);
  const remain = (sec % 60).toFixed(1).padStart(4, "0");
  return `${String(min).padStart(2, "0")}:${remain}`;
}

function computeStageTimeMs(size) {
  const route = LEVEL_PRESETS[mazeState.difficulty];
  const safeIndex = Math.min(mazeState.stageIndex, STAGE_LIMIT_SECONDS.length - 1, route.length - 1);
  return STAGE_LIMIT_SECONDS[safeIndex] * 1000;
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

function updateMazeStatus() {
  const totalStageCount = LEVEL_PRESETS[mazeState.difficulty].length;
  leftToggleStateEl.textContent = `Left: ${mazeState.leftEnabled ? "ON" : "OFF"}`;
  rightToggleStateEl.textContent = `Right: ${mazeState.rightBoost ? "ON" : "OFF"}`;
  mazeLevelStateEl.textContent = `Level: ${mazeState.size}x${mazeState.size}`;
  mazeDifficultyStateEl.textContent = `Difficulty: ${DIFFICULTY_LABEL[mazeState.difficulty]}`;
  mazeStageStateEl.textContent = `${mazeState.stageIndex + 1}단계 / ${totalStageCount}단계`;
  const timeText = formatTimeSec(mazeState.timeLeftMs);
  mazeTimerStateEl.textContent = `Time: ${timeText}`;
  mazeLimitBoardEl.textContent = timeText;
  mazeRecordBoardEl.textContent = formatTimeSec(mazeState.totalElapsedMs);
  mazeScoreStateEl.textContent = `Total Time: ${formatTimeSec(mazeState.totalElapsedMs)}`;
  const best = getBestRecordMs(mazeState.difficulty);
  mazeBestRecordStateEl.textContent = `Best(${DIFFICULTY_LABEL[mazeState.difficulty]}): ${
    best === null ? "-" : formatTimeSec(best)
  }`;
}

function drawMaze() {
  const { grid, size, cellPx, player, goal } = mazeState;
  mazeCtx.fillStyle = "#111827";
  mazeCtx.fillRect(0, 0, mazeCanvas.width, mazeCanvas.height);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (grid[y][x] === 1) {
        mazeCtx.fillStyle = "#f8fafc";
        mazeCtx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
      }
    }
  }

  mazeCtx.fillStyle = "#22c55e";
  mazeCtx.fillRect(goal.x * cellPx, goal.y * cellPx, cellPx, cellPx);

  mazeCtx.fillStyle = "#2563eb";
  mazeCtx.beginPath();
  mazeCtx.arc(
    player.x * cellPx + cellPx / 2,
    player.y * cellPx + cellPx / 2,
    Math.max(cellPx * 0.33, 4),
    0,
    Math.PI * 2
  );
  mazeCtx.fill();
}

function onStageFailed() {
  stopTimer();
  mazeState.controlStarted = false;
  mazeState.leftEnabled = false;
  mazeState.pendingNextStage = false;
  mazeNextBtn.classList.add("hidden");
  mazeResultTitle.textContent = "TIME OVER";
  mazeResultText.textContent = `${mazeState.stageIndex + 1}단계 실패! 현재 누적 기록: ${formatTimeSec(mazeState.totalElapsedMs)}`;
  mazeResultOverlay.classList.remove("hidden");
  mazeMessageEl.textContent = "시간 초과! 다시 도전하세요.";
  updateMazeStatus();
}

function startTimer() {
  stopTimer();
  mazeState.timerId = setInterval(() => {
    mazeState.timeLeftMs -= 100;
    mazeState.totalElapsedMs += 100;
    mazeState.stageElapsedMs += 100;
    if (mazeState.timeLeftMs <= 0) {
      mazeState.timeLeftMs = 0;
      updateMazeStatus();
      onStageFailed();
      return;
    }
    updateMazeStatus();
  }, 100);
}

function setupStage(size) {
  mazeState.size = size;
  mazeState.grid = generateMaze(size);
  mazeState.player = { x: 1, y: 1 };
  mazeState.goal = { x: size - 2, y: size - 2 };
  mazeState.leftEnabled = true;
  mazeState.rightBoost = false;
  mazeState.cleared = false;
  mazeState.controlStarted = true;
  mazeState.pendingNextStage = false;
  mazeState.pendingStageElapsedMs = 0;
  mazeState.stageElapsedMs = 0;
  mazeState.timeLeftMs = computeStageTimeMs(size);

  mazeState.cellPx = Math.max(Math.floor(720 / size), 12);
  mazeCanvas.width = mazeState.cellPx * size;
  mazeCanvas.height = mazeState.cellPx * size;

  mouseMoveState.active = false;
  mouseMoveState.accX = 0;
  mouseMoveState.accY = 0;

  mazeStartOverlay.classList.add("hidden");
  mazeResultOverlay.classList.add("hidden");
  mazeNextBtn.classList.add("hidden");
  const totalStageCount = LEVEL_PRESETS[mazeState.difficulty].length;
  mazeMessageEl.textContent = `${mazeState.stageIndex + 1}단계 / ${totalStageCount}단계: ${size}x${size} 제한시간 클리어!`;
  updateMazeStatus();
  drawMaze();
  startTimer();
}

function startArcadeWithDifficulty() {
  mazeState.totalElapsedMs = 0;
  mazeState.stageElapsedMs = 0;
  mazeState.stageIndex = 0;
  mazeState.controlStarted = false;
  mazeStartOverlay.classList.add("hidden");
  mazeResultOverlay.classList.add("hidden");
  mazeNextBtn.classList.add("hidden");
  const route = LEVEL_PRESETS[mazeState.difficulty];
  setupStage(route[0]);
  updateMazeStatus();
}

function finishAllStages() {
  stopTimer();
  mazeState.controlStarted = false;
  mazeState.leftEnabled = false;
  mazeState.pendingNextStage = false;
  mazeNextBtn.classList.add("hidden");
  const totalStageCount = LEVEL_PRESETS[mazeState.difficulty].length;
  const isNewRecord = saveBestRecordIfNeeded(mazeState.difficulty, mazeState.totalElapsedMs);
  mazeResultTitle.textContent = `${totalStageCount}판 ALL CLEAR`;
  mazeResultText.textContent = `총 클리어 시간: ${formatTimeSec(mazeState.totalElapsedMs)}${
    isNewRecord ? " (신기록!)" : ""
  }`;
  mazeResultOverlay.classList.remove("hidden");
  mazeMessageEl.textContent = `${totalStageCount}판 클리어 완료! 총 기록 ${formatTimeSec(mazeState.totalElapsedMs)}`;
  updateMazeStatus();
}

function moveNextStage() {
  const route = LEVEL_PRESETS[mazeState.difficulty];
  const nextIndex = mazeState.stageIndex + 1;
  if (nextIndex >= route.length) {
    finishAllStages();
    return;
  }
  mazeState.stageIndex = nextIndex;
  setupStage(route[nextIndex]);
}

function onStageClear() {
  mazeState.cleared = true;
  stopTimer();
  const stageElapsed = mazeState.stageElapsedMs;
  mazeState.pendingStageElapsedMs = stageElapsed;
  mazeState.pendingNextStage = true;
  mazeState.controlStarted = false;
  mazeState.leftEnabled = false;
  mazeResultTitle.textContent = `${mazeState.stageIndex + 1}단계 CLEAR`;
  mazeResultText.textContent = `스테이지 기록: ${formatTimeSec(stageElapsed)} / 누적 기록: ${formatTimeSec(
    mazeState.totalElapsedMs
  )}`;
  mazeNextBtn.classList.remove("hidden");
  mazeResultOverlay.classList.remove("hidden");
  mazeMessageEl.textContent = `클리어! 스테이지 기록 ${formatTimeSec(stageElapsed)}`;
  updateMazeStatus();
}

function attemptMove(dx, dy) {
  if (!mazeState.controlStarted || !mazeState.leftEnabled || mazeState.cleared) return;

  const stepCount = mazeState.rightBoost ? 2 : 1;
  for (let step = 0; step < stepCount; step += 1) {
    const nx = mazeState.player.x + dx;
    const ny = mazeState.player.y + dy;
    if (nx < 0 || ny < 0 || nx >= mazeState.size || ny >= mazeState.size) break;
    if (mazeState.grid[ny][nx] !== 1) break;
    mazeState.player = { x: nx, y: ny };
  }

  if (mazeState.player.x === mazeState.goal.x && mazeState.player.y === mazeState.goal.y) {
    onStageClear();
  }
  drawMaze();
}

function consumeMouseMoveDelta(dx, dy) {
  if (!mazeState.controlStarted || mazeState.cleared) return;

  mouseMoveState.accX += dx;
  mouseMoveState.accY += dy;

  while (
    Math.abs(mouseMoveState.accX) >= MOUSE_MOVE_THRESHOLD ||
    Math.abs(mouseMoveState.accY) >= MOUSE_MOVE_THRESHOLD
  ) {
    if (Math.abs(mouseMoveState.accX) >= Math.abs(mouseMoveState.accY)) {
      const dirX = mouseMoveState.accX > 0 ? 1 : -1;
      attemptMove(dirX, 0);
      mouseMoveState.accX -= dirX * MOUSE_MOVE_THRESHOLD;
    } else {
      const dirY = mouseMoveState.accY > 0 ? 1 : -1;
      attemptMove(0, dirY);
      mouseMoveState.accY -= dirY * MOUSE_MOVE_THRESHOLD;
    }
  }
}

function toggleRight() {
  if (!mazeState.controlStarted || mazeState.cleared) return;
  mazeState.rightBoost = !mazeState.rightBoost;
  updateMazeStatus();
}

function openStartOverlay() {
  stopTimer();
  mazeState.controlStarted = false;
  mazeState.leftEnabled = false;
  mazeState.rightBoost = false;
  mazeState.cleared = false;
  mazeState.pendingNextStage = false;
  mazeState.pendingStageElapsedMs = 0;
  mazeStartOverlay.classList.remove("hidden");
  mazeResultOverlay.classList.add("hidden");
  mazeNextBtn.classList.add("hidden");
  mazeMessageEl.textContent = "난이도를 선택하고 시작 버튼을 누르세요.";
  updateMazeStatus();
}

mazeCanvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

mazeCanvas.addEventListener("mousedown", (event) => {
  if (!mazeState.controlStarted) return;
  if (event.buttons === 3 || event.button === 1) {
    event.preventDefault();
    return;
  }
  if (event.button === 2) toggleRight();
});

window.addEventListener("mousemove", (event) => {
  if (!mazeState.controlStarted) return;
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

difficultyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    difficultyButtons.forEach((target) => target.classList.remove("active"));
    button.classList.add("active");
    mazeState.difficulty = button.dataset.difficulty;
    updateMazeStatus();
  });
});

mazeStartControlBtn.addEventListener("click", () => {
  startArcadeWithDifficulty();
});

mazeNextBtn.addEventListener("click", () => {
  if (!mazeState.pendingNextStage) return;
  mazeResultOverlay.classList.add("hidden");
  moveNextStage();
});

mazeStartBtn.addEventListener("click", () => {
  openStartOverlay();
});

mazeReplayBtn.addEventListener("click", () => {
  openStartOverlay();
});

mazeResetBtn.addEventListener("click", () => {
  stopTimer();
  const route = LEVEL_PRESETS[mazeState.difficulty];
  const currentSize = route[mazeState.stageIndex] || route[0];
  setupStage(currentSize);
});

difficultyButtons[0].classList.add("active");
openStartOverlay();
