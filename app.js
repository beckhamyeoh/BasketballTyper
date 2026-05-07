// ===== Tuning =====
const SPEED_BONUS_MAX = 25;
const TYPO_PENALTY_MULT = 150;
const TIMEOUT_FACTOR = 0.15;
const CONTEST_PENALTY = 10;
const FLOOR_PCT = 5;
const CEIL_PCT = 95;

const SHOOT_BASE_BY_DIST = [85, 65, 45, 30, 15]; // 0..4 zones from target hoop
const PASS_BASE = { 1: 90, 2: 80, 3: 65, 4: 50 };
const DRIBBLE_BASE = 90;

const STEAL_BASE = 25;
const BLOCK_BASE = 35;
const INTERCEPT_BASE = 30;

const STACK_BUFFS = [15, 8, 4, 2];
const MATCH_DURATION = 180;
const AI_BONUS = 10;

// Vertical row positions for stable per-player slots (% within field)
const ROW_USER = [25, 50, 78];
const ROW_OPP  = [38, 64, 90];

// ===== Teams =====
const TEAMS = [
  { id: 'java-castle',     name: 'Java Castle',      icon: '☕', lang: 'java',       letter: 'J', tagline: 'Steady. Defensive.',
    color: '#a16207', colorLight: '#eab308', colorGlow: 'rgba(234, 179, 8, 0.55)' },
  { id: 'claude-warriors', name: 'Claude Warriors',  icon: '🤖', lang: 'javascript', letter: 'C', tagline: 'Aggressive. High variance.',
    color: '#9a3412', colorLight: '#f97316', colorGlow: 'rgba(249, 115, 22, 0.55)' },
  { id: 'python-kings',    name: 'Python Kings',     icon: '🐍', lang: 'python',     letter: 'P', tagline: 'Balanced playstyle.',
    color: '#15803d', colorLight: '#22c55e', colorGlow: 'rgba(34, 197, 94, 0.55)' },
  { id: 'cpp-crusaders',   name: 'C++ Crusaders',    icon: '⚔️', lang: 'cpp',        letter: 'X', tagline: 'Old school. Brutal.',
    color: '#6d28d9', colorLight: '#a855f7', colorGlow: 'rgba(168, 85, 247, 0.55)' },
  { id: 'ruby-renegades',  name: 'Ruby Renegades',   icon: '💎', lang: 'ruby',       letter: 'R', tagline: 'Stylish. Risky shots.',
    color: '#9f1239', colorLight: '#e11d48', colorGlow: 'rgba(225, 29, 72, 0.55)' },
  { id: 'go-gladiators',   name: 'Go Gladiators',    icon: '🚀', lang: 'go',         letter: 'G', tagline: 'Fast break specialists.',
    color: '#0e7490', colorLight: '#06b6d4', colorGlow: 'rgba(6, 182, 212, 0.55)' },
];

// Set to false to enforce a chain: each team requires beating the previous one.
// While true, every team is playable from the start (testing mode).
const UNLOCK_ALL = true;
const PROGRESS_KEY = 'codehoops_progress';

// ===== Audio =====
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    } catch (e) { audioCtx = null; }
  }
  return audioCtx;
}
function unlockAudio() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}
function playTone({ freq, duration = 0.1, type = 'sine', volume = 0.08, slideTo = null, delay = 0 }) {
  if (!soundOn) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}
function playNoise({ duration = 0.1, volume = 0.05, delay = 0 }) {
  if (!soundOn) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = buffer;
  gain.gain.value = volume;
  src.connect(gain).connect(ctx.destination);
  src.start(ctx.currentTime + delay);
}
const sounds = {
  click:  () => playTone({ freq: 440, duration: 0.04, type: 'square', volume: 0.05 }),
  swish:  () => {
    playTone({ freq: 1400, slideTo: 350, duration: 0.35, type: 'sine', volume: 0.09 });
    playNoise({ duration: 0.18, volume: 0.04, delay: 0.05 });
  },
  clank:  () => {
    playTone({ freq: 220, slideTo: 90, duration: 0.18, type: 'square', volume: 0.06 });
    playNoise({ duration: 0.12, volume: 0.05 });
  },
  steal:  () => {
    playTone({ freq: 880, slideTo: 1320, duration: 0.08, type: 'square', volume: 0.06 });
    playTone({ freq: 1320, duration: 0.14, type: 'sine', volume: 0.06, delay: 0.08 });
  },
  buzzer: () => playTone({ freq: 110, duration: 1.0, type: 'square', volume: 0.1 }),
};

// ===== Persistent state =====
let selectedTeam = null;
let soundOn = false;
let userScore = 0;
let oppScore = 0;
let userDefenderStack = 0;
let matchTimerSec = MATCH_DURATION;
let matchTimerInterval = null;
let matchOver = false;
let stats = null;

let state = null;

// ===== Helpers =====
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const zoneCenter = (z) => (z - 0.5) * 20;

const offense = () => state.possession === 'user' ? state.userPlayers : state.oppPlayers;
const defense = () => state.possession === 'user' ? state.oppPlayers : state.userPlayers;
const getCarrier = () => offense()[state.ballOwnerIdx];
const direction = () => state.possession === 'user' ? 1 : -1;
const isContested = () => getCarrier().zone === defense()[state.ballOwnerIdx].zone;

function shootBase(zone, side) {
  const dist = side === 'user' ? (5 - zone) : (zone - 1);
  return SHOOT_BASE_BY_DIST[clamp(dist, 0, 4)];
}
function pointsFor(zone, side) {
  if (side === 'user') return zone === 5 ? 2 : 3;
  return zone === 1 ? 2 : 3;
}
function stackBuffAt(level) {
  if (level <= 0) return 0;
  return STACK_BUFFS[Math.min(level - 1, STACK_BUFFS.length - 1)];
}

