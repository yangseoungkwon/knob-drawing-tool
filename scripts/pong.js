/**
 * Knob Pong — classic Atari-style Pong on HTML5 Canvas.
 * Physics参考: canvas Pong tutorials (paddle angle bounce, speed ramp on hit).
 * Input: RP2040 dual knob → mouse (left=Y, right=X).
 */
const canvas = document.getElementById("pongCanvas");
const ctx = canvas.getContext("2d");

const pongScoreBoardEl = document.getElementById("pongScoreBoard");
const pongGoalBoardEl = document.getElementById("pongGoalBoard");
const pongDifficultyStateEl = document.getElementById("pongDifficultyState");
const pongModeStateEl = document.getElementById("pongModeState");
const pongBallSpeedStateEl = document.getElementById("pongBallSpeedState");
const pongBestStateEl = document.getElementById("pongBestState");
const pongMessageEl = document.getElementById("pongMessage");
const pongSensStateEl = document.getElementById("pongSensState");
const pongSensDecBtn = document.getElementById("pongSensDecBtn");
const pongSensIncBtn = document.getElementById("pongSensIncBtn");

const pongStartBtn = document.getElementById("pongStartBtn");
const pongResetBtn = document.getElementById("pongResetBtn");
const pongStartOverlay = document.getElementById("pongStartOverlay");
const pongStartControlBtn = document.getElementById("pongStartControlBtn");
const pongResultOverlay = document.getElementById("pongResultOverlay");
const pongResultTitle = document.getElementById("pongResultTitle");
const pongResultText = document.getElementById("pongResultText");
const pongReplayBtn = document.getElementById("pongReplayBtn");
const difficultyButtons = document.querySelectorAll(".difficulty-btn");
const modeButtons = document.querySelectorAll(".mode-btn");

const RANKING_STORAGE_KEY = "dual-knob-pong-wins-v2";
const W = canvas.width;
const H = canvas.height;
const BALL_R = 8;
const PADDLE_MARGIN = 12;
const PADDLE_Y_MARGIN = 2;
const INPUT_WARMUP_MS = 450;
const MAX_BOUNCE_ANGLE = (75 * Math.PI) / 180;

const PADDLE_COLOR = {
  left:  { base: "#ef4444", mid: "#fb7185", dark: "#b91c1c", border: "rgba(251,113,133,0.9)", glow: "rgba(239,68,68,0.5)" },
  right: { base: "#2563eb", mid: "#60a5fa", dark: "#1d4ed8", border: "rgba(147,197,253,0.9)", glow: "rgba(59,130,246,0.5)" }
};

const ballTrail = [];

const DIFFICULTY = {
  easy: {
    label: "초급",
    winScore: 5,
    baseSpeed: 4.5,
    maxSpeed: 9,
    paddleH: 90,
    paddleW: 14,
    aiSpeed: 3.4,
    aiError: 28
  },
  normal: {
    label: "중급",
    winScore: 7,
    baseSpeed: 5.5,
    maxSpeed: 11,
    paddleH: 76,
    paddleW: 14,
    aiSpeed: 4.6,
    aiError: 14
  },
  hard: {
    label: "고급",
    winScore: 9,
    baseSpeed: 6.5,
    maxSpeed: 13,
    paddleH: 60,
    paddleW: 12,
    aiSpeed: 5.8,
    aiError: 4
  }
};

const state = {
  gameMode: "cpu",
  difficulty: "easy",
  running: false,
  paused: false,
  waitingServe: true,
  serveSide: "left",
  scoreLeft: 0,
  scoreRight: 0,
  leftPaddle: { y: H / 2 },
  rightPaddle: { y: H / 2 },
  ball: { x: W / 2, y: H / 2, vx: 0, vy: 0, speed: 0 },
  leftAccY: 0,
  rightAccY: 0,
  rafId: 0,
  lastFrameMs: 0,
  pointer: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
  mouse: { active: false, lastX: 0, lastY: 0 },
  inputWarmupUntil: 0,
  blockLaunchUntil: 0,
  autoServeAt: 0,
  aiSmoothY: H / 2,
  aiErrorOffset: 0
};

let MOUSE_MOVE_THRESHOLD = 2;
let audioCtx = null;

function cfg() {
  return DIFFICULTY[state.difficulty];
}

function isCpuMode() {
  return state.gameMode === "cpu";
}

