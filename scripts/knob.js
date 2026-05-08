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
  "#111111", "#ffffff", "#ef4444", "#f97316",
  "#f59e0b", "#84cc16", "#10b981", "#14b8a6",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"
];

const PALETTE_COLS = 4;
const PALETTE_ROWS = 3;

const state = {
  colorIndex: 0,
  canvasSize: null,
  cellSize: 10,
  mode: "move",
  // 가상 커서 (셀 인덱스)
  vCellX: 0,
  vCellY: 0,
  // 캔버스 이동 누산기 (if+reset → 1이벤트 최대 1칸)
  accX: 0,
  accY: 0,
  moveThreshold: 2,
  // 팔레트 탐색 커서
  paletteIndex: 0,
  paletteAccX: 0,
  paletteAccY: 0,
  pointerClient: { x: window.innerWidth / 2, y: window.innerHeight / 2 }
};

// threshold=2 = 펌웨어 STEP_PIXELS(slow) → 1클릭=1칸
// 가속(medium×3, fast×6, turbo×9)은 if+reset으로 드로잉에서 차단
const CANVAS_THRESHOLD = { 10: 2, 15: 2, 30: 2, 50: 2, 100: 2 };

let lastMouseX = null;
let lastMouseY = null;

ctx.imageSmoothingEnabled = false;

// ── 그리드 ────────────────────────────────────────────────
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

// ── 가상 커서 오버레이 ────────────────────────────────────
function drawVCursor() {
  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
  const px = state.vCellX * state.cellSize;
  const py = state.vCellY * state.cellSize;
  const sz = state.cellSize;
  const base = state.mode === "erase" ? "#ef4444"
    : state.mode === "paint" ? colors[state.colorIndex]
    : "#818cf8";
  cursorCtx.fillStyle = base + "28";
  cursorCtx.fillRect(px + 1, py + 1, sz - 1, sz - 1);
  cursorCtx.strokeStyle = base;
  cursorCtx.lineWidth = 2;
  cursorCtx.strokeRect(px + 0.5, py + 0.5, sz, sz);
}

// ── 셀 페인팅 ─────────────────────────────────────────────
function paintAtVCell(button) {
  const fillColor = button === 2 ? "#ffffff" : colors[state.colorIndex];
  const px = state.vCellX * state.cellSize;
  const py = state.vCellY * state.cellSize;
  const sz = Math.max(state.cellSize - 1, 1);
  ctx.fillStyle = fillColor;
  ctx.fillRect(px + 1, py + 1, sz, sz);
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, state.cellSize, state.cellSize);
}

// ── 상태 표시 ─────────────────────────────────────────────
function updateStatus() {
  penStatusEl.textContent = `Mode: ${state.mode.toUpperCase()}`;
  toolStatusEl.textContent = `Tool: ${getActiveToolLabel()}`;
  colorStatusEl.textContent = `Color: ${colors[state.colorIndex]}`;
  sizeStatusEl.textContent = state.canvasSize ? `${state.canvasSize}×${state.canvasSize}` : "-";
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

// ── mousemove ─────────────────────────────────────────────
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

  // ── 팔레트 열린 상태: 회전으로 색 탐색 ─────────────────
  if (!palettePanelEl.classList.contains("hidden")) {
    state.paletteAccX += dx;
    state.paletteAccY += dy;

    let col = state.paletteIndex % PALETTE_COLS;
    let row = Math.floor(state.paletteIndex / PALETTE_COLS);
    let moved = false;

    if (Math.abs(state.paletteAccX) >= state.moveThreshold) {
      col = (col + (state.paletteAccX > 0 ? 1 : -1) + PALETTE_COLS) % PALETTE_COLS;
      state.paletteAccX = 0;
      moved = true;
    }
    if (Math.abs(state.paletteAccY) >= state.moveThreshold) {
      row = (row + (state.paletteAccY > 0 ? 1 : -1) + PALETTE_ROWS) % PALETTE_ROWS;
      state.paletteAccY = 0;
      moved = true;
    }
    if (moved) {
      state.paletteIndex = row * PALETTE_COLS + col;
      renderPalette();
    }
    return;
  }

  // ── 캔버스 가상 커서 이동 ─────────────────────────────
  // if + accX=0 reset → 가속 px는 버리고 항상 1이벤트=최대 1칸
  state.accX += dx;
  state.accY += dy;

  let moved = false;

  if (Math.abs(state.accX) >= state.moveThreshold) {
    const dir = state.accX > 0 ? 1 : -1;
    const nx = state.vCellX + dir;
    if (nx >= 0 && nx < state.canvasSize) {
      state.vCellX = nx;
      if (state.mode === "paint") paintAtVCell(0);
      if (state.mode === "erase") paintAtVCell(2);
    }
    state.accX = 0;
    moved = true;
  }

  if (Math.abs(state.accY) >= state.moveThreshold) {
    const dir = state.accY > 0 ? 1 : -1;
    const ny = state.vCellY + dir;
    if (ny >= 0 && ny < state.canvasSize) {
      state.vCellY = ny;
      if (state.mode === "paint") paintAtVCell(0);
      if (state.mode === "erase") paintAtVCell(2);
    }
    state.accY = 0;
    moved = true;
  }

  if (moved) drawVCursor();
});

