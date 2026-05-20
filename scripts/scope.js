// ── DOM ──────────────────────────────────────────────────────────
const canvas = document.getElementById("scopeCanvas");
const ctx    = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;
const CX = W / 2, CY = H / 2;
const SCOPE_R = W * 0.41;

const scopeScoreBoardEl  = document.getElementById("scopeScoreBoard");
const scopeRoundBoardEl  = document.getElementById("scopeRoundBoard");
const scopeDifficultyEl  = document.getElementById("scopeDifficultyState");
const scopeRoundStateEl  = document.getElementById("scopeRoundState");
const scopeMatchStateEl  = document.getElementById("scopeMatchState");
const scopeBestStateEl   = document.getElementById("scopeBestState");
const scopeMessageEl     = document.getElementById("scopeMessage");
const scopePhaseBoxEl    = document.getElementById("scopePhaseBox");
const scopePhaseIconEl   = document.getElementById("scopePhaseIcon");
const scopePhaseTextEl   = document.getElementById("scopePhaseText");
const scopeGuideEl       = document.getElementById("scopeGuide");

const scopeStartBtn        = document.getElementById("scopeStartBtn");
const scopeResetBtn        = document.getElementById("scopeResetBtn");
const scopeStartOverlay    = document.getElementById("scopeStartOverlay");
const scopeStartControlBtn = document.getElementById("scopeStartControlBtn");
const scopeResultOverlay   = document.getElementById("scopeResultOverlay");
const scopeResultTitle     = document.getElementById("scopeResultTitle");
const scopeResultText      = document.getElementById("scopeResultText");
const scopeReplayBtn       = document.getElementById("scopeReplayBtn");
const difficultyButtons    = document.querySelectorAll(".difficulty-btn");

const BEST_KEY = "dual-knob-scope-best-v1";

// ── Color palette (CRT phosphor green / cyan target) ─────────────
const C = {
  bg:          "#010a06",
  grid:        "rgba(0,255,65,0.055)",
  gridCenter:  "rgba(0,255,65,0.13)",
  phosphor:    "#00ff41",
  target:      "#00dcff",
  textBright:  "rgba(0,255,65,0.90)",
  textDim:     "rgba(0,255,65,0.42)",
};

// ── Lissajous target patterns [fx, fy] ──────────────────────────
const PATTERNS = {
  easy:   [[1,1], [1,2], [2,1], [1,3], [2,3]],
  normal: [[3,2], [3,4], [4,3], [2,5], [3,5]],
  hard:   [[4,5], [5,4], [5,7], [4,7], [7,4]],
};

// ── Difficulty config ─────────────────────────────────────────────
const DIFFICULTY = {
  easy: {
    label: "초급", rounds: 5,
    revealMs: 3500, timeLimitSec: 40,
    tolerance: 0.30, freqSens: 0.006,
  },
  normal: {
    label: "중급", rounds: 5,
    revealMs: 2500, timeLimitSec: 30,
    tolerance: 0.17, freqSens: 0.005,
  },
  hard: {
    label: "고급", rounds: 5,
    revealMs: 1800, timeLimitSec: 22,
    tolerance: 0.09, freqSens: 0.004,
  },
};

// ── State ─────────────────────────────────────────────────────────
const state = {
  difficulty: "easy",
  running: false,
  paused: false,
  freqX: 2.0,
  freqY: 2.0,
  targetFX: 2,
  targetFY: 3,
  round: 0,
  totalScore: 0,
  roundScores: [],
  patterns: [],
  revealActive: false,
  revealEndMs: 0,
  roundStartMs: 0,
  submitted: false,
  pauseStartedMs: 0,
  rafId: 0,
  mouse: { active: false, lastX: 0, lastY: 0 },
};

// ── Utils ─────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function cfg() { return DIFFICULTY[state.difficulty]; }

// ── Lissajous curve computation ───────────────────────────────────
function lissajousPoints(fx, fy, n = 900) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI;
    pts.push([
      CX + Math.sin(fx * t) * SCOPE_R,
      CY + Math.sin(fy * t) * SCOPE_R,
    ]);
  }
  return pts;
}

