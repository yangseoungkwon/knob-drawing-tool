const canvas = document.getElementById("drawCanvas");
const ctx = canvas.getContext("2d");

const penStatusEl = document.getElementById("penStatus");
const toolStatusEl = document.getElementById("toolStatus");
const colorStatusEl = document.getElementById("colorStatus");
const sizeStatusEl = document.getElementById("sizeStatus");
const palettePanelEl = document.getElementById("palettePanel");
const sizePickerEl = document.getElementById("sizePicker");
const sizeButtons = document.querySelectorAll("#sizePicker .size-btn[data-size]");
const resizeBtnEl = document.getElementById("resizeBtn");
const clearBtnEl = document.getElementById("clearBtn");
const modeIconEl = document.getElementById("modeIcon");
const miniPaletteEl = document.getElementById("miniPalette");
const activePaintBlobEl = document.getElementById("activePaintBlob");
const canvasWrapEl = document.getElementById("canvasWrap");

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
  pointer: { x: canvas.width / 2, y: canvas.height / 2 },
  pointerClient: { x: window.innerWidth / 2, y: window.innerHeight / 2 }
};

ctx.imageSmoothingEnabled = false;

function drawGrid() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const gridStep = state.cellSize;
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  for (let y = 0; y < canvas.height; y += gridStep) {
    for (let x = 0; x < canvas.width; x += gridStep) {
      ctx.strokeRect(x + 0.5, y + 0.5, gridStep, gridStep);
    }
  }
}

function updateStatus() {
  penStatusEl.textContent = `Mode: ${state.mode.toUpperCase()}`;
  toolStatusEl.textContent = `Tool: ${getActiveToolLabel()}`;
  colorStatusEl.textContent = `Color: ${colors[state.colorIndex]}`;
  sizeStatusEl.textContent = `Canvas: ${state.canvasSize ? `${state.canvasSize}x${state.canvasSize}` : "-"}`;
  resizeBtnEl.textContent = state.canvasSize ? `${state.canvasSize}×${state.canvasSize}` : "크기 변경";
  modeIconEl.classList.remove("mode-pen", "mode-erase", "mode-move");
  modeIconEl.classList.add(
    state.mode === "paint" ? "mode-pen" : state.mode === "erase" ? "mode-erase" : "mode-move"
  );
  activePaintBlobEl.style.background = colors[state.colorIndex];
  updateCursor();
}

function getActiveToolLabel() {
  if (state.mode === "erase") return "Eraser";
  if (state.mode === "paint") return "Pen";
  return "Move";
}

function updateCursor() {
  if (state.mode === "erase") {
    canvas.style.cursor = makeCircleCursor("#ffffff", "#64748b");
    return;
  }
  if (state.mode === "paint") {
    canvas.style.cursor = makeCircleCursor(colors[state.colorIndex], "#111827");
    return;
  }
  canvas.style.cursor = "move";
}

function makeCircleCursor(fill, stroke) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, auto`;
}

function paintCell(point, button) {
  const fillColor = button === 2 ? "#ffffff" : colors[state.colorIndex];

  const cellX = Math.floor(point.x / state.cellSize) * state.cellSize;
  const cellY = Math.floor(point.y / state.cellSize) * state.cellSize;
  const cellPaintSize = Math.max(state.cellSize - 1, 1);
  ctx.fillStyle = fillColor;
  ctx.fillRect(cellX + 1, cellY + 1, cellPaintSize, cellPaintSize);
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.strokeRect(cellX + 0.5, cellY + 0.5, state.cellSize, state.cellSize);
}

function canvasPointFromMouse(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

canvas.addEventListener("mousemove", (event) => {
  if (!state.canvasSize) return;
  const point = canvasPointFromMouse(event);
  state.pointer = point;
  state.pointerClient = { x: event.clientX, y: event.clientY };

  if (state.mode === "paint") {
    paintCell(point, 0);
    return;
  }
  if (state.mode === "erase") {
    paintCell(point, 2);
  }
});

canvas.addEventListener("mouseleave", () => {});

canvas.addEventListener("mousedown", (event) => {
  if (!state.canvasSize) return;
  if (event.buttons === 3 || event.button === 1) {
    event.preventDefault();
    togglePaletteAt(event.clientX, event.clientY);
    updateStatus();
    return;
  }
  const point = canvasPointFromMouse(event);
  if (event.button === 0) {
    state.mode = state.mode === "paint" ? "move" : "paint";
    if (state.mode === "paint") paintCell(point, 0);
  } else if (event.button === 2) {
    state.mode = state.mode === "erase" ? "move" : "erase";
  }
  updateStatus();
});

canvas.addEventListener("mouseup", () => {});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "p") {
    togglePaletteAt(state.pointerClient.x, state.pointerClient.y);
  }
  updateStatus();
});

// 팔레트를 커서 근처에 띄워 이동 최소화
function togglePaletteAt(clientX, clientY) {
  const isOpen = !palettePanelEl.classList.contains("hidden");
  if (isOpen) {
    palettePanelEl.classList.add("hidden");
    palettePanelEl.classList.remove("palette-anim");
    return;
  }

  // visibility: hidden으로 렌더링해 실제 크기 측정 후 위치 계산
  palettePanelEl.style.visibility = "hidden";
  palettePanelEl.style.left = "0px";
  palettePanelEl.style.top = "0px";
  palettePanelEl.classList.remove("hidden");
  palettePanelEl.classList.remove("palette-anim");

  const pw = palettePanelEl.offsetWidth;
  const ph = palettePanelEl.offsetHeight;
  const offset = 14;
  const margin = 8;

  // 커서 우하단 기본, 화면 끝에 걸리면 반대 방향으로
  let x = clientX + offset;
  let y = clientY + offset;

  if (x + pw > window.innerWidth - margin) x = clientX - pw - offset;
  if (y + ph > window.innerHeight - margin) y = clientY - ph - offset;

  x = Math.max(margin, Math.min(x, window.innerWidth - pw - margin));
  y = Math.max(margin, Math.min(y, window.innerHeight - ph - margin));

  palettePanelEl.style.left = `${x}px`;
  palettePanelEl.style.top = `${y}px`;
  palettePanelEl.style.visibility = "";

  // 애니메이션 재실행 (reflow 강제)
  void palettePanelEl.offsetWidth;
  palettePanelEl.classList.add("palette-anim");
}

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

function applyCanvasSize(size) {
  state.canvasSize = size;
  if (size === 10) {
    state.cellSize = 40;
  } else if (size === 15) {
    state.cellSize = 28;
  } else if (size === 30) {
    state.cellSize = 16;
  } else if (size === 50) {
    state.cellSize = 10;
  } else {
    state.cellSize = 6;
  }
  canvas.width = size * state.cellSize;
  canvas.height = size * state.cellSize;
  sizePickerEl.classList.add("hidden");
  drawGrid();
  renderPalette();
  palettePanelEl.classList.add("hidden");
  updateStatus();
}

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
});

updateStatus();
renderMiniPalette();