// ===== Progression / unlocks =====
function getProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); }
  catch { return {}; }
}
function saveProgress(p) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch {}
}
function recordResult(teamId, didWin) {
  const p = getProgress();
  p[teamId] = p[teamId] || { wins: 0, losses: 0 };
  if (didWin) p[teamId].wins++;
  else p[teamId].losses++;
  saveProgress(p);
}
function isUnlocked(team) {
  if (UNLOCK_ALL) return true;
  // Chain mode: first team always unlocked; each subsequent requires beating the previous.
  const idx = TEAMS.findIndex((t) => t.id === team.id);
  if (idx === 0) return true;
  const prev = TEAMS[idx - 1];
  return (getProgress()[prev.id]?.wins || 0) > 0;
}

// ===== Menu / team select =====
function showMenu() {
  if (matchTimerInterval) clearInterval(matchTimerInterval);
  document.getElementById('menuScreen').classList.remove('hidden');
  document.getElementById('matchScreen').classList.add('hidden');
  renderTeams();
}

function renderTeams() {
  const teamsEl = document.getElementById('teams');
  teamsEl.innerHTML = '';
  const progress = getProgress();
  TEAMS.forEach((team, idx) => {
    const unlocked = isUnlocked(team);
    const card = document.createElement('div');
    card.className = `team-card${unlocked ? '' : ' locked'}`;
    card.style.setProperty('--team-color', team.color);
    card.style.setProperty('--team-color-light', team.colorLight);
    card.style.setProperty('--team-glow', team.colorGlow);
    card.style.animationDelay = `${idx * 0.06}s`;
    if (!unlocked) card.title = 'Beat the previous team to unlock';

    const langDisp = (typeof LANG_DISPLAY !== 'undefined' && LANG_DISPLAY[team.lang]) || team.lang.toUpperCase();
    const rec = progress[team.id];
    const recordHTML = (rec && (rec.wins + rec.losses > 0))
      ? `<div class="team-record">${rec.wins}W · ${rec.losses}L</div>`
      : '';

    card.innerHTML = `
      ${unlocked ? '' : '<div class="lock-badge">🔒</div>'}
      ${recordHTML}
      <div class="team-icon">${team.icon}</div>
      <div class="team-name">${team.name}</div>
      <div class="team-lang">${langDisp}</div>
      <div class="team-tagline">${team.tagline}</div>
    `;
    if (unlocked) card.onclick = () => startMatchVsTeam(team);
    teamsEl.appendChild(card);
  });
}

function applyTeamTheme(team) {
  const root = document.querySelector('.game');
  if (!root) return;
  root.style.setProperty('--opp-color', team.color);
  root.style.setProperty('--opp-color-light', team.colorLight);
  root.style.setProperty('--opp-glow', team.colorGlow);
}

function startMatchVsTeam(team) {
  selectedTeam = team;
  applyTeamTheme(team);
  document.getElementById('menuScreen').classList.add('hidden');
  document.getElementById('matchScreen').classList.remove('hidden');
  document.getElementById('oppNameLabel').textContent = team.name.toUpperCase();
  startMatch();
}

// ===== Match lifecycle =====
function startMatch() {
  userScore = 0;
  oppScore = 0;
  userDefenderStack = 0;
  matchTimerSec = MATCH_DURATION;
  matchOver = false;
  stats = {
    snippetsTyped: 0, totalChars: 0, totalTypos: 0, totalTimeTyped: 0,
    fgMade: 0, fgAttempted: 0,
    threesMade: 0, threesAttempted: 0,
    passesAttempted: 0, passesCompleted: 0,
    steals: 0, blocks: 0, intercepts: 0,
    turnovers: 0,
  };

  if (matchTimerInterval) clearInterval(matchTimerInterval);
  matchTimerInterval = setInterval(tickMatchTimer, 1000);
  updateMatchTimerDisplay();

  const startSide = Math.random() < 0.5 ? 'user' : 'opp';
  startPossession(startSide);
}

function tickMatchTimer() {
  if (matchOver) return;
  matchTimerSec--;
  updateMatchTimerDisplay();
  if (matchTimerSec <= 0) {
    matchOver = true;
    clearInterval(matchTimerInterval);
  }
}

function updateMatchTimerDisplay() {
  const m = Math.floor(Math.max(0, matchTimerSec) / 60);
  const s = Math.max(0, matchTimerSec) % 60;
  const el = document.getElementById('matchTimer');
  el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  const wrap = el.parentElement;
  if (matchTimerSec <= 30 && matchTimerSec > 0) wrap.classList.add('urgent');
  else wrap.classList.remove('urgent');
}

