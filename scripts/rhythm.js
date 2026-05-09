// ── DOM refs ─────────────────────────────────────────────────────
const leftTrackEl  = document.getElementById("leftTrack");
const rightTrackEl = document.getElementById("rightTrack");
const indicatorRedEl  = document.getElementById("indicatorRed");
const indicatorBlueEl = document.getElementById("indicatorBlue");

const rhythmTimeBoardEl      = document.getElementById("rhythmTimeBoard");
const rhythmScoreBoardEl     = document.getElementById("rhythmScoreBoard");
const rhythmDifficultyStateEl = document.getElementById("rhythmDifficultyState");
const rhythmAccuracyStateEl  = document.getElementById("rhythmAccuracyState");
const rhythmBestStateEl      = document.getElementById("rhythmBestState");
const rhythmStatsStateEl     = document.getElementById("rhythmStatsState");
const rhythmMissStackStateEl = document.getElementById("rhythmMissStackState");
const rhythmMessageEl        = document.getElementById("rhythmMessage");
const rhythmJudgeTextEl      = document.getElementById("rhythmJudgeText");

const rhythmStartBtn        = document.getElementById("rhythmStartBtn");
const rhythmResetBtn        = document.getElementById("rhythmResetBtn");
const rhythmStartOverlay    = document.getElementById("rhythmStartOverlay");
const rhythmStartControlBtn = document.getElementById("rhythmStartControlBtn");
const rhythmResultOverlay   = document.getElementById("rhythmResultOverlay");
const rhythmResultTitle     = document.getElementById("rhythmResultTitle");
const rhythmResultText      = document.getElementById("rhythmResultText");
const rhythmReplayBtn       = document.getElementById("rhythmReplayBtn");
const difficultyButtons     = document.querySelectorAll(".difficulty-btn");

const RANKING_STORAGE_KEY = "dual-knob-rhythm-best-v2";

const SCORING = { perfect: 1000, good: 600, ok: 250, miss: 0 };

// ── 난이도 설정 ──────────────────────────────────────────────────
// 초급: 느리고 관대 / 중급: 중간 / 고급: 빠르고 엄격
const DIFFICULTY = {
  easy: {
    label: "초급",
    bpm: 72,
    approachMs: 2200,
    notePctW: 0.22,       // 넓은 노트
    indicatorPctW: 0.20,  // 넓은 인디케이터
    posTolPct: 0.22,      // 관대한 위치 허용
    timing: { perfect: 90, good: 160, ok: 220 },
    missLimit: 8,
    totalNotes: 28,
    chordChance: 0.0
  },
  normal: {
    label: "중급",
    bpm: 95,
    approachMs: 1700,
    notePctW: 0.13,
    indicatorPctW: 0.11,
    posTolPct: 0.11,
    timing: { perfect: 55, good: 100, ok: 155 },
    missLimit: 5,
    totalNotes: 48,
    chordChance: 0.10
  },
  hard: {
    label: "고급",
    bpm: 128,
    approachMs: 1250,
    notePctW: 0.08,
    indicatorPctW: 0.07,
    posTolPct: 0.06,
    timing: { perfect: 35, good: 70, ok: 110 },
    missLimit: 3,
    totalNotes: 68,
    chordChance: 0.28
  }
};

const COLORS = ["red", "blue"];

const state = {
  difficulty: "easy",
  running: false,
  paused: false,
  songStartMs: 0,
  pauseStartedMs: 0,
  pauseAccumMs: 0,
  rafId: 0,
  combo: 0,
  maxCombo: 0,
  score: 0,
  missStack: 0,
  stats: { perfect: 0, good: 0, ok: 0, miss: 0 },
  notes: [],
  noteIndex: 0,
  songLengthMs: 0,
  posRed: 0.5,   // 0..1, 좌 레인 내 인디케이터 위치
  posBlue: 0.5,  // 0..1, 우 레인 내 인디케이터 위치
  pointer: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
  mouse: { active: false, lastX: 0, lastY: 0 }
};

let judgeTextTimer = 0;
let audioCtx = null;
let bgmTimer = null;

// ── 유틸 ─────────────────────────────────────────────────────────
function formatTime(ms) {
  const sec = Math.max(ms, 0) / 1000;
  const min = Math.floor(sec / 60);
  const rem = (sec % 60).toFixed(1).padStart(4, "0");
  return `${String(min).padStart(2, "0")}:${rem}`;
}

