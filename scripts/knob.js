const canvas = document.getElementById("drawCanvas");
const ctx = canvas.getContext("2d");
const cursorCanvas = document.getElementById("cursorCanvas");
const cursorCtx = cursorCanvas.getContext("2d");

const penStatusEl = document.getElementById("penStatus");
const toolStatusEl = document.getElementById("toolStatus");
const colorStatusEl = document.getElementById("colorStatus");
const sizeStatusEl = document.getElementById("sizeStatus");
const sensitivityStatusEl = document.getElementById("sensitivityStatus");
const palettePanelEl = document.getElementById("palettePanel");
const sizePickerEl = document.getElementById("sizePicker");
const sizeButtons = document.querySelectorAll("#sizePicker .size-btn[data-size]");
const resizeBtnEl = document.getElementById("resizeBtn");
const clearBtnEl = document.getElementById("clearBtn");
const sensDecBtnEl = document.getElementById("sensDecBtn");
const sensIncBtnEl = document.getElementById("sensIncBtn");
const modeIconEl = document.getElementById("modeIcon");
const miniPaletteEl = document.getElementById("miniPalette");
const activePaintBlobEl = document.getElementById("activePaintBlob");

const colors = [
  "#111111",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899"
];

const state = {
  colorIndex: 0,
  canvasSize: null,
  cellSize: 10,
  mode: "move",
  // 가상 커서: 셀 인덱스 (픽셀 단위 아님)
  vCellX: 0,
  vCellY: 0,
  // 마우스 델타 누산기
  accX: 0,
  accY: 0,
  // 감도: 이 px 만큼 누산되면 한 칸 이동 (노브 2px 기준 → 기본 1클릭/칸)
  moveThreshold: 2,
  pointerClient: { x: window.innerWidth / 2, y: window.innerHeight / 2 }
};

let lastMouseX = null;
let lastMouseY = null;

ctx.imageSmoothingEnabled = false;

// ── 그리드 그리기 ──────────────────────────────────────────
function drawGrid() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  for (let y = 0; y < canvas.height; y += state.cellSize) {
    for (let x = 0; x < canvas.width; x += state.cellSize) {
      ctx.strokeRect(x + 0.5, y + 0.5, state.cellSize, state.cellSize);
    }
  }
}

// ── 가상 커서 오버레이 그리기 ──────────────────────────────
function drawVCursor() {
  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

  const px = state.vCellX * state.cellSize;
  const py = state.vCellY * state.cellSize;
  const sz = state.cellSize;

  const baseColor =
    state.mode === "erase"
      ? "#ef4444"
      : state.mode === "paint"
        ? colors[state.colorIndex]
        : "#818cf8";

  cursorCtx.fillStyle = baseColor + "28";
  cursorCtx.fillRect(px + 1, py + 1, sz - 1, sz - 1);

  cursorCtx.strokeStyle = baseColor;
  cursorCtx.lineWidth = 2;
  cursorCtx.strokeRect(px + 0.5, py + 0.5, sz, sz);
}

// ── 가상 커서 위치에 페인팅 ────────────────────────────────
function paintAtVCell(button) {
  const fillColor = button === 2 ? "#ffffff" : colors[state.colorIndex];
  const px = state.vCellX * state.cellSize;
  const py = state.vCellY * state.cellSize;
  const paintSize = Math.max(state.cellSize - 1, 1);
  ctx.fillStyle = fillColor;
  ctx.fillRect(px + 1, py + 1, paintSize, paintSize);
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, state.cellSize, state.cellSize);
}

// ── 상태 표시 업데이트 ─────────────────────────────────────
function updateStatus() {
  penStatusEl.textContent = `Mode: ${state.mode.toUpperCase()}`;
  toolStatusEl.textContent = `Tool: ${getActiveToolLabel()}`;
  colorStatusEl.textContent = `Color: ${colors[state.colorIndex]}`;
  sizeStatusEl.textContent = `Canvas: ${state.canvasSize ? `${state.canvasSize}x${state.canvasSize}` : "-"}`;
  sensitivityStatusEl.textContent = `${state.moveThreshold}px/칸`;
  resizeBtnEl.textContent = state.canvasSize ? `${state.canvasSize}×${state.canvasSize}` : "크기 변경";
  modeIconEl.classList.remove("mode-pen", "mode-erase", "mode-move");
  modeIconEl.classList.add(
    state.mode === "paint" ? "mode-pen" : state.mode === "erase" ? "mode-erase" : "mode-move"
  );
  activePaintBlobEl.style.background = colors[state.colorIndex];
  drawVCursor();
}

