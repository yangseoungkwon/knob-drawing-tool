const canvas = document.getElementById("dodgeCanvas");
const ctx = canvas.getContext("2d");

const dodgeTimeBoardEl = document.getElementById("dodgeTimeBoard");
const dodgeScoreBoardEl = document.getElementById("dodgeScoreBoard");
const dodgeDifficultyStateEl = document.getElementById("dodgeDifficultyState");
const dodgeDodgedStateEl = document.getElementById("dodgeDodgedState");
const dodgeShieldStateEl = document.getElementById("dodgeShieldState");
const dodgeBestStateEl = document.getElementById("dodgeBestState");
const dodgeMessageEl = document.getElementById("dodgeMessage");
const dodgeSensStateEl = document.getElementById("dodgeSensState");
const dodgeSensDecBtn = document.getElementById("dodgeSensDecBtn");
const dodgeSensIncBtn = document.getElementById("dodgeSensIncBtn");

const dodgeStartBtn = document.getElementById("dodgeStartBtn");
const dodgeResetBtn = document.getElementById("dodgeResetBtn");
const dodgeStartOverlay = document.getElementById("dodgeStartOverlay");
const dodgeStartControlBtn = document.getElementById("dodgeStartControlBtn");
const dodgeResultOverlay = document.getElementById("dodgeResultOverlay");
const dodgeResultTitle = document.getElementById("dodgeResultTitle");
const dodgeResultText = document.getElementById("dodgeResultText");
const dodgeReplayBtn = document.getElementById("dodgeReplayBtn");
const difficultyButtons = document.querySelectorAll(".difficulty-btn");

const RANKING_STORAGE_KEY = "dual-knob-dodge-best-v1";
const W = canvas.width;
const H = canvas.height;

const DIFFICULTY = {
  easy: {
    label: "초급",
    durationMs: 30000,
    fallSpeed: 2.4,
    spawnMs: 1050,
    obsW: 44,
    obsH: 26,
    shieldMs: 1400,
    shieldCooldownMs: 4500
  },
  normal: {
    label: "중급",
    durationMs: 45000,
    fallSpeed: 3.5,
    spawnMs: 780,
    obsW: 54,
    obsH: 30,
    shieldMs: 1200,
    shieldCooldownMs: 5200
  },
  hard: {
    label: "고급",
    durationMs: 60000,
    fallSpeed: 4.8,
    spawnMs: 520,
    obsW: 64,
    obsH: 36,
    shieldMs: 1000,
    shieldCooldownMs: 6000
  }
};

const state = {
  difficulty: "easy",
  running: false,
  paused: false,
  player: { x: W / 2, y: H - 72, r: 14 },
  obstacles: [],
  accX: 0,
  accY: 0,
  score: 0,
  dodged: 0,
  elapsedMs: 0,
  startMs: 0,
  pauseAccumMs: 0,
  pauseStartedMs: 0,
  spawnTimerMs: 0,
  shieldUntilMs: 0,
  shieldReadyMs: 0,
  rafId: 0,
  lastFrameMs: 0,
  pointer: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
  mouse: { active: false, lastX: 0, lastY: 0 }
};

let MOUSE_MOVE_THRESHOLD = 2;

function cfg() {
  return DIFFICULTY[state.difficulty];
}