function endMatch() {
  hideAllPanels();
  document.getElementById('endPanel').classList.remove('hidden');

  sounds.buzzer();

  // Record the result against the selected team (skip ties)
  if (selectedTeam && userScore !== oppScore) {
    recordResult(selectedTeam.id, userScore > oppScore);
  }

  let label;
  if (userScore > oppScore) label = 'WIN!';
  else if (userScore < oppScore) label = 'LOSS';
  else label = 'TIE';
  const titleEl = document.getElementById('endTitle');
  titleEl.textContent = label;
  titleEl.className = `end-title result ${userScore > oppScore ? 'success' : (userScore < oppScore ? 'fail' : '')}`;

  document.getElementById('endScore').textContent = `YOU ${userScore} — ${oppScore} OPP`;

  const wpm = stats.totalTimeTyped > 0
    ? Math.round((stats.totalChars / 5) / (stats.totalTimeTyped / 60))
    : 0;
  const acc = stats.totalChars > 0
    ? Math.round((1 - stats.totalTypos / stats.totalChars) * 100)
    : 100;
  const fgPct = stats.fgAttempted > 0 ? Math.round((stats.fgMade / stats.fgAttempted) * 100) : 0;
  const passPct = stats.passesAttempted > 0
    ? Math.round((stats.passesCompleted / stats.passesAttempted) * 100)
    : 0;

  document.getElementById('endStats').innerHTML = `
    <div><span class="stat-label">Snippets typed</span><span class="stat-val">${stats.snippetsTyped}</span></div>
    <div><span class="stat-label">Avg WPM</span><span class="stat-val">${wpm}</span></div>
    <div><span class="stat-label">Accuracy</span><span class="stat-val">${acc}%</span></div>
    <div><span class="stat-label">FG%</span><span class="stat-val">${stats.fgMade}/${stats.fgAttempted} (${fgPct}%)</span></div>
    <div><span class="stat-label">3PT</span><span class="stat-val">${stats.threesMade}/${stats.threesAttempted}</span></div>
    <div><span class="stat-label">Pass %</span><span class="stat-val">${stats.passesCompleted}/${stats.passesAttempted} (${passPct}%)</span></div>
    <div><span class="stat-label">Steals · Blocks · INTs</span><span class="stat-val">${stats.steals} · ${stats.blocks} · ${stats.intercepts}</span></div>
    <div><span class="stat-label">Turnovers</span><span class="stat-val">${stats.turnovers}</span></div>
  `;
}

// ===== Possession lifecycle =====
function startPossession(side) {
  if (matchOver) return endMatch();
  if (side === 'user') userDefenderStack = 0;

  // Offensive team starts in their own half
  let offZones;
  if (side === 'user') {
    offZones = [rand(1, 2), rand(2, 3), rand(1, 3)];
  } else {
    offZones = [rand(4, 5), rand(3, 4), rand(3, 5)];
  }
  // Defenders matched 1:1 (start in same zones as their offensive counterparts)
  const userZones = side === 'user' ? offZones : offZones.slice();
  const oppZones  = side === 'opp'  ? offZones : offZones.slice();

  state = {
    phase: 'select',
    possession: side,
    userPlayers: userZones.map((z) => ({ zone: z })),
    oppPlayers:  oppZones.map((z) => ({ zone: z })),
    ballOwnerIdx: rand(0, 2),
    snippet: null, typed: '', typos: 0,
    typeStart: 0, timeLimit: 0, timer: null,
    action: null, target: null,
    oppAction: null, oppTarget: null,
    lastResolution: null,
    appliedStack: 0,
  };

  if (side === 'opp') aiPickOppAction();

  renderPlayers(true);
  showSelectPanel();
}

function continueTurn() {
  // Reset per-action transient state, keep positions/possession
  state.phase = 'select';
  state.snippet = null;
  state.typed = '';
  state.typos = 0;
  state.action = null;
  state.target = null;
  state.oppAction = null;
  state.oppTarget = null;
  state.lastResolution = null;
  state.appliedStack = 0;

  if (state.possession === 'opp') aiPickOppAction();

  showSelectPanel();
}

function aiPickOppAction() {
  const carrierZone = getCarrier().zone;
  const distFromHoop = carrierZone - 1; // opp targets zone 1
  const r = Math.random();
  let act;

  // Distance-based AI: hoist from close, advance the ball from far.
  if (distFromHoop === 0) {
    // At their hoop: take the easy bucket
    act = r < 0.85 ? 'shoot' : 'pass';
  } else if (distFromHoop === 1) {
    // Close: usually shoot, sometimes work it
    act = r < 0.50 ? 'shoot' : (r < 0.80 ? 'pass' : 'dribble');
  } else if (distFromHoop === 2) {
    // Mid-range: balanced, mostly setting up
    act = r < 0.20 ? 'shoot' : (r < 0.65 ? 'pass' : 'dribble');
  } else {
    // Far (zone 4 or 5): advance the ball, almost never shoot
    act = r < 0.05 ? 'shoot' : (r < 0.55 ? 'pass' : 'dribble');
  }

  if (act === 'pass') {
    // Prefer passing to a teammate closer to their hoop (more advanced)
    const offBall = [0, 1, 2].filter((i) => i !== state.ballOwnerIdx);
    offBall.sort((a, b) => state.oppPlayers[a].zone - state.oppPlayers[b].zone);
    // 70% chance of advancing pass (lower zone), 30% bail-out pass
    const target = Math.random() < 0.7 ? offBall[0] : offBall[1];
    state.oppAction = `pass-${target}`;
    state.oppTarget = target;
  } else {
    state.oppAction = act;
    state.oppTarget = null;
  }
}

// ===== Movement =====
function applyMovement() {
  const off = offense();
  const def = defense();
  const dir = direction();

  // Off-ball offensive players: one moves 1 zone, the other 2 (random assignment)
  const offBall = [0, 1, 2].filter((i) => i !== state.ballOwnerIdx);
  const moves = Math.random() < 0.5 ? [1, 2] : [2, 1];
  offBall.forEach((idx, i) => {
    off[idx].zone = clamp(off[idx].zone + dir * moves[i], 1, 5);
  });

  // Defenders auto-track their man (1:1 by index, max 2-zone move)
  for (let i = 0; i < 3; i++) {
    const targetZone = off[i].zone;
    const distance = Math.abs(targetZone - def[i].zone);
    if (distance <= 2) {
      def[i].zone = targetZone;
    } else {
      const moveDir = targetZone > def[i].zone ? 1 : -1;
      def[i].zone = def[i].zone + 2 * moveDir;
    }
  }
}