function drawCurve(pts, color, alpha, blur, width) {
  if (!pts.length || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.restore();
}

// ── Accuracy ──────────────────────────────────────────────────────
function calcAccuracy() {
  const dx = Math.abs(state.freqX - state.targetFX);
  const dy = Math.abs(state.freqY - state.targetFY);
  return clamp(1 - Math.sqrt(dx * dx + dy * dy) / (cfg().tolerance * 5), 0, 1);
}

// ── Drawing ───────────────────────────────────────────────────────
function drawGrid() {
  ctx.save();

  // Minor grid
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 10; i++) {
    const x = (W / 10) * i, y = (H / 10) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Center crosshair
  ctx.strokeStyle = C.gridCenter;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(CX, 0); ctx.lineTo(CX, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, CY); ctx.lineTo(W, CY); ctx.stroke();

  // Scope boundary circle
  ctx.strokeStyle = "rgba(0,255,65,0.07)";
  ctx.beginPath();
  ctx.arc(CX, CY, SCOPE_R * 1.005, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawHUD(acc, revealing) {
  ctx.save();
  ctx.font = "11px 'Courier New', Courier, monospace";
  ctx.textBaseline = "top";

  // Top-left: round info
  ctx.fillStyle = C.textDim;
  ctx.textAlign = "left";
  ctx.fillText(`RND ${state.round + 1} / ${cfg().rounds}`, 10, 10);

  // Top-right: total score
  ctx.textAlign = "right";
  ctx.fillText(`SCORE  ${state.totalScore}`, W - 10, 10);

  // Bottom-left/right: freq readouts
  ctx.fillStyle = C.textBright;
  ctx.textAlign = "left";
  ctx.fillText(`fx  ${state.freqX.toFixed(2)}`, 10, H - 22);
  ctx.textAlign = "right";
  ctx.fillText(`fy  ${state.freqY.toFixed(2)}`, W - 10, H - 22);

  // Match accuracy bar
  if (!revealing && !state.submitted) {
    const barW = 160, barH = 5;
    const barX = CX - barW / 2, barY = H - 16;
    ctx.fillStyle = "rgba(0,255,65,0.10)";
    ctx.fillRect(barX, barY, barW, barH);
    const barColor = acc > 0.72 ? C.phosphor : acc > 0.42 ? "#facc15" : "#ef4444";
    ctx.fillStyle = barColor;
    ctx.fillRect(barX, barY, barW * acc, barH);
    ctx.fillStyle = C.textDim;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(`MATCH  ${Math.round(acc * 100)}%`, CX, barY - 2);
  }

  // Reveal banner
  if (revealing) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = "bold 12px 'Courier New', Courier, monospace";
    ctx.fillStyle = C.target;
    ctx.shadowColor = C.target;
    ctx.shadowBlur = 14;
    ctx.fillText("◀  TARGET — MEMORIZE  ▶", CX, CY + SCOPE_R + 24);
    ctx.restore();
  }

  ctx.restore();
}

function draw() {
  // Background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  drawGrid();

  const revealing = state.revealActive;

  // Target curve (cyan ghost)
  const tPts = lissajousPoints(state.targetFX, state.targetFY);
  if (revealing) {
    drawCurve(tPts, C.target, 0.18, 32, 5);
    drawCurve(tPts, C.target, 0.70, 10, 2);
  } else {
    drawCurve(tPts, C.target, 0.14, 6, 1.5);
  }

  // Player curve — phosphor glow (3-pass)
  const pPts = lissajousPoints(state.freqX, state.freqY);
  drawCurve(pPts, C.phosphor, 0.05, 40, 12);
  drawCurve(pPts, C.phosphor, 0.16, 18, 4);
  drawCurve(pPts, C.phosphor, 0.82, 4,  1.5);

  // Vignette
  const vig = ctx.createRadialGradient(CX, CY, SCOPE_R * 0.45, CX, CY, SCOPE_R * 1.7);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,5,2,0.75)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  if (state.running) drawHUD(calcAccuracy(), revealing);

  // Pause overlay
  if (state.paused) {
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 22px 'Courier New', Courier, monospace";
    ctx.fillStyle = C.phosphor;
    ctx.shadowColor = C.phosphor;
    ctx.shadowBlur = 20;
    ctx.fillText("PAUSED", CX, CY);
    ctx.restore();
  }
}

// ── Game flow ─────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startGame() {
  state.patterns    = shuffle(PATTERNS[state.difficulty]);
  state.round       = 0;
  state.totalScore  = 0;
  state.roundScores = [];
  state.running     = true;
  state.paused      = false;
  scopeResultOverlay.classList.add("hidden");
  scopeStartOverlay.classList.add("hidden");
  startRound();
  cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(frame);
}