function laneTrackWidth() {
  return leftTrackEl.clientWidth;
}

function laneTrackHeight() {
  return leftTrackEl.clientHeight;
}

// ── 베스트 기록 ───────────────────────────────────────────────────
function loadBest() {
  try {
    const raw = localStorage.getItem(RANKING_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function saveBestIfNeeded() {
  const all = loadBest();
  const key = state.difficulty;
  const current = all[key];
  const bestScore = current?.score ?? -1;
  const isBetter = state.score > bestScore;
  if (isBetter) {
    all[key] = { score: state.score, accuracy: calcAccuracy(), maxCombo: state.maxCombo };
    localStorage.setItem(RANKING_STORAGE_KEY, JSON.stringify(all));
  }
  return isBetter;
}

function calcAccuracy() {
  const total = state.stats.perfect + state.stats.good + state.stats.ok + state.stats.miss;
  if (total === 0) return 0;
  const w = state.stats.perfect * 1 + state.stats.good * 0.7 + state.stats.ok * 0.4;
  return (w / total) * 100;
}

// ── 오디오 ───────────────────────────────────────────────────────
function ensureAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function playTone(freq, durationMs, type = "sine", gainValue = 0.05, when = 0) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime + when;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

function playJudgeSfx(result, color) {
  ensureAudioContext();
  if (!audioCtx) return;
  const isRed = color === "red";
  if (result === "perfect") {
    playTone(isRed ? 880 : 1175, 90, "triangle", 0.08);
    playTone(isRed ? 1175 : 1568, 100, "triangle", 0.07, 0.03);
  } else if (result === "good") {
    playTone(isRed ? 660 : 880, 90, "triangle", 0.07);
  } else if (result === "ok") {
    playTone(isRed ? 523 : 698, 80, "sine", 0.06);
  } else if (result === "miss") {
    playTone(160, 140, "sawtooth", 0.05);
  }
}

function startBgmLoop() {
  ensureAudioContext();
  stopBgmLoop();
  const bpm = DIFFICULTY[state.difficulty].bpm;
  const beatSec = 60 / bpm;
  const pattern = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 329.63];
  let step = 0;
  bgmTimer = setInterval(() => {
    if (!state.running || state.paused) return;
    const freq = pattern[step % pattern.length];
    playTone(freq, 150, "triangle", 0.03);
    if (step % 4 === 0) playTone(90, 80, "sine", 0.025);
    step += 1;
  }, beatSec * 1000);
}

function stopBgmLoop() {
  if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
}

// ── 상태 표시 ─────────────────────────────────────────────────────
function updateStatus(nowMs = 0) {
  const diff = DIFFICULTY[state.difficulty];
  rhythmDifficultyStateEl.textContent = `Difficulty: ${diff.label}`;
  const remain = Math.max(state.songLengthMs - nowMs, 0);
  rhythmTimeBoardEl.textContent = formatTime(remain);
  rhythmScoreBoardEl.textContent = `${state.score} / x${state.combo}`;
  rhythmAccuracyStateEl.textContent = `Accuracy: ${calcAccuracy().toFixed(1)}%`;
  rhythmStatsStateEl.textContent = `P/G/O/M: ${state.stats.perfect}/${state.stats.good}/${state.stats.ok}/${state.stats.miss}`;
  rhythmMissStackStateEl.textContent = `Miss Stack: ${state.missStack}/${diff.missLimit}`;
  const best = loadBest()[state.difficulty];
  rhythmBestStateEl.textContent = best
    ? `Best: ${best.score} (${best.accuracy.toFixed(1)}%)`
    : "Best: -";
}

// ── 인디케이터 비주얼 ──────────────────────────────────────────────
function updateIndicatorVisuals() {
  const cfg = DIFFICULTY[state.difficulty];
  const w = laneTrackWidth();
  if (w <= 0) return;
  const indW = Math.max(24, Math.round(w * cfg.indicatorPctW));
  indicatorRedEl.style.width = `${indW}px`;
  indicatorBlueEl.style.width = `${indW}px`;
  indicatorRedEl.style.left = `${Math.round(state.posRed * w)}px`;
  indicatorBlueEl.style.left = `${Math.round(state.posBlue * w)}px`;
}

// ── 판정 피드백 ───────────────────────────────────────────────────
function showJudgeText(result) {
  if (!rhythmJudgeTextEl) return;
  clearTimeout(judgeTextTimer);
  rhythmJudgeTextEl.classList.remove("perfect", "good", "ok", "miss");
  rhythmJudgeTextEl.textContent = result.toUpperCase();
  rhythmJudgeTextEl.classList.add(result, "show");
  judgeTextTimer = setTimeout(() => rhythmJudgeTextEl.classList.remove("show"), 220);
}

function pulseTrack(isOk, color) {
  const cls = isOk ? "hit-ok" : "hit-bad";
  const el = color === "red" ? leftTrackEl : rightTrackEl;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove("hit-ok", "hit-bad"), 130);
}

function flashIndicator(color, ok) {
  const el = color === "red" ? indicatorRedEl : indicatorBlueEl;
  const cls = ok ? "flash-ok" : "flash-bad";
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 140);
}