// ===== Rendering =====
function renderPlayers(fullRender) {
  const ent = document.getElementById('entities');
  if (fullRender) ent.innerHTML = '';

  const all = [
    ...state.userPlayers.map((p, i) => ({ key: `u${i}`, idx: i, side: 'user', zone: p.zone })),
    ...state.oppPlayers.map((p, i) => ({ key: `o${i}`, idx: i, side: 'opp', zone: p.zone })),
  ];

  all.forEach((t) => {
    const isCarrier = state.possession === t.side && state.ballOwnerIdx === t.idx;
    let el = document.getElementById(`p-${t.key}`);
    if (!el) {
      el = document.createElement('div');
      el.id = `p-${t.key}`;
      ent.appendChild(el);
    }
    el.className = `player ${t.side}${isCarrier ? ' carrier' : ''}`;
    const oppLetter = (selectedTeam && selectedTeam.letter) || 'O';
    el.textContent = isCarrier ? '★' : `${t.side === 'user' ? 'U' : oppLetter}${t.idx + 1}`;
    el.style.left = `${zoneCenter(t.zone)}%`;
    el.style.top = `${(t.side === 'user' ? ROW_USER : ROW_OPP)[t.idx]}%`;
  });

  let ball = document.getElementById('ball');
  if (!ball) {
    ball = document.createElement('div');
    ball.id = 'ball';
    ball.className = 'ball';
    ent.appendChild(ball);
  }
  syncBallToCarrier(ball);

  document.getElementById('userScore').textContent = userScore;
  document.getElementById('oppScore').textContent = oppScore;
}

function syncBallToCarrier(ball) {
  const c = getCarrier();
  const row = (state.possession === 'user' ? ROW_USER : ROW_OPP)[state.ballOwnerIdx];
  ball.style.left = `${zoneCenter(c.zone)}%`;
  ball.style.top = `${row - 8}%`;
}

// ===== Action selection =====
function showSelectPanel() {
  hideAllPanels();
  document.getElementById('actionPanel').classList.remove('hidden');

  const possEl = document.getElementById('possession');
  if (state.possession === 'user') {
    possEl.innerHTML = '⛹ Your possession';
    showOffensiveActions();
  } else {
    const stackHTML = userDefenderStack > 0
      ? `<span class="stack">Stack ${userDefenderStack} (+${stackBuffAt(userDefenderStack)}pp ready)</span>`
      : '';
    possEl.innerHTML = `⛹ Opp possession — defend!${stackHTML}`;
    showDefensiveActions();
  }
}

function showOffensiveActions() {
  document.getElementById('actionPanelTitle').textContent = 'Pick your action';

  const off = offense();
  const cZone = off[state.ballOwnerIdx].zone;
  const offBall = [0, 1, 2].filter((i) => i !== state.ballOwnerIdx);
  const teamLetter = 'U';

  const opts = [
    { id: 'dribble', label: 'DRIBBLE', meta: `Z${cZone} → Z${Math.min(cZone + 1, 5)}` },
    {
      id: `pass-${offBall[0]}`,
      label: `PASS → ${teamLetter}${offBall[0] + 1}`,
      meta: `${Math.max(1, Math.abs(cZone - off[offBall[0]].zone))}-zone pass`,
    },
    {
      id: `pass-${offBall[1]}`,
      label: `PASS → ${teamLetter}${offBall[1] + 1}`,
      meta: `${Math.max(1, Math.abs(cZone - off[offBall[1]].zone))}-zone pass`,
    },
    { id: 'shoot', label: 'SHOOT', meta: `from Z${cZone} · ${pointsFor(cZone, 'user')}pt` },
  ];

  renderActionButtons(opts, chooseUserOffensiveAction);
  document.getElementById('hint').textContent = isContested()
    ? `Defender contesting in Z${cZone} — −${CONTEST_PENALTY}pp`
    : `Open look — no defender in your zone`;
}

function showDefensiveActions() {
  document.getElementById('actionPanelTitle').textContent = 'Defend!';
  const desc = describeOppAction();

  let opts;
  if (state.oppAction === 'shoot') {
    opts = [{ id: 'block', label: 'BLOCK', meta: `${BLOCK_BASE}% base` }];
  } else if (state.oppAction.startsWith('pass')) {
    opts = [
      { id: 'intercept', label: 'INTERCEPT', meta: `${INTERCEPT_BASE}% base` },
      { id: 'position', label: 'POSITION', meta: positionMetaText() },
    ];
  } else {
    opts = [
      { id: 'steal', label: 'STEAL', meta: `${STEAL_BASE}% base` },
      { id: 'position', label: 'POSITION', meta: positionMetaText() },
    ];
  }
  renderActionButtons(opts, chooseUserDefensiveAction);
  document.getElementById('hint').textContent = `Opp action: ${desc}`;
}

function positionMetaText() {
  const next = userDefenderStack + 1;
  return `+${stackBuffAt(next)}pp buff (stack ${next})`;
}

