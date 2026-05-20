/**
 * Knob Pinball — dual-knob flippers (left=Y, right=X), HTML5 Canvas physics.
 */
const canvas = document.getElementById("pinballCanvas");
const ctx = canvas.getContext("2d");

const pinballScoreBoardEl = document.getElementById("pinballScoreBoard");
const pinballGoalBoardEl = document.getElementById("pinballGoalBoard");
const pinballDifficultyStateEl = document.getElementById("pinballDifficultyState");
const pinballLivesStateEl = document.getElementById("pinballLivesState");
const pinballBestStateEl = document.getElementById("pinballBestState");
const pinballMessageEl = document.getElementById("pinballMessage");
const pinballSensStateEl = document.getElementById("pinballSensState");
const pinballSensDecBtn = document.getElementById("pinballSensDecBtn");
const pinballSensIncBtn = document.getElementById("pinballSensIncBtn");

const pinballStartBtn = document.getElementById("pinballStartBtn");
const pinballResetBtn = document.getElementById("pinballResetBtn");
const pinballStartOverlay = document.getElementById("pinballStartOverlay");
const pinballStartControlBtn = document.getElementById("pinballStartControlBtn");
const pinballResultOverlay = document.getElementById("pinballResultOverlay");
const pinballResultTitle = document.getElementById("pinballResultTitle");
const pinballResultText = document.getElementById("pinballResultText");
const pinballReplayBtn = document.getElementById("pinballReplayBtn");
const difficultyButtons = document.querySelectorAll(".difficulty-btn");

const RANKING_STORAGE_KEY = "dual-knob-pinball-best-v1";
const W = canvas.width;
const H = canvas.height;
const BALL_R = 10;
const LAUNCH_X = W / 2;
const LAUNCH_Y = 65;
const DRAIN_X1 = 265;
const DRAIN_X2 = 375;

const DIFFICULTY = {
  easy: { label: "초급", targetScore: 5000, gravity: 0.16, bumpMult: 1.0 },
  normal: { label: "중급", targetScore: 10000, gravity: 0.18, bumpMult: 1.08 },
  hard: { label: "고급", targetScore: 15000, gravity: 0.2, bumpMult: 1.15 }
};

/** @type {[number, number, number, number][]} x1,y1,x2,y2 */
const WALLS = [
  [24,  24,  616, 24],    // top
  [24,  24,  24,  490],   // left outer vertical
  [616, 24,  616, 490],   // right outer vertical
  [24,  490, 155, 620],   // left angled guide → flipper pivot
  [616, 490, 485, 620],   // right angled guide → flipper pivot
  [155, 620, DRAIN_X1, H],  // left lower → drain left edge
  [485, 620, DRAIN_X2, H],  // right lower → drain right edge
];

const BUMPERS = [
  { x: 320, y: 140, r: 28, score: 100, hue: 45 },
  { x: 185, y: 225, r: 22, score:  50, hue: 320 },
  { x: 455, y: 225, r: 22, score:  50, hue: 200 },
  { x: 258, y: 330, r: 20, score:  80, hue: 120 },
  { x: 382, y: 330, r: 20, score:  80, hue:  15 },
  { x: 320, y: 425, r: 18, score:  60, hue: 280 },
];

const TARGETS = [
  { x:  60, y: 130, w: 14, h: 50, score: 200, lit: false },
  { x: 566, y: 130, w: 14, h: 50, score: 200, lit: false },
  { x: 313, y: 490, w: 14, h: 36, score: 150, lit: false },
];

const LEFT_FLIPPER  = { px: 155, py: 620, len: 130, rest:  0.40,          fire: -0.55 };
const RIGHT_FLIPPER = { px: 485, py: 620, len: 130, rest: Math.PI - 0.40, fire: Math.PI + 0.55 };

const state = {
  difficulty: "easy",
  running: false,
  paused: false,
  score: 0,
  lives: 3,
  ball: { x: LAUNCH_X, y: LAUNCH_Y, vx: 0, vy: 0, active: false },
  leftPress: 0,
  rightPress: 0,
  leftAngle: LEFT_FLIPPER.rest,
  rightAngle: RIGHT_FLIPPER.rest,
  leftAcc: 0,
  rightAcc: 0,
  nudgeCooldown: 0,
  rafId: 0,
  lastFrameMs: 0,
  pointer: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
  mouse: { active: false, lastX: 0, lastY: 0 }
};

