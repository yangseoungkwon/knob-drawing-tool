// ── DOM ───────────────────────────────────────────────────────────
const canvas          = document.getElementById("nebulaCanvas");
const ctx             = canvas.getContext("2d");
const nebulaFxValEl    = document.getElementById("nebulaFxVal");
const nebulaFyValEl    = document.getElementById("nebulaFyVal");
const nebulaRatioValEl = document.getElementById("nebulaRatioVal");
const nebulaMessageEl  = document.getElementById("nebulaMessage");
const nebulaClearBtn   = document.getElementById("nebulaClearBtn");
const nebulaLockBtn    = document.getElementById("nebulaLockBtn");
const modeBtns         = document.querySelectorAll(".nebula-mode-btn");
const speedBtns        = document.querySelectorAll(".nebula-speed-btn");
const snapBtns         = document.querySelectorAll(".nebula-snap-btn");
const stage            = document.querySelector(".nebula-stage");

// ── Size vars (mutable on resize) ────────────────────────────────
let W, H, CX, CY, RX, RY;

// 오프스크린 캔버스 — 곡선을 한 번만 그리고 N번 복사
let offscreen, offCtx;

function resizeCanvas() {
  canvas.width  = stage.clientWidth;
  canvas.height = stage.clientHeight;
  W  = canvas.width;  H  = canvas.height;
  CX = W / 2;         CY = H / 2;
  RX = W * 0.44;      RY = H * 0.44;

  offscreen = document.createElement("canvas");
  offscreen.width  = W;
  offscreen.height = H;
  offCtx = offscreen.getContext("2d");

  clearCanvas();
}

new ResizeObserver(resizeCanvas).observe(stage);

// ── State ─────────────────────────────────────────────────────────
const state = {
  freqX:      3.0,
  ampY:       0.80,
  phase:      0,
  phaseSpeed: 0.004,
  hue:        200,
  colorMode:  "auto",
  snapInt:    false,
  freqSens:   0.004,
  ampSens:    0.001,
  kaleido:    true,
  kaleidoN:   6,
};

// ── Utils ─────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function isLocked() { return document.pointerLockElement === canvas; }

// ── Pointer Lock ──────────────────────────────────────────────────
function requestLock() { if (!isLocked()) canvas.requestPointerLock(); }
function releaseLock() { if (isLocked()) document.exitPointerLock(); }

document.addEventListener("pointerlockchange", () => {
  nebulaLockBtn.textContent = isLocked() ? "커서 해제" : "커서 잠금";
  nebulaMessageEl.textContent = isLocked()
    ? "노브를 돌려 성운을 그리세요. 중클릭·ESC로 해제."
    : "커서 잠금 후 노브를 돌려 성운을 그리세요.";
});

// ── Curve ─────────────────────────────────────────────────────────
function lissajousPoints(fx, ampY, phX, n = 1100) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI;
    pts.push([
      CX + Math.sin(fx * t + phX) * RX,
      CY + Math.sin(t) * RY * ampY,
    ]);
  }
  return pts;
}

function strokePath(target, pts, color, alpha, width, blur) {
  target.save();
  target.globalAlpha = alpha;
  target.strokeStyle = color;
  target.lineWidth   = width;
  target.lineJoin    = "round";
  target.shadowColor = color;
  target.shadowBlur  = blur;
  target.beginPath();
  target.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) target.lineTo(pts[i][0], pts[i][1]);
  target.stroke();
  target.restore();
}

// ── Kaleidoscope: 오프스크린에 1번 그리고 N번 drawImage 복사 ────────
function drawKaleido(pts, color) {
  // 1. 오프스크린에 3-pass 곡선 (shadowBlur 여기서만)
  offCtx.clearRect(0, 0, W, H);
  strokePath(offCtx, pts, color, 0.030, 16, 55);
  strokePath(offCtx, pts, color, 0.130, 4,  20);
  strokePath(offCtx, pts, color, 0.800, 1.3, 5);

  // 2. N번 회전+반사 후 main canvas에 blit (shadowBlur 없이 빠름)
  const N = state.kaleidoN;
  const step = (Math.PI * 2) / N;
  for (let i = 0; i < N; i++) {
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(step * i);
    if (i % 2 === 1) ctx.scale(1, -1);
    ctx.translate(-CX, -CY);
    ctx.drawImage(offscreen, 0, 0);
    ctx.restore();
  }
}

function drawSingle(pts, color) {
  strokePath(ctx, pts, color, 0.030, 16, 55);
  strokePath(ctx, pts, color, 0.130, 4,  20);
  strokePath(ctx, pts, color, 0.800, 1.3, 5);
}