function describeOppAction() {
  const cZone = getCarrier().zone;
  if (state.oppAction === 'shoot') {
    const pts = pointsFor(cZone, 'opp');
    return `Shooting from Z${cZone} (${pts}pt attempt)`;
  }
  if (state.oppAction === 'dribble') {
    return `Dribbling Z${cZone} → Z${Math.max(cZone - 1, 1)}`;
  }
  const tIdx = state.oppTarget;
  const tZone = state.oppPlayers[tIdx].zone;
  const oppLetter = (selectedTeam && selectedTeam.letter) || 'O';
  return `Passing to ${oppLetter}${tIdx + 1} (Z${tZone})`;
}

function renderActionButtons(opts, handler) {
  const actionsEl = document.getElementById('actions');
  actionsEl.innerHTML = '';
  actionsEl.style.gridTemplateColumns = `repeat(${opts.length}, 1fr)`;
  opts.forEach((opt) => {
    const btn = document.createElement('button');
    btn.innerHTML = `${opt.label}<span class="meta">${opt.meta}</span>`;
    btn.onclick = () => handler(opt.id);
    actionsEl.appendChild(btn);
  });
}

function chooseUserOffensiveAction(actionId) {
  state.action = actionId;
  state.target = actionId.startsWith('pass-') ? parseInt(actionId.split('-')[1], 10) : null;
  const kind = actionId.startsWith('pass') ? 'pass' : actionId;
  state.snippet = pickSnippet(kind, selectedTeam && selectedTeam.lang);
  state.timeLimit = timeLimitFor(kind);
  beginTyping();
}

function chooseUserDefensiveAction(actionId) {
  state.action = actionId;
  state.target = null;
  state.snippet = pickSnippet(actionId, selectedTeam && selectedTeam.lang);
  state.timeLimit = timeLimitFor(actionId);
  beginTyping();
}

// ===== Typing =====
function beginTyping() {
  state.typed = '';
  state.typos = 0;
  state.typeStart = performance.now();
  state.phase = 'typing';

  hideAllPanels();
  document.getElementById('typingPanel').classList.remove('hidden');

  const cZone = getCarrier().zone;
  const titles = {
    dribble: 'Dribbling',
    shoot: `Shooting from Z${cZone}`,
    steal: 'Going for the steal',
    intercept: 'Going for the intercept',
    block: 'Going for the block',
    position: `Positioning (stack → ${userDefenderStack + 1})`,
  };
  let title;
  if (state.action.startsWith('pass-')) {
    title = `Passing to U${state.target + 1}`;
  } else {
    title = titles[state.action] || 'Typing';
  }
  document.getElementById('typingTitle').textContent = title;
  document.getElementById('snippetLang').textContent = LANG_DISPLAY[state.snippet.lang] || state.snippet.lang.toUpperCase();

  renderSnippet();
  document.getElementById('timeLeft').textContent = state.timeLimit.toFixed(1);
  document.getElementById('speedBonus').textContent = SPEED_BONUS_MAX;
  document.getElementById('typoCount').textContent = '0';
  document.getElementById('timerFill').style.width = '100%';

  state.timer = setInterval(updateTimer, 50);
}

function renderSnippet() {
  const snipEl = document.getElementById('snippet');
  snipEl.innerHTML = '';
  const text = state.snippet.text;
  for (let i = 0; i < text.length; i++) {
    const span = document.createElement('span');
    span.className = 'ch';
    span.textContent = text[i];
    if (i < state.typed.length) {
      span.classList.add(state.typed[i] === text[i] ? 'correct' : 'wrong');
    } else if (i === state.typed.length) {
      span.classList.add('current');
    }
    snipEl.appendChild(span);
  }
  document.getElementById('typoCount').textContent = state.typos;
}

function updateTimer() {
  if (!state || state.phase !== 'typing') return;
  const elapsed = (performance.now() - state.typeStart) / 1000;
  const remaining = Math.max(0, state.timeLimit - elapsed);
  document.getElementById('timeLeft').textContent = remaining.toFixed(1);
  document.getElementById('timerFill').style.width = `${(remaining / state.timeLimit) * 100}%`;
  const liveBonus = Math.max(0, Math.round(SPEED_BONUS_MAX * (remaining / state.timeLimit)));
  document.getElementById('speedBonus').textContent = liveBonus;
  if (remaining <= 0) finishTyping(true);
}

document.addEventListener('keydown', (e) => {
  if (!state || state.phase !== 'typing') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'Backspace') {
    state.typed = state.typed.slice(0, -1);
    e.preventDefault();
  } else if (e.key === 'Enter') {
    const missing = state.snippet.text.length - state.typed.length;
    if (missing > 0) state.typos += missing;
    e.preventDefault();
    renderSnippet();
    finishTyping(false);
    return;
  } else if (e.key.length === 1) {
    const expected = state.snippet.text[state.typed.length];
    if (e.key !== expected) state.typos++;
    state.typed += e.key;
    e.preventDefault();
  } else {
    return;
  }
  renderSnippet();
  if (state.typed === state.snippet.text) finishTyping(false);
});