function getActiveToolLabel() {
  if (state.mode === "erase") return "Eraser";
  if (state.mode === "paint") return "Pen";
  return "Move";
}

// ── 마우스 이벤트 (window 레벨 — OS 커서 위치 무관하게 동작) ─
window.addEventListener("mousemove", (event) => {
  if (!state.canvasSize) return;

  state.pointerClient = { x: event.clientX, y: event.clientY };

  if (lastMouseX === null) {
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    return;
  }

  const dx = event.clientX - lastMouseX;
  const dy = event.clientY - lastMouseY;
  lastMouseX = event.clientX;
  lastMouseY = event.clientY;

  state.accX += dx;
  state.accY += dy;

  // X축 누산 → 셀 이동
  while (Math.abs(state.accX) >= state.moveThreshold) {
    const dir = state.accX > 0 ? 1 : -1;
    const nx = state.vCellX + dir;
    if (nx >= 0 && nx < state.canvasSize) {
      state.vCellX = nx;
      if (state.mode === "paint") paintAtVCell(0);
      if (state.mode === "erase") paintAtVCell(2);
    }
    state.accX -= dir * state.moveThreshold;
  }

  // Y축 누산 → 셀 이동
  while (Math.abs(state.accY) >= state.moveThreshold) {
    const dir = state.accY > 0 ? 1 : -1;
    const ny = state.vCellY + dir;
    if (ny >= 0 && ny < state.canvasSize) {
      state.vCellY = ny;
      if (state.mode === "paint") paintAtVCell(0);
      if (state.mode === "erase") paintAtVCell(2);
    }
    state.accY -= dir * state.moveThreshold;
  }

  drawVCursor();
});

window.addEventListener("mousedown", (event) => {
  if (!state.canvasSize) return;

  if (event.buttons === 3 || event.button === 1) {
    event.preventDefault();
    togglePaletteAt(event.clientX, event.clientY);
    updateStatus();
    return;
  }

  if (event.button === 0) {
    // 툴바/사이드바 클릭은 무시
    if (event.target.closest(".toolbar, .artist-panel")) return;
    state.mode = state.mode === "paint" ? "move" : "paint";
    if (state.mode === "paint") paintAtVCell(0);
  } else if (event.button === 2) {
    if (event.target.closest(".toolbar, .artist-panel")) return;
    state.mode = state.mode === "erase" ? "move" : "erase";
  }

  drawVCursor();
  updateStatus();
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "p") {
    togglePaletteAt(state.pointerClient.x, state.pointerClient.y);
  }
  updateStatus();
});

// ── 팔레트: 커서 근처에 표시 ──────────────────────────────
function togglePaletteAt(clientX, clientY) {
  const isOpen = !palettePanelEl.classList.contains("hidden");
  if (isOpen) {
    palettePanelEl.classList.add("hidden");
    palettePanelEl.classList.remove("palette-anim");
    return;
  }

  palettePanelEl.style.visibility = "hidden";
  palettePanelEl.style.left = "0px";
  palettePanelEl.style.top = "0px";
  palettePanelEl.classList.remove("hidden");
  palettePanelEl.classList.remove("palette-anim");

  const pw = palettePanelEl.offsetWidth;
  const ph = palettePanelEl.offsetHeight;
  const offset = 14;
  const margin = 8;

  let x = clientX + offset;
  let y = clientY + offset;

  if (x + pw > window.innerWidth - margin) x = clientX - pw - offset;
  if (y + ph > window.innerHeight - margin) y = clientY - ph - offset;

  x = Math.max(margin, Math.min(x, window.innerWidth - pw - margin));
  y = Math.max(margin, Math.min(y, window.innerHeight - ph - margin));

  palettePanelEl.style.left = `${x}px`;
  palettePanelEl.style.top = `${y}px`;
  palettePanelEl.style.visibility = "";

  void palettePanelEl.offsetWidth;
  palettePanelEl.classList.add("palette-anim");
}