// ── 채보 생성 ─────────────────────────────────────────────────────
function pickPos() {
  return Math.random() * 0.82 + 0.09; // 0.09 ~ 0.91
}

function buildChart() {
  const cfg = DIFFICULTY[state.difficulty];
  const beatMs = 60000 / cfg.bpm;
  const notes = [];
  let t = 1500; // lead-in

  for (let i = 0; i < cfg.totalNotes; i += 1) {
    // 두 레인을 균등하게 번갈아 배치 (명확한 레인 구분)
    const color = COLORS[i % 2 === 0 ? 0 : 1];
    const note = {
      id: `n${i}`,
      time: Math.round(t),
      color,
      pos: pickPos(),
      judged: false,
      result: null,
      el: null
    };
    notes.push(note);

    let advance = beatMs;
    if (state.difficulty === "easy") advance = beatMs * 2;
    if (state.difficulty === "hard" && Math.random() < 0.35) advance = beatMs * 0.5;

    // chord: 동시에 반대 레인에 노트 추가
    if (Math.random() < cfg.chordChance && i + 1 < cfg.totalNotes) {
      const otherColor = color === "red" ? "blue" : "red";
      notes.push({
        id: `n${i}c`,
        time: Math.round(t),
        color: otherColor,
        pos: pickPos(),
        judged: false,
        result: null,
        el: null
      });
      i += 1;
    }

    t += advance;
  }

  notes.sort((a, b) => a.time - b.time);
  return notes;
}

// ── 노트 DOM ─────────────────────────────────────────────────────
function clearTrackNotes() {
  leftTrackEl.querySelectorAll(".note").forEach((n) => n.remove());
  rightTrackEl.querySelectorAll(".note").forEach((n) => n.remove());
}

function createNoteEl(note) {
  const el = document.createElement("div");
  el.className = `note ${note.color}`;
  const container = note.color === "red" ? leftTrackEl : rightTrackEl;
  container.appendChild(el);
  return el;
}

// ── 게임 상태 초기화 ──────────────────────────────────────────────
function resetGameState() {
  state.combo = 0;
  state.maxCombo = 0;
  state.score = 0;
  state.missStack = 0;
  state.stats = { perfect: 0, good: 0, ok: 0, miss: 0 };
  state.posRed = 0.5;
  state.posBlue = 0.5;
  clearTrackNotes();
  state.notes = buildChart();
  state.noteIndex = 0;
  const cfg = DIFFICULTY[state.difficulty];
  const lastNoteTime = state.notes[state.notes.length - 1]?.time ?? 0;
  state.songLengthMs = lastNoteTime + cfg.timing.ok + 1500;
  updateIndicatorVisuals();
}

// ── 판정 로직 ─────────────────────────────────────────────────────
function timingJudge(deltaMs, cfg) {
  const ad = Math.abs(deltaMs);
  if (ad <= cfg.timing.perfect) return "perfect";
  if (ad <= cfg.timing.good) return "good";
  if (ad <= cfg.timing.ok) return "ok";
  return null;
}

function downgrade(result) {
  if (result === "perfect") return "good";
  if (result === "good") return "ok";
  return "ok";
}