// ===== Resolution =====
async function finishTyping(timedOut) {
  if (state.phase !== 'typing') return;
  state.phase = 'resolving';
  clearInterval(state.timer);

  // Stats
  stats.snippetsTyped++;
  stats.totalChars += state.snippet.text.length;
  stats.totalTypos += state.typos;
  const elapsed = Math.min((performance.now() - state.typeStart) / 1000, state.timeLimit);
  stats.totalTimeTyped += elapsed;

  const actionKind = state.action.startsWith('pass') ? 'pass' : state.action;

  if (actionKind === 'position') {
    await handlePositionOutcome(timedOut);
    return;
  }

  // Compute base
  let base = 0;
  let contestApplies = false;
  const carrier = getCarrier();
  if (state.possession === 'user') {
    if (actionKind === 'shoot') {
      base = shootBase(carrier.zone, 'user');
      contestApplies = isContested();
    } else if (actionKind === 'dribble') {
      base = DRIBBLE_BASE;
      contestApplies = isContested();
    } else {
      const tZone = state.userPlayers[state.target].zone;
      const dist = Math.max(1, Math.abs(carrier.zone - tZone));
      base = PASS_BASE[dist] || 50;
      contestApplies = isContested();
    }
  } else {
    if (actionKind === 'block') base = BLOCK_BASE;
    else if (actionKind === 'steal') base = STEAL_BASE;
    else if (actionKind === 'intercept') base = INTERCEPT_BASE;
  }

  if (contestApplies) base -= CONTEST_PENALTY;

  let stackBuff = 0;
  if (state.possession === 'opp' && userDefenderStack > 0) {
    stackBuff = stackBuffAt(userDefenderStack);
    state.appliedStack = stackBuff;
  }

  const speedFrac = timedOut ? 0 : Math.max(0, 1 - (performance.now() - state.typeStart) / 1000 / state.timeLimit);
  const speedBonus = SPEED_BONUS_MAX * speedFrac;
  const typoPenalty = (state.typos / state.snippet.text.length) * TYPO_PENALTY_MULT;

  let finalRaw, mathStr;
  if (timedOut) {
    finalRaw = base * TIMEOUT_FACTOR;
    mathStr = `TIMEOUT\nfinal = base ${base.toFixed(0)}% × ${TIMEOUT_FACTOR} = ${finalRaw.toFixed(1)}%`;
  } else {
    const sub = base + speedBonus + stackBuff;
    finalRaw = sub - typoPenalty;
    mathStr =
      `base ${base.toFixed(0)}%` +
      (contestApplies ? ` (incl. −${CONTEST_PENALTY} contest)` : '') +
      (stackBuff > 0 ? ` + stack +${stackBuff}pp` : '') +
      ` + speed +${speedBonus.toFixed(1)}pp` +
      ` − typos ${typoPenalty.toFixed(1)}pp` +
      `\n= ${finalRaw.toFixed(1)}%`;
  }

  const finalPct = clamp(finalRaw, FLOOR_PCT, CEIL_PCT);
  const roll = Math.random() * 100;
  const success = roll <= finalPct;

  state.lastResolution = { finalRaw, finalPct, roll, success, mathStr, timedOut };

  // Apply state changes from outcome
  if (state.possession === 'user') {
    state.lastResolution.outcome = computeOffensiveOutcome(success);
  } else {
    userDefenderStack = 0; // any non-position defensive action consumes the stack
    state.lastResolution.outcome = resolveDefensiveOutcome(success);
  }

  await animateAction(success);
  if (isPossessionContinuing()) await animateMovement();
  showResolution();
}

async function handlePositionOutcome(timedOut) {
  const stackLevel = userDefenderStack + 1;
  const baseBuff = stackBuffAt(stackLevel);
  const text = state.snippet.text;

  let actualBuff, mathStr;
  if (timedOut) {
    actualBuff = 0;
    mathStr = `Position TIMEOUT — buff = 0`;
  } else {
    const typoRate = state.typos / text.length;
    const scale = Math.max(0, 1 - typoRate * 1.5);
    actualBuff = Math.round(baseBuff * scale);
    mathStr = `Position +${baseBuff}pp (stack ${stackLevel} base) × ${scale.toFixed(2)} typo scale = +${actualBuff}pp`;
  }

  const success = actualBuff > 0;
  if (success) userDefenderStack = Math.min(userDefenderStack + 1, STACK_BUFFS.length);

  // Opp's offensive action proceeds (updates state if pass/dribble succeeds)
  const oppOutcome = rollOppOffensive();

  state.lastResolution = {
    isPosition: true,
    success,
    buff: actualBuff,
    mathStr,
    finalPct: 0,
    roll: 0,
    outcome: { oppOutcome },
  };

  await animateAction(false);
  if (isPossessionContinuing()) await animateMovement();
  showResolution();
}

function computeOffensiveOutcome(success) {
  const action = state.action;
  if (action === 'shoot') {
    const c = getCarrier();
    const pts = pointsFor(c.zone, 'user');
    if (success) {
      userScore += pts;
      stats.fgMade++;
      if (pts === 3) stats.threesMade++;
    }
    stats.fgAttempted++;
    if (pts === 3) stats.threesAttempted++;
    return { type: 'shoot', success, pts };
  } else if (action.startsWith('pass-')) {
    const targetIdx = state.target;
    stats.passesAttempted++;
    if (success) {
      stats.passesCompleted++;
      state.ballOwnerIdx = targetIdx; // ball moves to receiver
    } else {
      stats.turnovers++;
    }
    return { type: 'pass', success, targetIdx };
  } else if (action === 'dribble') {
    if (success) {
      const c = getCarrier();
      c.zone = clamp(c.zone + 1, 1, 5); // user advances toward zone 5
    } else {
      stats.turnovers++;
    }
    return { type: 'dribble', success };
  }
  return { type: action, success };
}

function resolveDefensiveOutcome(defenseSuccess) {
  const action = state.action;
  const outcome = { type: action, defenseSuccess, oppActionTaken: state.oppAction };
  if (defenseSuccess) {
    if (action === 'steal') stats.steals++;
    else if (action === 'block') stats.blocks++;
    else if (action === 'intercept') stats.intercepts++;
    outcome.message = `${action.toUpperCase()} succeeds — your ball!`;
  } else {
    const oppOutcome = rollOppOffensive();
    outcome.oppOutcome = oppOutcome;
    outcome.message = oppOutcome.text;
  }
  return outcome;
}