function startRound() {
  const [tx, ty] = state.patterns[state.round];
  state.targetFX = tx;
  state.targetFY = ty;

  // Place player frequencies at least 1.5 away from target
  let px, py;
  do {
    px = parseFloat((Math.random() * 5 + 1).toFixed(1));
    py = parseFloat((Math.random() * 5 + 1).toFixed(1));
  } while (Math.abs(px - tx) < 1.5 && Math.abs(py - ty) < 1.5);
  state.freqX = clamp(px, 0.5, 6.5);
  state.freqY = clamp(py, 0.5, 6.5);

  state.revealActive = true;
  state.revealEndMs  = performance.now() + cfg().revealMs;
  state.roundStartMs = state.revealEndMs;
  state.submitted    = false;
  state.mouse.active = false;
  scopeMessageEl.textContent = `패턴을 기억하세요! (${cfg().revealMs / 1000}초)`;
  updateStatus();
}

function submitRound() {
  if (!state.running || state.paused || state.revealActive || state.submitted) return;
  state.submitted = true;

  const acc       = calcAccuracy();
  const elapsed   = (performance.now() - state.roundStartMs) / 1000;
  const timeRatio = clamp(1 - elapsed / cfg().timeLimitSec, 0, 1);
  const roundScore = Math.round(acc * 750 + timeRatio * 250);
  state.totalScore += roundScore;
  state.roundScores.push({ acc, roundScore });

  scopeMessageEl.textContent = `${Math.round(acc * 100)}% 정확도  +${roundScore}점`;
  updateStatus();

  state.round++;
  if (state.round >= cfg().rounds) {
    setTimeout(finishGame, 900);
  } else {
    setTimeout(startRound, 1000);
  }
}

function finishGame() {
  state.running = false;
  cancelAnimationFrame(state.rafId);
  draw();

  const avgAcc = state.roundScores.reduce((s, r) => s + r.acc, 0) / state.roundScores.length;
  saveBest(state.totalScore);
  const best = loadBest();
  scopeResultTitle.textContent = state.totalScore === best ? "NEW BEST!" : "COMPLETE";
  scopeResultText.textContent =
    `SCORE ${state.totalScore}  ·  AVG ${Math.round(avgAcc * 100)}%  ·  BEST ${best}`;
  scopeResultOverlay.classList.remove("hidden");
  updateStatus();
}

function togglePause() {
  if (!state.running) return;
  if (!state.paused) {
    state.paused = true;
    state.pauseStartedMs = performance.now();
    cancelAnimationFrame(state.rafId);
    draw();
    scopeMessageEl.textContent = "일시정지";
  } else {
    const gap = performance.now() - state.pauseStartedMs;
    state.revealEndMs  += gap;
    state.roundStartMs += gap;
    state.paused = false;
    state.rafId = requestAnimationFrame(frame);
    scopeMessageEl.textContent = "재개!";
  }
}

function openStartOverlay() {
  state.running = false;
  state.paused  = false;
  cancelAnimationFrame(state.rafId);
  scopeResultOverlay.classList.add("hidden");
  scopeStartOverlay.classList.remove("hidden");
  scopeMessageEl.textContent = "난이도를 선택하고 시작하세요.";
  draw();
  updateStatus();
}

// ── Persistence ───────────────────────────────────────────────────
function loadBest() {
  try {
    const d = JSON.parse(localStorage.getItem(BEST_KEY) ?? "{}");
    return d[state.difficulty] ?? null;
  } catch { return null; }
}

function saveBest(score) {
  try {
    const d = JSON.parse(localStorage.getItem(BEST_KEY) ?? "{}");
    if (!d[state.difficulty] || score > d[state.difficulty]) {
      d[state.difficulty] = score;
      localStorage.setItem(BEST_KEY, JSON.stringify(d));
    }
  } catch { /* ignore */ }
}

// ── Phase guide ───────────────────────────────────────────────────
function setPhase(phase, icon, text, guide) {
  const cls = ["scope-phase-idle","scope-phase-reveal","scope-phase-play","scope-phase-good","scope-phase-done"];
  scopePhaseBoxEl.classList.remove(...cls);
  scopePhaseBoxEl.classList.add(`scope-phase-${phase}`);
  scopePhaseIconEl.textContent = icon;
  scopePhaseTextEl.textContent = text;
  scopeGuideEl.textContent     = guide;
}