// ── Color ─────────────────────────────────────────────────────────
function getColor() {
  if (state.colorMode === "fixed") return "hsl(270, 100%, 70%)";
  if (state.colorMode === "ratio") return `hsl(${(state.freqX * 137.5) % 360}, 100%, 65%)`;
  return `hsl(${state.hue}, 100%, 65%)`;
}

// ── Background ────────────────────────────────────────────────────
function clearCanvas() {
  if (!W) return;
  ctx.fillStyle = "#000010";
  ctx.fillRect(0, 0, W, H);
  const rng = mulberry32(0xdeadbeef);
  const count = Math.round((W * H) / 1400);
  for (let i = 0; i < count; i++) {
    const x = rng() * W, y = rng() * H;
    const r = rng() * 1.1 + 0.2, a = rng() * 0.5 + 0.05;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${180 + rng() * 60 | 0},${190 + rng() * 50 | 0},255,${a})`;
    ctx.fill();
  }
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── Frame loop ────────────────────────────────────────────────────
function frame() {
  if (!W) { requestAnimationFrame(frame); return; }   // wait for ResizeObserver
  state.phase += state.phaseSpeed;
  if (state.colorMode === "auto") state.hue = (state.hue + 0.35) % 360;

  ctx.fillStyle = "rgba(0, 0, 16, 0.020)";
  ctx.fillRect(0, 0, W, H);

  const pts   = lissajousPoints(state.freqX, state.ampY, state.phase);
  const color = getColor();
  if (state.kaleido) drawKaleido(pts, color);
  else               drawSingle(pts, color);

  nebulaFxValEl.textContent    = state.freqX.toFixed(2);
  nebulaFyValEl.textContent    = Math.round(state.ampY * 100) + "%";
  nebulaRatioValEl.textContent = `${Math.round(state.freqX)}밴드 · ${Math.round(state.ampY * 100)}%`;

  requestAnimationFrame(frame);
}

// ── Input ─────────────────────────────────────────────────────────
window.addEventListener("mousemove", (e) => {
  if (!isLocked()) return;
  let nx = clamp(state.freqX - e.movementY * state.freqSens, 0.5, 9.5);
  if (state.snapInt) nx = Math.round(nx);
  state.freqX = nx;
  state.ampY  = clamp(state.ampY + e.movementX * state.ampSens, 0.08, 1.0);
});

// 캔버스 좌클릭 → 잠금 진입
canvas.addEventListener("click", (e) => {
  if (e.button === 0 && !isLocked()) requestLock();
});

// 중클릭: 잠금 해제 — canvas + document, mousedown + auxclick 네 겹으로 잡기
function onMiddleDown(e) {
  if (e.button !== 1) return;
  e.preventDefault();
  e.stopPropagation();
  if (isLocked()) releaseLock(); else requestLock();
}
canvas.addEventListener("mousedown",  onMiddleDown, { capture: true });
canvas.addEventListener("auxclick",   onMiddleDown, { capture: true });
document.addEventListener("mousedown",  onMiddleDown, { capture: true });
document.addEventListener("auxclick",   onMiddleDown, { capture: true });

// 우클릭: 지우기
document.addEventListener("mousedown", (e) => {
  if (e.button === 2) { e.preventDefault(); clearCanvas(); }
}, true);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") releaseLock();
});

window.addEventListener("contextmenu", (e) => e.preventDefault());

// ── Controls ──────────────────────────────────────────────────────
nebulaClearBtn.addEventListener("click", clearCanvas);
nebulaLockBtn.addEventListener("click", () => isLocked() ? releaseLock() : requestLock());

document.querySelectorAll(".nebula-kaleido-btn").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".nebula-kaleido-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const v = btn.dataset.kaleido;
  state.kaleido  = v !== "off";
  state.kaleidoN = v === "off" ? 6 : parseInt(v);
  clearCanvas();
}));

modeBtns.forEach(btn => btn.addEventListener("click", () => {
  modeBtns.forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  state.colorMode = btn.dataset.mode;
}));

speedBtns.forEach(btn => btn.addEventListener("click", () => {
  speedBtns.forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  state.phaseSpeed = parseFloat(btn.dataset.speed);
}));

snapBtns.forEach(btn => btn.addEventListener("click", () => {
  snapBtns.forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  state.snapInt = btn.dataset.snap === "on";
}));

// ── Boot ──────────────────────────────────────────────────────────
frame();