// ── mousedown ─────────────────────────────────────────────
window.addEventListener("mousedown", (event) => {
  if (!state.canvasSize) return;

  // ── 팔레트 열린 상태 ──────────────────────────────────
  if (!palettePanelEl.classList.contains("hidden")) {
    // 좌 또는 우 노브 클릭 → 현재 하이라이트된 색 선택
    if (event.button === 0 || event.button === 2) {
      event.preventDefault();
      state.colorIndex = state.paletteIndex;
      palettePanelEl.classList.add("hidden");
      palettePanelEl.classList.remove("palette-anim");
      state.mode = "move";
      renderPalette();
      updateStatus();
    }
    // 양쪽 동시(중클릭) → 선택 없이 닫기
    if (event.buttons === 3 || event.button === 1) {
      event.preventDefault();
      palettePanelEl.classList.add("hidden");
      palettePanelEl.classList.remove("palette-anim");
    }
    return;
  }

  // ── 양쪽 동시(중클릭) → 팔레트 열기 ──────────────────
  if (event.buttons === 3 || event.button === 1) {
    event.preventDefault();
    togglePaletteAt(event.clientX, event.clientY);
    updateStatus();
    return;
  }

  if (event.button === 0) {
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

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "p") {
    togglePaletteAt(state.pointerClient.x, state.pointerClient.y);
  }
  updateStatus();
});

// ── 팔레트 커서 근처 표시 ────────────────────────────────
function togglePaletteAt(clientX, clientY) {
  const isOpen = !palettePanelEl.classList.contains("hidden");
  if (isOpen) {
    palettePanelEl.classList.add("hidden");
    palettePanelEl.classList.remove("palette-anim");
    return;
  }

  // 팔레트 탐색 커서 초기화 (현재 색에서 시작)
  state.paletteIndex = state.colorIndex;
  state.paletteAccX = 0;
  state.paletteAccY = 0;

  // 위치 측정 후 배치
  palettePanelEl.style.visibility = "hidden";
  palettePanelEl.style.left = "0px";
  palettePanelEl.style.top = "0px";
  palettePanelEl.classList.remove("hidden");
  palettePanelEl.classList.remove("palette-anim");
  renderPalette();

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

// ── 미니 팔레트 ───────────────────────────────────────────
function renderMiniPalette() {
  miniPaletteEl.innerHTML = "";
  colors.slice(0, 10).forEach((color, index) => {
    const chip = document.createElement("span");
    chip.className = "mini-swatch";
    chip.style.background = color;
    chip.style.setProperty("--angle", `${(index * 360) / 10}deg`);
    miniPaletteEl.appendChild(chip);
  });
  miniPaletteEl.appendChild(activePaintBlobEl);
}

// ── 팔레트 렌더 ───────────────────────────────────────────
function renderPalette() {
  palettePanelEl.innerHTML = "";
  colors.forEach((color, index) => {
    const btn = document.createElement("button");
    btn.className = "swatch";
    if (index === state.colorIndex) btn.classList.add("active");
    if (index === state.paletteIndex) btn.classList.add("palette-cursor");
    btn.title = color;
    btn.style.background = color;
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.colorIndex = index;
      palettePanelEl.classList.add("hidden");
      state.mode = "move";
      renderPalette();
      updateStatus();
    });
    palettePanelEl.appendChild(btn);
  });
}

// ── 캔버스 크기 적용 ──────────────────────────────────────
function applyCanvasSize(size) {
  state.canvasSize = size;
  if (size === 10) state.cellSize = 40;
  else if (size === 15) state.cellSize = 28;
  else if (size === 30) state.cellSize = 16;
  else if (size === 50) state.cellSize = 10;
  else state.cellSize = 6;

  state.moveThreshold = CANVAS_THRESHOLD[size] ?? 2;

  canvas.width = size * state.cellSize;
  canvas.height = size * state.cellSize;
  cursorCanvas.width = canvas.width;
  cursorCanvas.height = canvas.height;

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

sizeButtons.forEach((btn) => {
  btn.addEventListener("click", () => applyCanvasSize(Number.parseInt(btn.dataset.size, 10)));
});

resizeBtnEl.addEventListener("click", () => sizePickerEl.classList.remove("hidden"));

clearBtnEl.addEventListener("click", () => {
  if (!state.canvasSize) return;
  drawGrid();
  drawVCursor();
});

updateStatus();
renderMiniPalette();