function applyJudge(note, result) {
  note.judged = true;
  note.result = result;
  if (note.el) {
    note.el.classList.add(result === "miss" ? "judged-miss" : "judged-ok");
  }
  if (result === "miss") {
    state.combo = 0;
    state.missStack += 1;
    pulseTrack(false, note.color);
    flashIndicator(note.color, false);
  } else {
    state.combo += 1;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    const comboBonus = Math.min(state.combo * 5, 500);
    state.score += SCORING[result] + comboBonus;
    pulseTrack(true, note.color);
    flashIndicator(note.color, true);
  }
  state.stats[result] += 1;
  showJudgeText(result);
  playJudgeSfx(result, note.color);
}

function nearestPendingByColor(color, now, cfg) {
  let picked = null;
  for (const note of state.notes) {
    if (note.judged || note.color !== color) continue;
    const delta = now - note.time;
    if (delta > cfg.timing.ok) continue;
    if (delta < -cfg.timing.ok) continue;
    if (!picked || Math.abs(delta) < Math.abs(now - picked.time)) picked = note;
  }
  return picked;
}

function handleClickColor(color) {
  if (!state.running || state.paused) return;
  const now = currentSongTime();
  const cfg = DIFFICULTY[state.difficulty];
  const note = nearestPendingByColor(color, now, cfg);
  if (!note) {
    state.combo = 0;
    state.missStack += 1;
    state.stats.miss += 1;
    showJudgeText("miss");
    flashIndicator(color, false);
    pulseTrack(false, color);
    playJudgeSfx("miss", color);
    return;
  }

  let timing = timingJudge(now - note.time, cfg);
  if (!timing) { applyJudge(note, "miss"); return; }

  const myPos = color === "red" ? state.posRed : state.posBlue;
  const distPct = Math.abs(myPos - note.pos);
  if (distPct > cfg.posTolPct) { applyJudge(note, "miss"); return; }

  const posOk = distPct <= cfg.posTolPct * 0.5;
  applyJudge(note, posOk ? timing : downgrade(timing));
}

function settleMisses(now) {
  const cfg = DIFFICULTY[state.difficulty];
  for (const note of state.notes) {
    if (note.judged) continue;
    if (now - note.time > cfg.timing.ok) applyJudge(note, "miss");
  }
  if (state.missStack >= cfg.missLimit) failByStack();
}

function currentSongTime() {
  if (!state.running) return 0;
  return Math.max(performance.now() - state.songStartMs - state.pauseAccumMs, 0);
}

// ── 노트 렌더링 ───────────────────────────────────────────────────
function renderNotes(now) {
  const cfg = DIFFICULTY[state.difficulty];
  const w = laneTrackWidth();
  const trackH = laneTrackHeight();
  const judgeY = trackH - 84;
  const noteW = Math.max(18, Math.round(w * cfg.notePctW));

  for (const note of state.notes) {
    if (note.judged && note.result !== "miss") {
      if (note.el?.style.display !== "none") {
        if (now - note.time > 220) note.el.style.display = "none";
      }
      continue;
    }

    const dt = note.time - now;
    if (dt > cfg.approachMs) {
      if (note.el) note.el.style.display = "none";
      continue;
    }
    if (note.judged && note.result === "miss") {
      if (now - note.time > 500) {
        if (note.el) note.el.style.display = "none";
        continue;
      }
    }

    if (!note.el) {
      note.el = createNoteEl(note);
      note.el.style.width = `${noteW}px`;
    } else if (parseInt(note.el.style.width, 10) !== noteW) {
      note.el.style.width = `${noteW}px`;
    }

    const progress = 1 - dt / cfg.approachMs;
    const y = Math.max(0, Math.min(trackH, progress * judgeY));
    note.el.style.transform = `translate(-50%, ${y}px)`;
    note.el.style.left = `${note.pos * w}px`;
    note.el.style.display = "block";
  }
}

// ── 게임 종료 ─────────────────────────────────────────────────────
function finishGame() {
  state.running = false;
  cancelAnimationFrame(state.rafId);
  stopBgmLoop();
  const isNew = saveBestIfNeeded();
  rhythmResultTitle.textContent = "CLEAR";
  rhythmResultText.textContent = `Score ${state.score} / Accuracy ${calcAccuracy().toFixed(1)}% / MaxCombo ×${state.maxCombo}${isNew ? " 🎉신기록!" : ""}`;
  rhythmResultOverlay.classList.remove("hidden");
  rhythmMessageEl.textContent = "플레이 완료! 결과를 확인하세요.";
  updateStatus(state.songLengthMs);
}