function paddleX(side) {
  const c = cfg();
  return side === "left" ? PADDLE_MARGIN : W - PADDLE_MARGIN - c.paddleW;
}

function clampPaddleY(y) {
  const half = cfg().paddleH / 2;
  return Math.min(H - half - PADDLE_Y_MARGIN, Math.max(half + PADDLE_Y_MARGIN, y));
}

function syncInputBaseline() {
  state.leftAccY = 0;
  state.rightAccY = 0;
  state.mouse.active = false;
  state.inputWarmupUntil = performance.now() + INPUT_WARMUP_MS;
}

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function playTone(freq, durationMs, type = "square", gain = 0.06) {
  try {
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start();
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durationMs / 1000);
    osc.stop(audioCtx.currentTime + durationMs / 1000);
  } catch (_e) {
    /* audio unavailable */
  }
}

function getBestWins() {
  try {
    const raw = localStorage.getItem(RANKING_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const key = `${state.gameMode}-${state.difficulty}`;
    return typeof data[key] === "number" ? data[key] : null;
  } catch (_e) {
    return null;
  }
}

function saveBestWinIfNeeded() {
  const key = `${state.gameMode}-${state.difficulty}`;
  const best = getBestWins();
  const next = (best ?? 0) + 1;
  try {
    const raw = localStorage.getItem(RANKING_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    data[key] = next;
    localStorage.setItem(RANKING_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (_e) {
    return false;
  }
}

function placeResultDialogNearPointer() {
  const dialog = pongResultOverlay.querySelector(".dialog");
  if (!dialog || pongResultOverlay.classList.contains("hidden")) return;
  const margin = 12;
  const rect = dialog.getBoundingClientRect();
  dialog.style.position = "fixed";
  dialog.style.left = `${Math.min(Math.max(state.pointer.x - rect.width / 2, margin), window.innerWidth - rect.width - margin)}px`;
  dialog.style.top = `${Math.min(Math.max(state.pointer.y - rect.height / 2, margin), window.innerHeight - rect.height - margin)}px`;
  dialog.style.margin = "0";
}

function updateStatus() {
  const c = cfg();
  pongScoreBoardEl.textContent = `${state.scoreLeft} : ${state.scoreRight}`;
  pongGoalBoardEl.textContent = String(c.winScore);
  pongDifficultyStateEl.textContent = `Difficulty: ${c.label}`;
  pongModeStateEl.textContent = isCpuMode() ? "Mode: 1P vs CPU" : "Mode: 2P Local";
  pongBallSpeedStateEl.textContent = `Ball: ${state.ball.speed.toFixed(1)}`;
  const best = getBestWins();
  pongBestStateEl.textContent = `Wins: ${best === null ? "0" : best}`;
}

function resetMatch() {
  state.scoreLeft = 0;
  state.scoreRight = 0;
  state.leftPaddle.y = H / 2;
  state.rightPaddle.y = H / 2;
  state.aiSmoothY = H / 2;
  state.aiErrorOffset = 0;
  state.autoServeAt = 0;
  syncInputBaseline();
  resetBallForMode("left", false);
  const serveHint = isCpuMode()
    ? "좌 클릭으로 서브 · 왼쪽(당신) vs CPU"
    : "서브: 좌 클릭=왼쪽 · 우 클릭=오른쪽";
  pongMessageEl.textContent = serveHint;
}

function resetBallForMode(loser, autoServeCpu) {
  state.ball.x = loser === "left" ? W * 0.35 : W * 0.65;
  state.ball.y = H / 2;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.speed = 0;
  state.waitingServe = true;
  state.autoServeAt = 0;

  if (isCpuMode()) {
    state.serveSide = "left";
    if (autoServeCpu) {
      state.autoServeAt = performance.now() + 550;
      pongMessageEl.textContent = "득점! 잠시 후 공이 나갑니다…";
    } else {
      pongMessageEl.textContent = "좌 클릭으로 서브하세요.";
    }
  } else {
    state.serveSide = loser;
    pongMessageEl.textContent = `${loser === "left" ? "왼쪽" : "오른쪽"} 서브 — 해당 클릭`;
  }
}

function launchBall(fromSide) {
  if (!state.waitingServe || !state.running || state.paused) return;
  if (performance.now() < state.blockLaunchUntil) return;
  if (fromSide && state.serveSide !== fromSide) return;

  const c = cfg();
  const dir = state.serveSide === "left" ? 1 : -1;
  const angle = (Math.random() * 0.5 - 0.25) * Math.PI;
  state.ball.speed = c.baseSpeed;
  state.ball.vx = Math.cos(angle) * state.ball.speed * dir;
  state.ball.vy = Math.sin(angle) * state.ball.speed;
  state.waitingServe = false;
  pongMessageEl.textContent = "랠리! 패들 맞출 때마다 공이 빨라집니다.";
  playTone(440, 80);
}

/** Classic paddle bounce: hit position sets exit angle; speed ramps up. */
function bounceOffPaddle(paddleY, movingRight) {
  const c = cfg();
  const ph = c.paddleH;
  const relative = (state.ball.y - paddleY) / (ph / 2);
  const clamped = Math.max(-1, Math.min(1, relative));
  const bounceAngle = clamped * MAX_BOUNCE_ANGLE;

  state.ball.speed = Math.min(c.maxSpeed, state.ball.speed + 0.45);
  const dir = movingRight ? 1 : -1;
  state.ball.vx = Math.cos(bounceAngle) * state.ball.speed * dir;
  state.ball.vy = Math.sin(bounceAngle) * state.ball.speed;

  playTone(220 + Math.abs(clamped) * 120, 50, "square", 0.05);
}

function consumeMouseMoveDelta(dx, dy) {
  if (!state.running || state.paused) return;
  if (performance.now() < state.inputWarmupUntil) return;

  state.leftAccY += dy;
  if (!isCpuMode()) state.rightAccY += dx;

  while (Math.abs(state.leftAccY) >= MOUSE_MOVE_THRESHOLD) {
    const step = state.leftAccY > 0 ? MOUSE_MOVE_THRESHOLD : -MOUSE_MOVE_THRESHOLD;
    state.leftPaddle.y = clampPaddleY(state.leftPaddle.y + step);
    state.leftAccY -= step;
  }

  while (Math.abs(state.rightAccY) >= MOUSE_MOVE_THRESHOLD) {
    const step = state.rightAccY > 0 ? MOUSE_MOVE_THRESHOLD : -MOUSE_MOVE_THRESHOLD;
    state.rightPaddle.y = clampPaddleY(state.rightPaddle.y + step);
    state.rightAccY -= step;
  }
}

function updateAi() {
  if (!isCpuMode()) return;
  if (!Number.isFinite(state.aiSmoothY)) state.aiSmoothY = H / 2;
  const c = cfg();

  if (state.waitingServe) {
    const center = H / 2;
    state.aiSmoothY += (center - state.aiSmoothY) * 0.14;
    state.rightPaddle.y += (state.aiSmoothY - state.rightPaddle.y) * 0.2;
    return;
  }

  if (Math.random() < 0.025) {
    state.aiErrorOffset = (Math.random() - 0.5) * c.aiError;
  }
  const targetY = state.ball.y + state.aiErrorOffset;
  state.aiSmoothY += (targetY - state.aiSmoothY) * 0.16;
  const diff = state.aiSmoothY - state.rightPaddle.y;
  const step = Math.sign(diff) * Math.min(Math.abs(diff), c.aiSpeed);
  state.rightPaddle.y = clampPaddleY(state.rightPaddle.y + step);
}

function paddleBounds(side) {
  const c = cfg();
  const py = side === "left" ? state.leftPaddle.y : state.rightPaddle.y;
  const px = paddleX(side);
  return {
    x: px,
    y: py - c.paddleH / 2,
    w: c.paddleW,
    h: c.paddleH,
    cy: py
  };
}

function tryPaddleHit(side) {
  const pad = paddleBounds(side);
  const { x: bx, y: by } = state.ball;
  const r = BALL_R;

  if (by + r < pad.y || by - r > pad.y + pad.h) return false;

  if (side === "left") {
    if (state.ball.vx >= 0) return false;
    if (bx - r > pad.x + pad.w + 4) return false;
    state.ball.x = pad.x + pad.w + r;
    bounceOffPaddle(pad.cy, true);
    return true;
  }

  if (state.ball.vx <= 0) return false;
  if (bx + r < pad.x - 4) return false;
  state.ball.x = pad.x - r;
  bounceOffPaddle(pad.cy, false);
  return true;
}

function updateBall(dt) {
  if (state.waitingServe || state.paused) return;

  const scale = dt / 16.67;
  const steps = Math.max(1, Math.ceil(Math.hypot(state.ball.vx, state.ball.vy) * scale / 12));
  const stepScale = scale / steps;

  for (let i = 0; i < steps; i += 1) {
    state.ball.x += state.ball.vx * stepScale;
    state.ball.y += state.ball.vy * stepScale;

    const r = BALL_R;
    if (state.ball.y - r <= 0) {
      state.ball.y = r;
      state.ball.vy = Math.abs(state.ball.vy);
      playTone(160, 40, "sine", 0.04);
    }
    if (state.ball.y + r >= H) {
      state.ball.y = H - r;
      state.ball.vy = -Math.abs(state.ball.vy);
      playTone(160, 40, "sine", 0.04);
    }

    tryPaddleHit("left");
    tryPaddleHit("right");
  }

  if (state.ball.x < -BALL_R) {
    scorePoint("right");
  } else if (state.ball.x > W + BALL_R) {
    scorePoint("left");
  }
}

function scorePoint(winner) {
  if (winner === "left") state.scoreLeft += 1;
  else state.scoreRight += 1;
  playTone(90, 180, "sawtooth", 0.07);

  const c = cfg();
  if (state.scoreLeft >= c.winScore || state.scoreRight >= c.winScore) {
    endMatch(winner);
    return;
  }

  const loser = winner === "left" ? "right" : "left";
  if (isCpuMode()) {
    state.aiSmoothY = H / 2;
    state.aiErrorOffset = 0;
    state.rightPaddle.y = H / 2;
    syncInputBaseline();
    resetBallForMode(loser, loser === "right");
  } else {
    resetBallForMode(loser, false);
    pongMessageEl.textContent = `${winner === "left" ? "왼쪽" : "오른쪽"} 득점! 서브하세요.`;
  }
  updateStatus();
}

function endMatch(winner) {
  state.running = false;
  cancelAnimationFrame(state.rafId);

  const leftWon = winner === "left";
  pongResultTitle.textContent = leftWon ? "LEFT WINS" : "RIGHT WINS";
  let extra = "";
  if (isCpuMode() && leftWon) {
    extra = saveBestWinIfNeeded() ? " (신기록!)" : "";
  }
  pongResultText.textContent = `최종 ${state.scoreLeft} : ${state.scoreRight}${extra}`;
  pongResultOverlay.classList.remove("hidden");
  requestAnimationFrame(placeResultDialogNearPointer);
  pongMessageEl.textContent = "매치 종료!";
  playTone(leftWon ? 523 : 196, 300, "square", 0.08);
  updateStatus();
  draw();
}

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function draw() {
  // ── Background ────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#05080f");
  bg.addColorStop(1, "#0b1120");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Vignette
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ── Center divider ────────────────────────────────────────
  ctx.save();
  ctx.setLineDash([8, 14]);
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.restore();

  // ── Score ─────────────────────────────────────────────────
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "bold 48px 'Courier New', Courier, monospace";
  // Shadow for depth
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 10;
  ctx.fillStyle = PADDLE_COLOR.left.mid;
  ctx.fillText(String(state.scoreLeft), W / 2 - 52, 14);
  ctx.fillStyle = PADDLE_COLOR.right.mid;
  ctx.fillText(String(state.scoreRight), W / 2 + 52, 14);
  ctx.restore();

  // ── Paddles ───────────────────────────────────────────────
  drawKnobPaddle("left");
  drawKnobPaddle("right");

  // ── Ball ─────────────────────────────────────────────────
  if (state.running) {
    // Trail
    for (let i = 0; i < ballTrail.length; i++) {
      const t = ballTrail[i];
      const pct = i / ballTrail.length;
      ctx.globalAlpha = pct * 0.28;
      ctx.fillStyle = "#cbd5e1";
      ctx.beginPath();
      ctx.arc(t.x, t.y, BALL_R * (0.4 + pct * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Outer glow
    const glow = ctx.createRadialGradient(
      state.ball.x, state.ball.y, 0,
      state.ball.x, state.ball.y, BALL_R * 3.5
    );
    glow.addColorStop(0, "rgba(255,255,255,0.22)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y, BALL_R * 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Ball body
    const ballGrad = ctx.createRadialGradient(
      state.ball.x - BALL_R * 0.35, state.ball.y - BALL_R * 0.35, 0,
      state.ball.x, state.ball.y, BALL_R
    );
    ballGrad.addColorStop(0, "#ffffff");
    ballGrad.addColorStop(0.6, "#e2e8f0");
    ballGrad.addColorStop(1, "#94a3b8");
    ctx.fillStyle = ballGrad;
    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Serve hint ───────────────────────────────────────────
  if (state.waitingServe && state.running) {
    const who = isCpuMode() ? "LEFT" : state.serveSide === "left" ? "LEFT" : "RIGHT";
    const col = who === "LEFT" ? PADDLE_COLOR.left.mid : PADDLE_COLOR.right.mid;
    const hint = isCpuMode()
      ? state.autoServeAt
        ? "SERVE…"
        : "좌 클릭 서브"
      : `SERVE · ${who}  클릭`;
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "600 13px Inter, sans-serif";
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.85;
    ctx.fillText(hint, W / 2, H / 2 + 32);
    ctx.restore();
  }

  // ── Pause overlay ────────────────────────────────────────
  if (state.paused) {
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 28px Inter, sans-serif";
    ctx.fillStyle = "#f1f5f9";
    ctx.shadowColor = "rgba(129,140,248,0.6)";
    ctx.shadowBlur = 16;
    ctx.fillText("PAUSED", W / 2, H / 2);
    ctx.restore();
  }
}

function drawKnobPaddle(side) {
  const c = cfg();
  const col = PADDLE_COLOR[side];
  const x = paddleX(side);
  const y = side === "left" ? state.leftPaddle.y : state.rightPaddle.y;
  const pw = c.paddleW;
  const ph = c.paddleH;
  const rx = Math.min(8, pw / 2);
  const ty = y - ph / 2;

  // Outer glow halo
  const halo = ctx.createRadialGradient(x + pw / 2, y, 0, x + pw / 2, y, ph * 0.9);
  halo.addColorStop(0, col.glow);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(x - pw, y - ph, pw * 3, ph * 2);

  // Body gradient (left→right shine)
  const bodyGrad = ctx.createLinearGradient(x, ty, x + pw, ty);
  bodyGrad.addColorStop(0, col.dark);
  bodyGrad.addColorStop(0.35, col.mid);
  bodyGrad.addColorStop(1, col.base);
  ctx.fillStyle = bodyGrad;
  roundRect(x, ty, pw, ph, rx);
  ctx.fill();

  // Top highlight sheen
  const sheenH = Math.floor(ph * 0.45);
  const sheenGrad = ctx.createLinearGradient(x, ty, x, ty + sheenH);
  sheenGrad.addColorStop(0, "rgba(255,255,255,0.30)");
  sheenGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheenGrad;
  ctx.beginPath();
  ctx.moveTo(x + rx, ty + 2);
  ctx.lineTo(x + pw - rx, ty + 2);
  ctx.quadraticCurveTo(x + pw - 2, ty + 2, x + pw - 2, ty + 2 + rx);
  ctx.lineTo(x + pw - 2, ty + sheenH);
  ctx.lineTo(x + 2, ty + sheenH);
  ctx.lineTo(x + 2, ty + 2 + rx);
  ctx.quadraticCurveTo(x + 2, ty + 2, x + rx, ty + 2);
  ctx.closePath();
  ctx.fill();

  // Edge border
  ctx.strokeStyle = col.border;
  ctx.lineWidth = 1.5;
  roundRect(x, ty, pw, ph, rx);
  ctx.stroke();

  // Notch lines (knob grip marks)
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  const notchCount = 4;
  for (let i = 1; i <= notchCount; i++) {
    const ny = ty + (ph / (notchCount + 1)) * i;
    ctx.beginPath();
    ctx.moveTo(x + 3, ny);
    ctx.lineTo(x + pw - 3, ny);
    ctx.stroke();
  }

  // CPU label
  if (isCpuMode() && side === "right") {
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "bold 8px Inter, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("CPU", x + pw / 2, y + 3);
    ctx.restore();
  }
}

function frame(ts) {
  if (!state.running) return;

  if (state.paused) {
    draw();
    state.rafId = requestAnimationFrame(frame);
    return;
  }

  if (!state.lastFrameMs) state.lastFrameMs = ts;
  const dt = Math.min(48, ts - state.lastFrameMs);
  state.lastFrameMs = ts;

  if (isCpuMode() && state.autoServeAt && performance.now() >= state.autoServeAt) {
    state.autoServeAt = 0;
    launchBall("left");
  }

  updateAi();
  updateBall(dt);
  // Ball trail
  if (!state.waitingServe) {
    ballTrail.push({ x: state.ball.x, y: state.ball.y });
    if (ballTrail.length > 8) ballTrail.shift();
  } else {
    ballTrail.length = 0;
  }
  draw();
  updateStatus();
  state.rafId = requestAnimationFrame(frame);
}

function startGame() {
  resetMatch();
  state.running = true;
  state.paused = false;
  state.lastFrameMs = 0;
  state.blockLaunchUntil = performance.now() + 400;
  syncInputBaseline();
  pongStartOverlay.classList.add("hidden");
  pongResultOverlay.classList.add("hidden");
  updateStatus();
  draw();
  state.rafId = requestAnimationFrame(frame);
}

function togglePause() {
  if (!state.running) return;
  state.paused = !state.paused;
  pongMessageEl.textContent = state.paused ? "일시정지 (중클릭 재개)" : "재개!";
  if (!state.paused) {
    state.lastFrameMs = 0;
    state.rafId = requestAnimationFrame(frame);
  }
  draw();
}

function openStartOverlay() {
  state.running = false;
  state.paused = false;
  cancelAnimationFrame(state.rafId);
  pongStartOverlay.classList.remove("hidden");
  pongResultOverlay.classList.add("hidden");
  pongMessageEl.textContent = "모드와 난이도를 선택하세요.";
  resetMatch();
  draw();
  updateStatus();
}

function updateSensStatus() {
  pongSensStateEl.textContent = `${MOUSE_MOVE_THRESHOLD}px/틱`;
}

window.addEventListener("mousemove", (event) => {
  state.pointer.x = event.clientX;
  state.pointer.y = event.clientY;
  if (!state.running || state.paused || performance.now() < state.inputWarmupUntil) {
    state.mouse.lastX = event.clientX;
    state.mouse.lastY = event.clientY;
    state.mouse.active = true;
    return;
  }
  if (!state.mouse.active) {
    state.mouse.active = true;
    state.mouse.lastX = event.clientX;
    state.mouse.lastY = event.clientY;
    return;
  }
  const dx = event.clientX - state.mouse.lastX;
  const dy = event.clientY - state.mouse.lastY;
  state.mouse.lastX = event.clientX;
  state.mouse.lastY = event.clientY;
  consumeMouseMoveDelta(dx, dy);
});

window.addEventListener("mousedown", (event) => {
  if (!state.running) return;
  if (event.button === 0) {
    launchBall("left");
    return;
  }
  if (event.button === 2) {
    event.preventDefault();
    if (!isCpuMode()) launchBall("right");
    return;
  }
  if (event.button === 1 || event.buttons === 3) {
    event.preventDefault();
    togglePause();
  }
});

window.addEventListener("contextmenu", (event) => {
  if (state.running) event.preventDefault();
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    modeButtons.forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    state.gameMode = button.dataset.mode;
    updateStatus();
  });
});

difficultyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    difficultyButtons.forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    state.difficulty = button.dataset.difficulty;
    updateStatus();
  });
});

pongStartControlBtn.addEventListener("click", () => startGame());
pongStartBtn.addEventListener("click", () => openStartOverlay());
pongResetBtn.addEventListener("click", () => {
  if (state.running) startGame();
  else openStartOverlay();
});
pongReplayBtn.addEventListener("click", () => {
  pongResultOverlay.classList.add("hidden");
  openStartOverlay();
});

pongSensDecBtn.addEventListener("click", () => {
  MOUSE_MOVE_THRESHOLD = Math.max(1, MOUSE_MOVE_THRESHOLD - 1);
  updateSensStatus();
});
pongSensIncBtn.addEventListener("click", () => {
  MOUSE_MOVE_THRESHOLD = Math.min(24, MOUSE_MOVE_THRESHOLD + 1);
  updateSensStatus();
});

modeButtons[0].classList.add("active");
difficultyButtons[1].classList.add("active");
state.difficulty = "normal";
updateSensStatus();
openStartOverlay();