let MOUSE_MOVE_THRESHOLD = 1;
let audioCtx = null;

function cfg() {
  return DIFFICULTY[state.difficulty];
}

function flipperEndpoints(flip, angle) {
  const x2 = flip.px + Math.cos(angle) * flip.len;
  const y2 = flip.py + Math.sin(angle) * flip.len;
  return { x1: flip.px, y1: flip.py, x2, y2 };
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

function playTone(freq, durationMs, type = "square", gain = 0.05) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
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
    /* noop */
  }
}

function placeResultDialogNearPointer() {
  const dialog = pinballResultOverlay.querySelector(".dialog");
  if (!dialog || pinballResultOverlay.classList.contains("hidden")) return;
  const margin = 12;
  const rect = dialog.getBoundingClientRect();
  dialog.style.position = "fixed";
  dialog.style.left = `${Math.min(Math.max(state.pointer.x - rect.width / 2, margin), window.innerWidth - rect.width - margin)}px`;
  dialog.style.top = `${Math.min(Math.max(state.pointer.y - rect.height / 2, margin), window.innerHeight - rect.height - margin)}px`;
  dialog.style.margin = "0";
}

function livesHearts(n) {
  return "♥".repeat(n) + "♡".repeat(Math.max(0, 3 - n));
}

function updateStatus() {
  const c = cfg();
  pinballScoreBoardEl.textContent = String(state.score);
  pinballGoalBoardEl.textContent = `${c.targetScore} · ${livesHearts(state.lives)}`;
  pinballDifficultyStateEl.textContent = `Difficulty: ${c.label}`;
  pinballLivesStateEl.textContent = `Lives: ${state.lives}`;
  const best = getBestScore();
  pinballBestStateEl.textContent = `Best(${c.label}): ${best === null ? "-" : best}`;
}

function resetTargets() {
  TARGETS.forEach((t) => {
    t.lit = false;
  });
}

function resetBall() {
  state.ball.x = LAUNCH_X;
  state.ball.y = LAUNCH_Y;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.active = false;
}

function resetRound() {
  state.score = 0;
  state.lives = 3;
  state.leftPress = 0;
  state.rightPress = 0;
  state.leftAngle = LEFT_FLIPPER.rest;
  state.rightAngle = RIGHT_FLIPPER.rest;
  state.nudgeCooldown = 0;
  resetTargets();
  resetBall();
  pinballMessageEl.textContent = "좌 클릭으로 공을 떨어뜨리세요!";
}

function addScore(pts) {
  state.score += pts;
  if (state.score >= cfg().targetScore) {
    endGame(true);
  }
}

function reflectVelocity(nx, ny, bounce = 0.92) {
  const { vx, vy } = state.ball;
  const dot = vx * nx + vy * ny;
  state.ball.vx = (vx - 2 * dot * nx) * bounce;
  state.ball.vy = (vy - 2 * dot * ny) * bounce;
}