// ── 미니 팔레트 렌더 ──────────────────────────────────────
function renderMiniPalette() {
  miniPaletteEl.innerHTML = "";
  const around = colors.slice(0, 10);
  around.forEach((color, index) => {
    const chip = document.createElement("span");
    chip.className = "mini-swatch";
    chip.style.background = color;
    chip.style.setProperty("--angle", `${(index * 360) / around.length}deg`);
    miniPaletteEl.appendChild(chip);
  });
  miniPaletteEl.appendChild(activePaintBlobEl);
}

// ── 팔레트 렌더 ───────────────────────────────────────────
function renderPalette() {
  palettePanelEl.innerHTML = "";
  colors.forEach((color, index) => {
    const swatchBtn = document.createElement("button");
    swatchBtn.className = "swatch";
    if (index === state.colorIndex) swatchBtn.classList.add("active");
    swatchBtn.title = color;
    swatchBtn.style.background = color;
    swatchBtn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.colorIndex = index;
      palettePanelEl.classList.add("hidden");
      state.mode = "move";
      renderPalette();
      updateStatus();
    });
    swatchBtn.addEventListener("click", () => {
      state.colorIndex = index;
      palettePanelEl.classList.add("hidden");
      state.mode = "move";
      renderPalette();
      updateStatus();
    });
    palettePanelEl.appendChild(swatchBtn);
  });
}

// ── 캔버스 크기별 기본 감도 ───────────────────────────────
// 펌웨어 STEP_PIXELS=2 기준 (slow=2px, medium=4px, fast=8px/detent)
// 작은 캔버스 → medium 속도(4px)에서 1칸: threshold=4
// 큰 캔버스  → slow 속도(2px)에서 1칸:   threshold=2 (가속이 빠른 이동 담당)
const CANVAS_THRESHOLD = {
  10:  4,  // slow: 2클릭/칸 | medium: 1클릭/칸 | fast: 2칸/클릭
  15:  4,  // slow: 2클릭/칸 | medium: 1클릭/칸 | fast: 2칸/클릭
  30:  2,  // slow: 1클릭/칸 | medium: 2칸/클릭 | fast: 4칸/클릭
  50:  2,  // slow: 1클릭/칸 | medium: 2칸/클릭 | fast: 4칸/클릭
  100: 2,  // slow: 1클릭/칸 | medium: 2칸/클릭 | fast: 4칸/클릭
};

// ── 캔버스 크기 적용 ──────────────────────────────────────
function applyCanvasSize(size) {
  state.canvasSize = size;
  if (size === 10) state.cellSize = 40;
  else if (size === 15) state.cellSize = 28;
  else if (size === 30) state.cellSize = 16;
  else if (size === 50) state.cellSize = 10;
  else state.cellSize = 6;

  // 캔버스 크기에 맞는 감도 자동 설정
  state.moveThreshold = CANVAS_THRESHOLD[size] ?? 2;

  canvas.width = size * state.cellSize;
  canvas.height = size * state.cellSize;
  cursorCanvas.width = canvas.width;
  cursorCanvas.height = canvas.height;

  // 가상 커서 초기화
  state.vCellX = 0;
  state.vCellY = 0;
  state.accX = 0;
  state.accY = 0;
  lastMouseX = null;
  lastMouseY = null;

  sizePickerEl.classList.add("hidden");
  drawGrid();
  renderPalette();
  palettePanelEl.classList.add("hidden");
  updateStatus();
}

// ── 감도 조절 ─────────────────────────────────────────────
sensDecBtnEl.addEventListener("click", () => {
  state.moveThreshold = Math.max(1, state.moveThreshold - 1);
  updateStatus();
});

sensIncBtnEl.addEventListener("click", () => {
  state.moveThreshold = Math.min(30, state.moveThreshold + 1);
  updateStatus();
});

sizeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const size = Number.parseInt(button.dataset.size, 10);
    applyCanvasSize(size);
  });
});

resizeBtnEl.addEventListener("click", () => {
  sizePickerEl.classList.remove("hidden");
});

clearBtnEl.addEventListener("click", () => {
  if (!state.canvasSize) return;
  drawGrid();
  drawVCursor();
});

updateStatus();
renderMiniPalette();