function failByStack() {
  if (!state.running) return;
  state.running = false;
  cancelAnimationFrame(state.rafId);
  stopBgmLoop();
  const cfg = DIFFICULTY[state.difficulty];
  rhythmResultTitle.textContent = "FAILED";
  rhythmResultText.textContent = `Miss 누적 한계 초과 (${state.missStack}/${cfg.missLimit}) / Score ${state.score} / Accuracy ${calcAccuracy().toFixed(1)}%`;
  rhythmResultOverlay.classList.remove("hidden");
  rhythmMessageEl.textContent = "미스 누적으로 실패.";
  showJudgeText("miss");
  updateStatus(currentSongTime());
}

// ── 메인 루프 ─────────────────────────────────────────────────────
function frame() {
  if (!state.running) return;
  const now = currentSongTime();
  settleMisses(now);
  if (!state.running) return;
  renderNotes(now);
  updateIndicatorVisuals();
  updateStatus(now);
  if (now >= state.songLengthMs) { finishGame(); return; }
  state.rafId = requestAnimationFrame(frame);
}

function startGame() {
  try { ensureAudioContext(); } catch (_e) { /* audio unavailable */ }
  resetGameState();
  state.running = true;
  state.paused = false;
  state.pauseAccumMs = 0;
  state.songStartMs = performance.now();
  rhythmResultOverlay.classList.add("hidden");
  rhythmStartOverlay.classList.add("hidden");
  rhythmMessageEl.textContent = "인디케이터를 노트 위치에 맞추고 클릭!";
  rhythmJudgeTextEl.classList.remove("show", "perfect", "good", "ok", "miss");
  updateStatus(0);
  startBgmLoop();
  state.rafId = requestAnimationFrame(frame);
}

function togglePause() {
  if (!state.running) return;
  if (!state.paused) {
    state.paused = true;
    state.pauseStartedMs = performance.now();
    rhythmMessageEl.textContent = "일시정지";
    cancelAnimationFrame(state.rafId);
  } else {
    state.paused = false;
    state.pauseAccumMs += performance.now() - state.pauseStartedMs;
    rhythmMessageEl.textContent = "재개";
    state.rafId = requestAnimationFrame(frame);
  }
}

function openStartOverlay() {
  state.running = false;
  state.paused = false;
  cancelAnimationFrame(state.rafId);
  stopBgmLoop();
  rhythmResultOverlay.classList.add("hidden");
  rhythmStartOverlay.classList.remove("hidden");
  rhythmMessageEl.textContent = "난이도를 선택하고 시작하세요.";
  state.songLengthMs = 0;
  updateStatus(0);
}

// ── 이벤트 ───────────────────────────────────────────────────────
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

  const w = laneTrackWidth();
  if (w <= 0) return;
  const sensitivity = 1 / (w * 0.88);
  // 좌 노브(Y축=dy) → 빨강 레인, 우 노브(X축=dx) → 파랑 레인
  state.posRed  = Math.min(1, Math.max(0, state.posRed  - dy * sensitivity));
  state.posBlue = Math.min(1, Math.max(0, state.posBlue + dx * sensitivity));
});

window.addEventListener("mousedown", (event) => {
  if (!state.running || state.paused) {
    if (event.button === 1) togglePause();
    return;
  }
  if (event.button === 0) {
    event.preventDefault();
    handleClickColor("red");
  } else if (event.button === 2) {
    event.preventDefault();
    handleClickColor("blue");
  } else if (event.button === 1 || event.buttons === 3) {
    event.preventDefault();
    togglePause();
  }
});

window.addEventListener("contextmenu", (event) => {
  if (state.running) event.preventDefault();
});

difficultyButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    difficultyButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.difficulty = btn.dataset.difficulty;
    updateStatus(0);
  });
});

rhythmStartControlBtn.addEventListener("click", () => { startGame(); });
rhythmStartBtn.addEventListener("click", () => { openStartOverlay(); });
rhythmResetBtn.addEventListener("click", () => {
  if (state.running) startGame();
  else openStartOverlay();
});
rhythmReplayBtn.addEventListener("click", () => {
  rhythmResultOverlay.classList.add("hidden");
  openStartOverlay();
});
window.addEventListener("resize", () => { updateIndicatorVisuals(); });

// ── 부트 ─────────────────────────────────────────────────────────
difficultyButtons[0].classList.add("active");
updateIndicatorVisuals();
updateStatus(0);
openStartOverlay();