function rollOppOffensive() {
  const oa = state.oppAction;
  const carrier = getCarrier();
  let base;
  if (oa === 'shoot') {
    base = shootBase(carrier.zone, 'opp');
  } else if (oa === 'dribble') {
    base = DRIBBLE_BASE;
  } else {
    const tIdx = state.oppTarget;
    const tZone = state.oppPlayers[tIdx].zone;
    const dist = Math.max(1, Math.abs(carrier.zone - tZone));
    base = PASS_BASE[dist] || 50;
  }
  if (isContested()) base -= CONTEST_PENALTY;
  base += AI_BONUS;
  base = clamp(base, FLOOR_PCT, CEIL_PCT);

  const roll = Math.random() * 100;
  const success = roll <= base;

  if (oa === 'shoot') {
    const pts = pointsFor(carrier.zone, 'opp');
    if (success) oppScore += pts;
    return { action: 'shoot', success, pts, text: success ? `Opp drains a ${pts}-pointer (+${pts})` : `Opp's ${pts}pt attempt misses` };
  } else if (oa.startsWith('pass')) {
    if (success) state.ballOwnerIdx = state.oppTarget;
    const oppLetter = (selectedTeam && selectedTeam.letter) || 'O';
    return { action: 'pass', success, text: success ? `Opp pass complete to ${oppLetter}${state.oppTarget + 1}` : `Opp pass fails — your ball!` };
  } else {
    if (success) {
      const c = getCarrier();
      c.zone = clamp(c.zone - 1, 1, 5);
    }
    return { action: 'dribble', success, text: success ? `Opp dribbles forward` : `Opp loses control — your ball!` };
  }
}

// ===== Animation =====
async function animateAction(success) {
  if (state.possession === 'user') {
    if (state.action === 'shoot') return animateShot('user', success);
    if (state.action.startsWith('pass-') || state.action === 'dribble') {
      // State has been updated; just sync DOM with CSS transition
      renderPlayers(false);
      await sleep(750);
      return;
    }
  } else {
    if (state.action === 'position') return animateOppActionVisual();
    if (success) {
      // Defense succeeded: show off-ball opp running into position briefly
      // (the play was developing — you cut it short), THEN the steal/block/intercept.
      applyMovement();
      renderPlayers(false);
      await sleep(480);
      return animateBallToDefender();
    }
    return animateOppActionVisual();
  }
}

async function animateShot(side, success) {
  const ball = document.getElementById('ball');
  if (!ball) return;
  ball.style.left = side === 'user' ? '95%' : '5%';
  ball.style.top = '15%';
  await sleep(620);
  if (success) {
    ball.style.top = '50%';
    ball.style.left = side === 'user' ? '98%' : '2%';
    sounds.swish();
  } else {
    ball.style.top = '60%';
    ball.style.left = side === 'user' ? '78%' : '22%';
    sounds.clank();
  }
  await sleep(780);
}

async function animateOppActionVisual() {
  const oa = state.oppAction;
  const oppOutcome = state.lastResolution?.outcome?.oppOutcome;
  const success = oppOutcome?.success;

  if (oa === 'shoot') {
    return animateShot('opp', success);
  }

  if (oa.startsWith('pass')) {
    // Visible arc: ball lifts up (off-screen route), then drops to receiver
    const ball = document.getElementById('ball');
    if (ball) {
      const tIdx = state.oppTarget;
      const tZone = state.oppPlayers[tIdx].zone;
      const tRow = ROW_OPP[tIdx];
      ball.style.top = '20%';
      await sleep(300);
      if (success) {
        ball.style.left = `${zoneCenter(tZone)}%`;
        ball.style.top = `${tRow - 8}%`;
      } else {
        const cZone = state.oppPlayers[state.ballOwnerIdx].zone;
        ball.style.left = `${(zoneCenter(cZone) + zoneCenter(tZone)) / 2}%`;
        ball.style.top = '60%';
      }
    }
    renderPlayers(false);
    await sleep(550);
    return;
  }

  // Dribble: state already updated, just sync DOM
  renderPlayers(false);
  await sleep(750);
}

async function animateBallToDefender() {
  // First show what the opp WAS trying to do, then the user defender intercepts/blocks/steals.
  const ball = document.getElementById('ball');
  if (!ball) return;

  const oa = state.oppAction;
  if (oa === 'shoot') {
    // Opp lifts ball toward their hoop (zone 1 side, left of court)
    ball.style.left = '12%';
    ball.style.top = '22%';
    await sleep(440);
  } else if (oa && oa.startsWith('pass')) {
    // Opp launches pass toward intended teammate; ball arcs partway before getting picked off
    const tIdx = state.oppTarget;
    const tZone = state.oppPlayers[tIdx].zone;
    const tRow = ROW_OPP[tIdx];
    const cZone = state.oppPlayers[state.ballOwnerIdx].zone;
    const cRow = ROW_OPP[state.ballOwnerIdx];
    ball.style.left = `${(zoneCenter(cZone) + zoneCenter(tZone)) / 2}%`;
    ball.style.top = `${Math.min(cRow, tRow) - 18}%`;
    await sleep(400);
  } else if (oa === 'dribble') {
    // Opp tries to push forward briefly before getting stripped
    const idx = state.ballOwnerIdx;
    const carrierEl = document.getElementById(`p-o${idx}`);
    if (carrierEl) {
      const cZone = state.oppPlayers[idx].zone;
      const advancedZone = Math.max(1, cZone - 1);
      carrierEl.style.left = `${zoneCenter(advancedZone)}%`;
      ball.style.left = `${zoneCenter(advancedZone)}%`;
      await sleep(380);
      // Snap carrier back to original spot (state.zone unchanged on steal success)
      carrierEl.style.left = `${zoneCenter(cZone)}%`;
    } else {
      await sleep(320);
    }
  }

  // Then the ball is taken by the user defender. For an intercept, that's the defender
  // matched to the receiver (oppTarget). For block/steal, the one matched to the carrier.
  const defenderIdx = state.action === 'intercept' ? state.oppTarget : state.ballOwnerIdx;
  const def = state.userPlayers[defenderIdx];
  ball.style.left = `${zoneCenter(def.zone)}%`;
  ball.style.top = `${ROW_USER[defenderIdx] - 8}%`;
  await sleep(580);
}