function updatePhaseGuide() {
  if (!state.running) {
    setPhase("idle", "●", "대기 중",
      "난이도를 선택하고 시작 버튼을 누르세요.");
    return;
  }
  if (state.paused) {
    setPhase("idle", "⏸", "일시정지",
      "중클릭으로 재개할 수 있습니다.");
    return;
  }
  if (state.revealActive) {
    setPhase("reveal", "◉", "① 파형 기억 중",
      "청색 파형의 모양을 눈에 담으세요.\n곧 희미해집니다. 특징적인 곡선 수와 대칭을 기억하세요.");
    return;
  }
  if (state.submitted) {
    setPhase("done", "✓", "④ 제출 완료",
      "다음 라운드 준비 중...");
    return;
  }
  const acc = calcAccuracy();
  if (acc < 0.35) {
    setPhase("play", "◎", "② 주파수 조절 중",
      "좌 노브(↕)를 돌려 X 주파수를,\n우 노브(↔)를 돌려 Y 주파수를 바꾸세요.\n초록 파형이 청색과 닮아지도록 조절하세요.");
  } else if (acc < 0.70) {
    setPhase("play", "◎", "② 조금 더 가까이",
      `MATCH ${Math.round(acc * 100)}% — 비슷해지고 있어요!\n더 세밀하게 조절해 보세요.\n패턴 모양이 거의 같아지면 클릭하세요.`);
  } else {
    setPhase("good", "◉", "③ 클릭으로 제출!",
      `MATCH ${Math.round(acc * 100)}% — 훌륭합니다!\n지금 클릭하면 높은 점수를 받습니다.\n더 정밀하게 맞추면 점수가 올라요.`);
  }
}

// ── Status sidebar ────────────────────────────────────────────────
function updateStatus() {
  const d = cfg();
  scopeDifficultyEl.textContent = `Difficulty: ${d.label}`;
  scopeRoundStateEl.textContent = `Round: ${state.round} / ${d.rounds}`;
  const acc = state.running ? calcAccuracy() : 0;
  scopeMatchStateEl.textContent = `Match: ${Math.round(acc * 100)}%`;
  scopeBestStateEl.textContent  = `Best: ${loadBest() ?? "-"}`;
  scopeScoreBoardEl.textContent = String(state.totalScore);
  scopeRoundBoardEl.textContent = `${state.round} / ${d.rounds}`;
  updatePhaseGuide();
}

// ── Frame loop ────────────────────────────────────────────────────
function frame() {
  if (!state.running || state.paused) return;

  const now = performance.now();
  if (state.revealActive && now >= state.revealEndMs) {
    state.revealActive = false;
    state.roundStartMs = now;
    state.mouse.active = false;
    scopeMessageEl.textContent = "패턴을 재현하고 클릭으로 제출!";
  }

  draw();
  updateStatus();
  state.rafId = requestAnimationFrame(frame);
}

// ── Input ─────────────────────────────────────────────────────────
window.addEventListener("mousemove", (e) => {
  const blocked = !state.running || state.paused || state.revealActive || state.submitted;
  if (blocked) {
    state.mouse.lastX = e.clientX;
    state.mouse.lastY = e.clientY;
    state.mouse.active = true;
    return;
  }
  if (!state.mouse.active) {
    state.mouse.active = true;
    state.mouse.lastX = e.clientX;
    state.mouse.lastY = e.clientY;
    return;
  }
  const dx = e.clientX - state.mouse.lastX;
  const dy = e.clientY - state.mouse.lastY;
  state.mouse.lastX = e.clientX;
  state.mouse.lastY = e.clientY;

  const s = cfg().freqSens;
  state.freqX = clamp(state.freqX - dy * s, 0.5, 6.5);  // left knob (Y)
  state.freqY = clamp(state.freqY + dx * s, 0.5, 6.5);  // right knob (X)
});

window.addEventListener("mousedown", (e) => {
  if (e.button === 1) { e.preventDefault(); togglePause(); return; }
  if (!state.running || state.paused) return;
  if (e.button === 0 || e.button === 2) {
    e.preventDefault();
    submitRound();
  }
});

window.addEventListener("contextmenu", (e) => {
  if (state.running) e.preventDefault();
});

// ── Wiring ────────────────────────────────────────────────────────
difficultyButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    difficultyButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.difficulty = btn.dataset.difficulty;
    updateStatus();
  });
});

scopeStartControlBtn.addEventListener("click", startGame);
scopeStartBtn.addEventListener("click", openStartOverlay);
scopeResetBtn.addEventListener("click", () => {
  if (state.running) startGame();
  else openStartOverlay();
});
scopeReplayBtn.addEventListener("click", () => {
  scopeResultOverlay.classList.add("hidden");
  openStartOverlay();
});

// ── Boot ──────────────────────────────────────────────────────────
difficultyButtons[0].classList.add("active");
draw();
updateStatus();
openStartOverlay();