function formatTime(ms) {
  const totalSec = Math.max(0, ms) / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  const tenth = Math.floor((totalSec % 1) * 10);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${tenth}`;
}

function nowMs() {
  if (!state.running || state.paused) return state.elapsedMs;
  return performance.now() - state.startMs - state.pauseAccumMs;
}

function remainingMs() {
  return Math.max(0, cfg().durationMs - nowMs());
}

function getBestScore() {
  try {
    const raw = localStorage.getItem(RANKING_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return typeof data[state.difficulty] === "number" ? data[state.difficulty] : null;
  } catch (_e) {
    return null;
  }
}

function saveBestIfNeeded() {
  const best = getBestScore();
  if (best !== null && state.score <= best) return false;
  try {
    const raw = localStorage.getItem(RANKING_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    data[state.difficulty] = state.score;
    localStorage.setItem(RANKING_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (_e) {
    return false;
  }
}

function placeResultDialogNearPointer() {
  const dialog = dodgeResultOverlay.querySelector(".dialog");
  if (!dialog || dodgeResultOverlay.classList.contains("hidden")) return;
  const margin = 12;
  const rect = dialog.getBoundingClientRect();
  dialog.style.position = "fixed";
  dialog.style.left = `${Math.min(Math.max(state.pointer.x - rect.width / 2, margin), window.innerWidth - rect.width - margin)}px`;
  dialog.style.top = `${Math.min(Math.max(state.pointer.y - rect.height / 2, margin), window.innerHeight - rect.height - margin)}px`;
  dialog.style.margin = "0";
}

function updateStatus() {
  const c = cfg();
  dodgeTimeBoardEl.textContent = formatTime(remainingMs());
  dodgeScoreBoardEl.textContent = String(state.score);
  dodgeDifficultyStateEl.textContent = `Difficulty: ${c.label}`;
  dodgeDodgedStateEl.textContent = `Dodged: ${state.dodged}`;
  const now = performance.now();
  if (now < state.shieldUntilMs) {
    dodgeShieldStateEl.textContent = "Shield: ON";
  } else if (now < state.shieldReadyMs) {
    dodgeShieldStateEl.textContent = `Shield: ${Math.ceil((state.shieldReadyMs - now) / 1000)}s`;
  } else {
    dodgeShieldStateEl.textContent = "Shield: READY";
  }
  const best = getBestScore();
  dodgeBestStateEl.textContent = `Best(${c.label}): ${best === null ? "-" : best}`;
}

function resetRound() {
  state.player.x = W / 2;
  state.player.y = H - 72;
  state.obstacles = [];
  state.accX = 0;
  state.accY = 0;
  state.score = 0;
  state.dodged = 0;
  state.elapsedMs = 0;
  state.pauseAccumMs = 0;
  state.spawnTimerMs = 0;
  state.shieldUntilMs = 0;
  state.shieldReadyMs = 0;
  state.lastFrameMs = 0;
  dodgeMessageEl.textContent = "장애물을 피해 제한 시간까지 버티세요!";
}

function spawnObstacle() {
  const c = cfg();
  const margin = 12;
  const w = c.obsW + Math.floor(Math.random() * 24);
  state.obstacles.push({
    x: margin + Math.random() * (W - margin * 2 - w),
    y: -c.obsH - 8,
    w,
    h: c.obsH,
    speed: c.fallSpeed + Math.random() * 1.2,
    hue: 350 + Math.floor(Math.random() * 30)
  });
}

function circleRectHit(px, py, pr, rx, ry, rw, rh) {
  const cx = Math.min(Math.max(px, rx), rx + rw);
  const cy = Math.min(Math.max(py, ry), ry + rh);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= pr * pr;
}

function tryShield() {
  if (!state.running || state.paused) return;
  const now = performance.now();
  if (now < state.shieldReadyMs) return;
  const c = cfg();
  state.shieldUntilMs = now + c.shieldMs;
  state.shieldReadyMs = now + c.shieldCooldownMs;
  dodgeMessageEl.textContent = "실드 발동!";
}

function consumeMouseMoveDelta(dx, dy) {
  if (!state.running || state.paused) return;
  state.accX += dx;
  state.accY += dy;
  const pad = state.player.r + 4;
  while (Math.abs(state.accX) >= MOUSE_MOVE_THRESHOLD || Math.abs(state.accY) >= MOUSE_MOVE_THRESHOLD) {
    if (Math.abs(state.accX) >= Math.abs(state.accY)) {
      const step = state.accX > 0 ? MOUSE_MOVE_THRESHOLD : -MOUSE_MOVE_THRESHOLD;
      state.player.x = Math.min(W - pad, Math.max(pad, state.player.x + step));
      state.accX -= step;
    } else {
      const step = state.accY > 0 ? MOUSE_MOVE_THRESHOLD : -MOUSE_MOVE_THRESHOLD;
      state.player.y = Math.min(H - pad, Math.max(pad, state.player.y + step));
      state.accY -= step;
    }
  }
}

function updateGame(dt) {
  const c = cfg();
  state.spawnTimerMs += dt;
  if (state.spawnTimerMs >= c.spawnMs) {
    state.spawnTimerMs = 0;
    spawnObstacle();
  }

  const shieldOn = performance.now() < state.shieldUntilMs;
  const next = [];

  for (const obs of state.obstacles) {
    obs.y += obs.speed * (dt / 16.67);
    if (obs.y > H + obs.h) {
      state.dodged += 1;
      state.score += 25;
      continue;
    }
    if (
      !shieldOn &&
      circleRectHit(state.player.x, state.player.y, state.player.r, obs.x, obs.y, obs.w, obs.h)
    ) {
      endGame(false);
      return;
    }
    next.push(obs);
  }
  state.obstacles = next;
  state.score += Math.floor(dt / 50);
  state.elapsedMs = nowMs();
  if (state.elapsedMs >= c.durationMs) endGame(true);
}

function roundRect(context, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function draw() {
  const shieldOn = performance.now() < state.shieldUntilMs;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#0b1224");
  grad.addColorStop(1, "#050a14");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  for (const obs of state.obstacles) {
    ctx.fillStyle = `hsl(${obs.hue} 85% 58%)`;
    ctx.shadowColor = "rgba(248, 113, 113, 0.45)";
    ctx.shadowBlur = 10;
    roundRect(ctx, obs.x, obs.y, obs.w, obs.h, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  const { x, y, r } = state.player;
  if (shieldOn) {
    ctx.beginPath();
    ctx.arc(x, y, r + 10, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(129, 140, 248, 0.85)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  const playerGrad = ctx.createRadialGradient(x, y, 2, x, y, r);
  playerGrad.addColorStop(0, "#e0e7ff");
  playerGrad.addColorStop(1, shieldOn ? "#6366f1" : "#38bdf8");
  ctx.fillStyle = playerGrad;
  ctx.shadowColor = shieldOn ? "rgba(99, 102, 241, 0.8)" : "rgba(56, 189, 248, 0.7)";
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  if (state.paused) {
    ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "700 28px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", W / 2, H / 2);
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
  updateGame(dt);
  if (!state.running) return;
  draw();
  updateStatus();
  state.rafId = requestAnimationFrame(frame);
}

function endGame(cleared) {
  state.running = false;
  cancelAnimationFrame(state.rafId);
  const isNew = cleared && saveBestIfNeeded();
  dodgeResultTitle.textContent = cleared ? "CLEAR" : "GAME OVER";
  dodgeResultText.textContent = cleared
    ? `생존 성공! 점수 ${state.score} / 회피 ${state.dodged}회${isNew ? " (신기록!)" : ""}`
    : `충돌! 점수 ${state.score} / 회피 ${state.dodged}회`;
  dodgeResultOverlay.classList.remove("hidden");
  requestAnimationFrame(placeResultDialogNearPointer);
  dodgeMessageEl.textContent = cleared ? "클리어!" : "장애물에 닿았습니다.";
  updateStatus();
  draw();
}

function startGame() {
  resetRound();
  state.running = true;
  state.paused = false;
  state.startMs = performance.now();
  state.lastFrameMs = 0;
  dodgeStartOverlay.classList.add("hidden");
  dodgeResultOverlay.classList.add("hidden");
  updateStatus();
  draw();
  state.rafId = requestAnimationFrame(frame);
}

function togglePause() {
  if (!state.running) return;
  if (!state.paused) {
    state.elapsedMs = nowMs();
    state.paused = true;
    state.pauseStartedMs = performance.now();
    dodgeMessageEl.textContent = "일시정지 (중클릭 재개)";
  } else {
    state.paused = false;
    state.pauseAccumMs += performance.now() - state.pauseStartedMs;
    state.lastFrameMs = 0;
    dodgeMessageEl.textContent = "재개!";
    state.rafId = requestAnimationFrame(frame);
  }
  draw();
}

function openStartOverlay() {
  state.running = false;
  state.paused = false;
  cancelAnimationFrame(state.rafId);
  dodgeStartOverlay.classList.remove("hidden");
  dodgeResultOverlay.classList.add("hidden");
  dodgeMessageEl.textContent = "난이도를 선택하고 시작하세요.";
  resetRound();
  draw();
  updateStatus();
}

function updateSensStatus() {
  dodgeSensStateEl.textContent = `${MOUSE_MOVE_THRESHOLD}px/틱`;
}

window.addEventListener("mousemove", (event) => {
  state.pointer.x = event.clientX;
  state.pointer.y = event.clientY;
  if (!state.running || state.paused) {
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
  if (event.button === 2) {
    event.preventDefault();
    tryShield();
    return;
  }
  if (event.button === 1 || event.buttons === 3) {
    event.preventDefault();
    togglePause();
  }
});

window.addEventListener("contextmenu", (e) => {
  if (state.running) e.preventDefault();
});

difficultyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    difficultyButtons.forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    state.difficulty = button.dataset.difficulty;
    updateStatus();
  });
});

dodgeStartControlBtn.addEventListener("click", () => startGame());
dodgeStartBtn.addEventListener("click", () => openStartOverlay());
dodgeResetBtn.addEventListener("click", () => {
  if (state.running) startGame();
  else openStartOverlay();
});
dodgeReplayBtn.addEventListener("click", () => {
  dodgeResultOverlay.classList.add("hidden");
  openStartOverlay();
});
dodgeSensDecBtn.addEventListener("click", () => {
  MOUSE_MOVE_THRESHOLD = Math.max(1, MOUSE_MOVE_THRESHOLD - 1);
  updateSensStatus();
});
dodgeSensIncBtn.addEventListener("click", () => {
  MOUSE_MOVE_THRESHOLD = Math.min(24, MOUSE_MOVE_THRESHOLD + 1);
  updateSensStatus();
});

difficultyButtons[0].classList.add("active");
updateSensStatus();
openStartOverlay();