async function animateMovement() {
  applyMovement();
  renderPlayers(false);
  await sleep(780);
}

// ===== Resolution display =====
function showResolution() {
  state.phase = 'resolution';
  hideAllPanels();
  document.getElementById('resolutionPanel').classList.remove('hidden');

  const res = state.lastResolution;
  const resEl = document.getElementById('result');
  const subEl = document.getElementById('resultSub');
  const mathEl = document.getElementById('math');
  subEl.textContent = '';

  let resultText, success;

  if (res.isPosition) {
    success = res.success;
    resultText = success
      ? `✓ POSITIONED — +${res.buff}pp buff stacked`
      : '✗ POSITION FAILED — no buff';
    if (res.outcome?.oppOutcome) subEl.textContent = res.outcome.oppOutcome.text;
    mathEl.textContent = res.mathStr;
  } else if (state.possession === 'user') {
    const out = res.outcome;
    success = res.success;
    if (out.type === 'shoot') {
      resultText = success ? `✓ ${out.pts}-POINTER MADE — +${out.pts}!` : `✗ MISSED ${out.pts}-POINT ATTEMPT`;
    } else if (out.type === 'pass') {
      resultText = success
        ? `✓ PASS COMPLETE — ball with U${out.targetIdx + 1}`
        : `✗ PASS FAILED — turnover to ${(selectedTeam && selectedTeam.name) || 'opp'}`;
    } else if (out.type === 'dribble') {
      resultText = success ? '✓ DRIBBLE — advanced 1 zone' : '✗ LOST THE BALL';
    } else {
      resultText = success ? '✓ Action succeeded' : '✗ Action failed';
    }
    mathEl.textContent =
      `${res.mathStr}\nclamped to ${res.finalPct.toFixed(1)}% · rolled ${res.roll.toFixed(1)} → ${success ? 'HIT' : 'MISS'}`;
  } else {
    const out = res.outcome;
    success = res.success;
    resultText = success
      ? `✓ ${state.action.toUpperCase()} — your ball!`
      : `✗ ${state.action.toUpperCase()} failed`;
    if (!success && out.oppOutcome) subEl.textContent = out.oppOutcome.text;
    mathEl.textContent =
      `${res.mathStr}\nclamped to ${res.finalPct.toFixed(1)}% · rolled ${res.roll.toFixed(1)} → ${success ? 'HIT' : 'MISS'}`;
    if (success) sounds.steal();
  }

  resEl.className = `result ${success ? 'success' : 'fail'}`;
  resEl.textContent = resultText;

  document.getElementById('userScore').textContent = userScore;
  document.getElementById('oppScore').textContent = oppScore;
}

// ===== Possession transition =====
function isPossessionContinuing() {
  const res = state.lastResolution;
  if (state.possession === 'user') {
    const out = res.outcome;
    if (out.type === 'shoot') return false;
    if (out.type === 'pass') return out.success;
    if (out.type === 'dribble') return out.success;
    return false;
  }
  if (res.success && !res.isPosition) return false; // turnover via defense
  const oa = res.outcome?.oppOutcome;
  if (!oa) return false;
  if (oa.action === 'shoot') return false;
  if (oa.action === 'pass') return oa.success;
  if (oa.action === 'dribble') return oa.success;
  return false;
}

function onNext() {
  if (matchOver) return endMatch();
  if (isPossessionContinuing()) {
    continueTurn();
  } else {
    const next = state.possession === 'user' ? 'opp' : 'user';
    startPossession(next);
  }
}

// ===== Helpers =====
function hideAllPanels() {
  ['actionPanel', 'typingPanel', 'resolutionPanel', 'endPanel'].forEach((id) => {
    document.getElementById(id).classList.add('hidden');
  });
}

document.getElementById('nextBtn').addEventListener('click', onNext);
document.getElementById('rematchBtn').addEventListener('click', () => {
  if (selectedTeam) startMatch();
  else showMenu();
});
document.getElementById('menuBtn').addEventListener('click', showMenu);

// Global click delegation: unlock audio + play click sound on interactive elements
document.addEventListener('click', (e) => {
  unlockAudio();
  const target = e.target.closest('button, .team-card');
  if (!target) return;
  if (target.classList.contains('locked')) return;
  sounds.click();
});

// Menu footer actions
document.getElementById('soundBtn')?.addEventListener('click', () => {
  soundOn = !soundOn;
  document.getElementById('soundBtn').textContent = `🔊 Sound: ${soundOn ? 'ON' : 'OFF'}`;
});
document.getElementById('resetBtn')?.addEventListener('click', () => {
  if (confirm('Reset all progress? This will clear your win/loss records for every team.')) {
    try { localStorage.removeItem(PROGRESS_KEY); } catch {}
    renderTeams();
  }
});

// Bootstrap
showMenu();