function circleSegmentCollision(cx, cy, r, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return null;
  let t = ((cx - x1) * dx + (cy - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  const distX = cx - px;
  const distY = cy - py;
  const dist = Math.hypot(distX, distY);
  if (dist >= r) return null;
  const nx = dist > 0.001 ? distX / dist : 0;
  const ny = dist > 0.001 ? distY / dist : -1;
  return { nx, ny, overlap: r - dist, px, py };
}

function resolveWallCollision() {
  for (const wall of WALLS) {
    const hit = circleSegmentCollision(
      state.ball.x,
      state.ball.y,
      BALL_R,
      wall[0],
      wall[1],
      wall[2],
      wall[3]
    );
    if (!hit) continue;
    state.ball.x += hit.nx * hit.overlap;
    state.ball.y += hit.ny * hit.overlap;
    reflectVelocity(hit.nx, hit.ny, 0.88);
    return true;
  }
  return false;
}

function resolveFlipperCollision(flip, angle, extraBounce) {
  const seg = flipperEndpoints(flip, angle);
  const hit = circleSegmentCollision(
    state.ball.x,
    state.ball.y,
    BALL_R,
    seg.x1,
    seg.y1,
    seg.x2,
    seg.y2
  );
  if (!hit) return false;
  state.ball.x += hit.nx * hit.overlap;
  state.ball.y += hit.ny * hit.overlap;
  reflectVelocity(hit.nx, hit.ny, 0.85);
  const speed = Math.hypot(state.ball.vx, state.ball.vy);
  const boost = 2 + extraBounce * 4;
  if (speed < boost) {
    const s = boost / (speed || 0.001);
    state.ball.vx *= s;
    state.ball.vy *= s;
  }
  playTone(180 + extraBounce * 80, 40, "square", 0.04);
  return true;
}

function resolveBumperCollision(bumper) {
  const dx = state.ball.x - bumper.x;
  const dy = state.ball.y - bumper.y;
  const dist = Math.hypot(dx, dy);
  const minDist = BALL_R + bumper.r;
  if (dist >= minDist) return false;
  const nx = dist > 0.001 ? dx / dist : 1;
  const ny = dist > 0.001 ? dy / dist : 0;
  state.ball.x = bumper.x + nx * minDist;
  state.ball.y = bumper.y + ny * minDist;
  reflectVelocity(nx, ny, 1.05 * cfg().bumpMult);
  const speed = Math.hypot(state.ball.vx, state.ball.vy);
  const minSp = 7 * cfg().bumpMult;
  if (speed < minSp) {
    state.ball.vx = nx * minSp;
    state.ball.vy = ny * minSp;
  }
  addScore(bumper.score);
  playTone(300 + bumper.hue, 90, "sine", 0.06);
  return true;
}

function resolveTargetCollision(target) {
  const bx = state.ball.x;
  const by = state.ball.y;
  const closestX = Math.max(target.x, Math.min(bx, target.x + target.w));
  const closestY = Math.max(target.y, Math.min(by, target.y + target.h));
  const dx = bx - closestX;
  const dy = by - closestY;
  if (dx * dx + dy * dy > BALL_R * BALL_R) return false;
  state.ball.x = closestX + (dx > 0 ? BALL_R : dx < 0 ? -BALL_R : 0);
  state.ball.y = closestY + (dy > 0 ? BALL_R : dy < 0 ? -BALL_R : 0);
  reflectVelocity(dx || 1, dy || 0, 0.9);
  if (!target.lit) {
    target.lit = true;
    addScore(target.score);
    playTone(520, 100);
  }
  return true;
}

function loseBallToDrain() {
  state.lives -= 1;
  playTone(80, 200, "sawtooth", 0.06);
  if (state.lives <= 0) {
    endGame(false);
  } else {
    resetBall();
    pinballMessageEl.textContent = `드레인! 남은 라이프 ${state.lives} — 좌 클릭으로 다시 발사`;
  }
  updateStatus();
}

function tryDrain() {
  if (state.ball.y > H + BALL_R) {
    loseBallToDrain();
    return true;
  }
  return false;
}

function updateFlippers(dt) {
  const decay = Math.pow(0.92, dt / 16.67);
  state.leftPress *= decay;
  state.rightPress *= decay;

  const leftTarget = LEFT_FLIPPER.rest + (LEFT_FLIPPER.fire - LEFT_FLIPPER.rest) * state.leftPress;
  const rightTarget = RIGHT_FLIPPER.rest + (RIGHT_FLIPPER.fire - RIGHT_FLIPPER.rest) * state.rightPress;
  const lerpUp   = 0.7;   // 올라갈 때 빠르게 스냅
  const lerpDown = 0.25;  // 내려올 때 스프링처럼 부드럽게
  const leftLerp  = leftTarget  > state.leftAngle  ? lerpDown : lerpUp;
  const rightLerp = rightTarget < state.rightAngle ? lerpDown : lerpUp;
  state.leftAngle  += (leftTarget  - state.leftAngle)  * leftLerp;
  state.rightAngle += (rightTarget - state.rightAngle) * rightLerp;
}

function launchBall() {
  if (!state.running || state.paused || state.ball.active) return;
  state.ball.active = true;
  state.ball.x = LAUNCH_X + (Math.random() - 0.5) * 30;
  state.ball.y = LAUNCH_Y;
  state.ball.vx = (Math.random() - 0.5) * 2;
  state.ball.vy = 2;
  playTone(160, 60, "sine", 0.05);
  pinballMessageEl.textContent = "플리퍼로 공을 받으세요!";
}

function nudgeTable() {
  if (!state.running || state.paused || !state.ball.active) return;
  const now = performance.now();
  if (now < state.nudgeCooldown) return;
  state.nudgeCooldown = now + 800;
  state.ball.vx += (Math.random() - 0.5) * 3;
  state.ball.vy += (Math.random() - 0.5) * 2;
  pinballMessageEl.textContent = "넛지!";
  playTone(90, 50);
}

function consumeMouseMoveDelta(dx, dy) {
  if (!state.running || state.paused) return;

  state.leftAcc  += dy;
  state.rightAcc += dx;

  // 노브 threshold 도달 → 플리퍼 풀 스냅 (decay가 스프링 복귀 담당)
  if (Math.abs(state.leftAcc) >= MOUSE_MOVE_THRESHOLD) {
    state.leftPress = 1.0;
    state.leftAcc = 0;
  }

  if (Math.abs(state.rightAcc) >= MOUSE_MOVE_THRESHOLD) {
    state.rightPress = 1.0;
    state.rightAcc = 0;
  }
}

function updatePhysics(dt) {
  if (state.paused) return;

  updateFlippers(dt);

  if (!state.ball.active) return;

  const c = cfg();
  const scale = dt / 16.67;
  const steps = Math.max(1, Math.ceil(Math.hypot(state.ball.vx, state.ball.vy) * scale / 10));

  for (let i = 0; i < steps; i += 1) {
    const sub = scale / steps;
    state.ball.vy += c.gravity * sub;
    state.ball.x += state.ball.vx * sub;
    state.ball.y += state.ball.vy * sub;

    resolveWallCollision();
    resolveFlipperCollision(LEFT_FLIPPER, state.leftAngle, state.leftPress);
    resolveFlipperCollision(RIGHT_FLIPPER, state.rightAngle, state.rightPress);

    for (const bumper of BUMPERS) resolveBumperCollision(bumper);
    for (const target of TARGETS) resolveTargetCollision(target);

    if (tryDrain()) return;
  }

  const speed = Math.hypot(state.ball.vx, state.ball.vy);
  if (speed > 18) {
    const s = 18 / speed;
    state.ball.vx *= s;
    state.ball.vy *= s;
  }
}

function drawTable() {
  ctx.fillStyle = "#0a0614";
  ctx.fillRect(0, 0, W, H);

  const tableGrad = ctx.createRadialGradient(W / 2, H * 0.35, 40, W / 2, H * 0.4, 380);
  tableGrad.addColorStop(0, "#1e1b4b");
  tableGrad.addColorStop(1, "#0a0614");
  ctx.fillStyle = tableGrad;
  ctx.fillRect(24, 24, W - 48, H - 48);

  // Center drain gap — red glow at bottom
  const drainGrd = ctx.createLinearGradient(DRAIN_X1, H - 120, DRAIN_X2, H - 120);
  drainGrd.addColorStop(0, "transparent");
  drainGrd.addColorStop(0.5, "rgba(239,68,68,0.22)");
  drainGrd.addColorStop(1, "transparent");
  ctx.fillStyle = drainGrd;
  ctx.fillRect(DRAIN_X1, H - 120, DRAIN_X2 - DRAIN_X1, 120);

  ctx.strokeStyle = "rgba(129, 140, 248, 0.35)";
  ctx.lineWidth = 3;
  for (const wall of WALLS) {
    ctx.beginPath();
    ctx.moveTo(wall[0], wall[1]);
    ctx.lineTo(wall[2], wall[3]);
    ctx.stroke();
  }

  // Drain edge markers
  ctx.strokeStyle = "rgba(239,68,68,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(DRAIN_X1, H - 80);
  ctx.lineTo(DRAIN_X1, H);
  ctx.moveTo(DRAIN_X2, H - 80);
  ctx.lineTo(DRAIN_X2, H);
  ctx.stroke();

  for (const target of TARGETS) {
    ctx.fillStyle = target.lit ? "#fbbf24" : "#334155";
    ctx.shadowColor = target.lit ? "#fbbf24" : "transparent";
    ctx.shadowBlur = target.lit ? 12 : 0;
    ctx.fillRect(target.x, target.y, target.w, target.h);
    ctx.shadowBlur = 0;
  }

  for (const bumper of BUMPERS) {
    ctx.beginPath();
    ctx.arc(bumper.x, bumper.y, bumper.r, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${bumper.hue} 90% 55%)`;
    ctx.shadowColor = `hsl(${bumper.hue} 90% 55%)`;
    ctx.shadowBlur = 16;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawFlipper(LEFT_FLIPPER, state.leftAngle, "#38bdf8");
  drawFlipper(RIGHT_FLIPPER, state.rightAngle, "#fb7185");

  if (!state.ball.active) {
    // Ghost ball + drop indicator at launch point
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(LAUNCH_X, LAUNCH_Y + BALL_R + 4);
    ctx.lineTo(LAUNCH_X, LAUNCH_Y + 60);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.arc(LAUNCH_X, LAUNCH_Y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = "#f8fafc";
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "bold 28px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.fillText(String(state.score), W / 2, 52);

  if (state.paused) {
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.font = "700 28px Inter, sans-serif";
    ctx.fillText("PAUSED", W / 2, H / 2);
  }
}

function drawFlipper(flip, angle, color) {
  const seg = flipperEndpoints(flip, angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(seg.x1, seg.y1);
  ctx.lineTo(seg.x2, seg.y2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(flip.px, flip.py, 8, 0, Math.PI * 2);
  ctx.fill();
}

function frame(ts) {
  if (!state.running) return;

  if (!state.lastFrameMs) state.lastFrameMs = ts;
  const dt = Math.min(48, ts - state.lastFrameMs);
  state.lastFrameMs = ts;

  if (!state.paused) updatePhysics(dt);
  drawTable();
  updateStatus();
  state.rafId = requestAnimationFrame(frame);
}

function startGame() {
  resetRound();
  state.running = true;
  state.paused = false;
  state.lastFrameMs = 0;
  pinballStartOverlay.classList.add("hidden");
  pinballResultOverlay.classList.add("hidden");
  updateStatus();
  drawTable();
  state.rafId = requestAnimationFrame(frame);
}

function togglePause() {
  if (!state.running) return;
  state.paused = !state.paused;
  pinballMessageEl.textContent = state.paused ? "일시정지 (중클릭 재개)" : "재개!";
  if (!state.paused) {
    state.lastFrameMs = 0;
    state.rafId = requestAnimationFrame(frame);
  }
  drawTable();
}

function endGame(cleared) {
  state.running = false;
  cancelAnimationFrame(state.rafId);
  const isNew = cleared && saveBestIfNeeded();
  pinballResultTitle.textContent = cleared ? "CLEAR" : "GAME OVER";
  pinballResultText.textContent = cleared
    ? `목표 달성! 점수 ${state.score}${isNew ? " (신기록!)" : ""}`
    : `최종 점수 ${state.score}`;
  pinballResultOverlay.classList.remove("hidden");
  requestAnimationFrame(placeResultDialogNearPointer);
  pinballMessageEl.textContent = cleared ? "클리어!" : "게임 오버";
  playTone(cleared ? 523 : 150, 250);
  updateStatus();
  drawTable();
}

function openStartOverlay() {
  state.running = false;
  state.paused = false;
  cancelAnimationFrame(state.rafId);
  pinballStartOverlay.classList.remove("hidden");
  pinballResultOverlay.classList.add("hidden");
  pinballMessageEl.textContent = "난이도를 선택하고 시작하세요.";
  resetRound();
  drawTable();
  updateStatus();
}

function updateSensStatus() {
  pinballSensStateEl.textContent = `${MOUSE_MOVE_THRESHOLD}px/틱`;
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
  if (event.button === 0) {
    launchBall();
    return;
  }
  if (event.button === 2) {
    event.preventDefault();
    nudgeTable();
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

pinballStartControlBtn.addEventListener("click", () => startGame());
pinballStartBtn.addEventListener("click", () => openStartOverlay());
pinballResetBtn.addEventListener("click", () => {
  if (state.running) startGame();
  else openStartOverlay();
});
pinballReplayBtn.addEventListener("click", () => {
  pinballResultOverlay.classList.add("hidden");
  openStartOverlay();
});
pinballSensDecBtn.addEventListener("click", () => {
  MOUSE_MOVE_THRESHOLD = Math.max(1, MOUSE_MOVE_THRESHOLD - 1);
  updateSensStatus();
});
pinballSensIncBtn.addEventListener("click", () => {
  MOUSE_MOVE_THRESHOLD = Math.min(24, MOUSE_MOVE_THRESHOLD + 1);
  updateSensStatus();
});

difficultyButtons[0].classList.add("active");
updateSensStatus();
openStartOverlay();
