import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyA7A7sBin8tIOPxNzBspVLwHxNiDlMstq4",
    authDomain: "neon-snake-game-eadb5.firebaseapp.com",
    projectId: "neon-snake-game-eadb5",
    storageBucket: "neon-snake-game-eadb5.firebasestorage.app",
    messagingSenderId: "987724873748",
    appId: "1:987724873748:web:d228086f81e0ab3c9ce701"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- DOM References ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('highScore');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const playerNameInput = document.getElementById('playerNameInput');
const hudPlayerName = document.getElementById('hudPlayerName');
const hudGridSize = document.getElementById('hudGridSize');
const hudDifficulty = document.getElementById('hudDifficulty');
const hudSpeed = document.getElementById('hudSpeed');
const messageOverlay = document.getElementById('messageOverlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayActionBtn = document.getElementById('overlayActionBtn');
const setupForm = document.getElementById('setupForm');
const leaderboardList = document.getElementById('leaderboardList');
const refreshLeaderboardBtn = document.getElementById('refreshLeaderboard');
const gridSizeBtns = document.querySelectorAll('.grid-size-btn');
const diffBtns = document.querySelectorAll('.diff-btn');

// --- Configurations ---
const GRID_SIZES = { big: 40, small: 20, tiny: 12 };
const DIFFICULTY_CONFIG = {
    slow:   { base: 120, min: 60, step: 6, points: 8 },
    normal: { base: 85,  min: 45, step: 5, points: 10 },
    fast:   { base: 55,  min: 30, step: 3, points: 12 }
};

let currentGridKey = 'small';
let gridSize = GRID_SIZES[currentGridKey];
let currentDiffKey = 'normal';

// Dynamic Rectangular Board
let tileCountX = 20;
let tileCountY = 20;

// Game State
let snake = [{ x: 10, y: 10 }];
let food = {};
let specialFood = null;
let dx = 0;
let dy = 0;
let score = 0;
let changingDirection = false;
let gamePaused = true;
let gameOver = false;
let gameLoopTimeout = null;

// Power-up State
let redSlowMod = 0;
let goldBuffExpiresAt = 0;

// High Score Cache
let highScore = parseInt(localStorage.getItem('snakeHighScore') || '0', 10);
let highScorePlayer = localStorage.getItem('snakeHighScorePlayer') || 'ANON';

// --- Utility Helpers ---
function addSafeListener(elOrId, event, handler) {
    const target = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (target) target.addEventListener(event, handler);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Speed Calculation ---
function getEffectiveSpeedMultiplier() {
    const config = DIFFICULTY_CONFIG[currentDiffKey];
    const pointsTier = Math.floor(score / 50);
    const naturalSpeed = Math.max(config.min, config.base - (pointsTier * config.step));
    let mult = config.base / naturalSpeed;
    mult = Math.max(0.6, mult - redSlowMod);

    if (Date.now() < goldBuffExpiresAt) {
        mult += 0.5;
    }
    return mult;
}

function getCurrentSpeedInterval() {
    const config = DIFFICULTY_CONFIG[currentDiffKey];
    const mult = getEffectiveSpeedMultiplier();
    return Math.max(25, Math.round(config.base / mult));
}

function updateHUD() {
    const name = playerNameInput ? (playerNameInput.value.trim() || 'ANON') : 'ANON';
    if (hudPlayerName) hudPlayerName.textContent = name.toUpperCase();
    if (hudGridSize) hudGridSize.textContent = `${currentGridKey.toUpperCase()} (${gridSize}px)`;
    if (hudDifficulty) hudDifficulty.textContent = `${currentDiffKey.toUpperCase()} (${DIFFICULTY_CONFIG[currentDiffKey].points}pt)`;
    if (hudSpeed) hudSpeed.textContent = `${getEffectiveSpeedMultiplier().toFixed(1)}x`;
    if (scoreEl) scoreEl.textContent = score;
    if (highScoreEl) highScoreEl.textContent = highScore > 0 ? `${highScore} (${highScorePlayer})` : '0 (ANON)';
}

// --- Canvas Sizing ---
function resizeBoard() {
    if (!canvas) return;
    const stage = document.getElementById('canvasStage') || canvas.parentElement;
    if (!stage) return;

    // Use safe fallbacks if the layout hasn't painted dimensions yet
    const availableWidth = stage.clientWidth || window.innerWidth - 32 || 400;
    const availableHeight = stage.clientHeight || window.innerHeight - 120 || 400;

    tileCountX = Math.max(10, Math.floor(availableWidth / gridSize));
    tileCountY = Math.max(8, Math.floor(availableHeight / gridSize));

    const snappedWidth = tileCountX * gridSize;
    const snappedHeight = tileCountY * gridSize;

    canvas.width = snappedWidth;
    canvas.height = snappedHeight;
    canvas.style.width = `${snappedWidth}px`;
    canvas.style.height = `${snappedHeight}px`;

    if (messageOverlay) {
        messageOverlay.style.width = `${snappedWidth}px`;
        messageOverlay.style.height = `${snappedHeight}px`;
        messageOverlay.style.margin = 'auto';
    }

    render();
}

// --- Food & Spawning ---
function isOccupied(x, y) {
    return snake.some(seg => seg.x === x && seg.y === y);
}

function generateFood() {
    if (!tileCountX || !tileCountY) return;
    let newFoodPosition;
    do {
        newFoodPosition = {
            x: Math.floor(Math.random() * tileCountX),
            y: Math.floor(Math.random() * tileCountY)
        };
    } while (isOccupied(newFoodPosition.x, newFoodPosition.y));
    food = newFoodPosition;

    maybeSpawnPowerup();
}

function maybeSpawnPowerup() {
    if (specialFood && specialFood.expiresAt && Date.now() > specialFood.expiresAt) {
        specialFood = null;
    }
    if (specialFood) return;

    const roll = Math.random();
    if (roll < 0.15 && Date.now() > goldBuffExpiresAt) {
        spawnSpecial('gold');
    } else if (roll < 0.33) {
        spawnSpecial('green', 10000);
    } else if (roll < 0.48 && score >= 200) {
        spawnSpecial('red');
    }
}

function spawnSpecial(type, durationMs = null) {
    if (!tileCountX || !tileCountY) return;
    let pos;
    do {
        pos = {
            x: Math.floor(Math.random() * tileCountX),
            y: Math.floor(Math.random() * tileCountY)
        };
    } while (isOccupied(pos.x, pos.y) || (food.x === pos.x && food.y === pos.y));

    specialFood = {
        ...pos,
        type,
        totalDuration: durationMs,
        expiresAt: durationMs ? Date.now() + durationMs : null
    };
}

// --- Game Logic ---
function resetGame() {
    clearTimeout(gameLoopTimeout);
    const cx = Math.floor((tileCountX || 20) / 2);
    const cy = Math.floor((tileCountY || 20) / 2);
    snake = [{ x: cx, y: cy }];
    dx = 0;
    dy = 0;
    score = 0;
    gameOver = false;
    gamePaused = true;
    changingDirection = false;
    specialFood = null;
    redSlowMod = 0;
    goldBuffExpiresAt = 0;

    updateHUD();
    generateFood();
    render();
}

function gameTick() {
    if (gamePaused || gameOver) return;

    changingDirection = false;
    const head = { x: snake[0].x + dx, y: snake[0].y + dy };

    // Wall & self collision
    if (head.x < 0 || head.x >= tileCountX || head.y < 0 || head.y >= tileCountY) {
        handleGameOver();
        return;
    }
    for (let i = 1; i < snake.length; i++) {
        if (snake[i].x === head.x && snake[i].y === head.y) {
            handleGameOver();
            return;
        }
    }

    // Normal Cherry (Blue)
    if (head.x === food.x && head.y === food.y) {
        const basePts = DIFFICULTY_CONFIG[currentDiffKey].points;
        const bonus = Date.now() < goldBuffExpiresAt ? 1 : 0;
        score += (basePts + bonus);
        snake.unshift(head);
        generateFood();
    } else {
        snake.unshift(head);
        snake.pop();
    }

    // Special Cherries
    if (specialFood && head.x === specialFood.x && head.y === specialFood.y) {
        if (specialFood.type === 'red') redSlowMod += 0.2;
        else if (specialFood.type === 'green') score += 25;
        else if (specialFood.type === 'gold') goldBuffExpiresAt = Date.now() + 30000;
        specialFood = null;
    }

    updateHUD();
    render();
    gameLoopTimeout = setTimeout(gameTick, getCurrentSpeedInterval());
}

function startGame() {
    if (gameOver) {
        resetGame();
    }
    if (gamePaused) {
        if (dx === 0 && dy === 0) dx = 1;
        gamePaused = false;
        if (messageOverlay) messageOverlay.classList.add('hidden');
        if (setupForm) setupForm.classList.add('hidden');
        clearTimeout(gameLoopTimeout);
        gameTick();
    }
}

function pauseGame() {
    if (!gameOver && !gamePaused) {
        gamePaused = true;
        clearTimeout(gameLoopTimeout);
        if (overlayTitle) overlayTitle.textContent = 'PAUSED';
        if (overlayActionBtn) overlayActionBtn.textContent = 'RESUME';
        if (setupForm) setupForm.classList.add('hidden');
        if (messageOverlay) messageOverlay.classList.remove('hidden');
    }
}

async function handleGameOver() {
    gameOver = true;
    clearTimeout(gameLoopTimeout);
    if (overlayTitle) overlayTitle.textContent = 'GAME OVER';
    if (overlayActionBtn) overlayActionBtn.textContent = 'CONFIGURE RUN';
    if (setupForm) setupForm.classList.remove('hidden');
    if (messageOverlay) messageOverlay.classList.remove('hidden');

    const name = playerNameInput ? (playerNameInput.value.trim() || 'ANON') : 'ANON';
    await submitScore(name, score);
    loadLeaderboard();
}

function rotateDirection(clockwise = true) {
    if (dx === 0 && dy === 0) {
        dx = 1; dy = 0;
        return;
    }
    if (changingDirection) return;
    const nextDx = clockwise ? -dy : dy;
    const nextDy = clockwise ? dx : -dx;
    dx = nextDx;
    dy = nextDy;
    changingDirection = true;
}

// --- Renderer ---
function render() {
    if (!ctx || !canvas) return;

    ctx.fillStyle = '#06070a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid Dots
    ctx.fillStyle = '#171a22';
    ctx.shadowBlur = 0;
    const dotRadius = gridSize >= 36 ? 2 : gridSize >= 20 ? 1.25 : 0.85;
    for (let i = 0; i <= tileCountX; i++) {
        for (let j = 0; j <= tileCountY; j++) {
            ctx.beginPath();
            ctx.arc(i * gridSize, j * gridSize, dotRadius, 0, 2 * Math.PI);
            ctx.fill();
        }
    }

    // Snake
    const now = Date.now();
    const isGoldActive = now < goldBuffExpiresAt;
    const remainingGoldMs = isGoldActive ? goldBuffExpiresAt - now : 0;
    const renderGold = isGoldActive && (remainingGoldMs > 1000 || Math.floor(now / 100) % 2 === 0);

    snake.forEach((segment, index) => {
        const isHead = index === 0;
        if (renderGold) {
            ctx.fillStyle = '#fff066';
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = isHead ? 24 : 16;
        } else {
            const hue = (180 + index * 5) % 360;
            ctx.fillStyle = `hsl(${hue}, 100%, 55%)`;
            ctx.shadowColor = `hsl(${hue}, 100%, 70%)`;
            ctx.shadowBlur = isHead ? 18 : 12;
        }
        ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize, gridSize);
    });
    ctx.shadowBlur = 0;

    // Regular Cherry (Blue)
    if (food.x !== undefined) {
        const cx = food.x * gridSize + gridSize / 2;
        const cy = food.y * gridSize + gridSize / 2;
        const r = gridSize / 2;

        ctx.save();
        ctx.fillStyle = '#00e5ff';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = '#e6ffff';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
    }

    // Special Cherries
    if (!specialFood || (specialFood.expiresAt && now > specialFood.expiresAt)) return;

    const cx = specialFood.x * gridSize + gridSize / 2;
    const cy = specialFood.y * gridSize + gridSize / 2;
    const r = (gridSize / 2) - 1;

    ctx.save();
    if (specialFood.type === 'red') {
        ctx.fillStyle = '#ff1a40';
        ctx.shadowColor = '#ff2b56';
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = '#ffe6ea';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
    } else if (specialFood.type === 'gold') {
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = '#ffea00';
        ctx.shadowBlur = 24;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = '#fffdf0';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
    } else if (specialFood.type === 'green') {
        const remainingMs = Math.max(0, specialFood.expiresAt - now);
        const progress = remainingMs / specialFood.totalDuration;
        const alpha = remainingMs <= 3000 && Math.floor(now / 120) % 2 === 0 ? 0.25 : 1;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#00ff66';
        ctx.shadowColor = '#00ff66';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#e6fff0';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
        ctx.fill();

        const ringRadius = r * 1.35;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * progress));
        ctx.strokeStyle = '#00ff66';
        ctx.lineWidth = Math.max(2, gridSize * 0.1);
        ctx.shadowColor = '#00ff66';
        ctx.shadowBlur = 14;
        ctx.stroke();
    }
    ctx.restore();
}

// --- Firebase Operations ---
async function fetchGlobalHighScore() {
    try {
        const q = query(collection(db, 'highscores'), orderBy('score', 'desc'), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const top = snap.docs[0].data();
            if (top.score >= highScore) {
                highScore = top.score;
                highScorePlayer = top.player_name || 'ANON';
            }
        }
    } catch (e) {
        console.warn('Firebase top score fetch failed:', e);
    } finally {
        updateHUD();
    }
}

async function submitScore(playerName, scoreValue) {
    const isNewRecord = scoreValue > highScore;
    try {
        await addDoc(collection(db, 'highscores'), {
            player_name: playerName,
            score: scoreValue,
            timestamp: serverTimestamp()
        });
        if (isNewRecord) {
            if (overlayTitle) {
                overlayTitle.innerHTML = '🏆 NEW RECORD! 🏆<br><span class="text-xl mt-2 block">GAME OVER</span>';
            }
            highScore = scoreValue;
            highScorePlayer = playerName;
            localStorage.setItem('snakeHighScore', highScore);
            localStorage.setItem('snakeHighScorePlayer', highScorePlayer);
            updateHUD();
        }
    } catch (e) {
        if (isNewRecord) {
            highScore = scoreValue;
            highScorePlayer = playerName;
            localStorage.setItem('snakeHighScore', highScore);
            localStorage.setItem('snakeHighScorePlayer', highScorePlayer);
            updateHUD();
        }
    }
}

async function loadLeaderboard() {
    if (!leaderboardList) return;
    try {
        const q = query(collection(db, 'highscores'), orderBy('score', 'desc'), limit(15));
        const snap = await getDocs(q);
        const entries = snap.docs.map(d => d.data());

        if (entries.length === 0) {
            leaderboardList.innerHTML = '<div class="text-center text-gray-500 py-3 text-xs">No scores yet.</div>';
            return;
        }

        leaderboardList.innerHTML = entries.map((entry, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
            const cls = idx < 3 ? 'text-yellow-400 border-yellow-500/20' : 'text-gray-300 border-white/5';
            return `
                <div class="flex justify-between items-center px-2 py-1 bg-black/50 border ${cls} rounded text-xs">
                    <span class="font-bold w-6">${medal}</span>
                    <span class="flex-1 truncate px-2 font-mono">${escapeHtml(entry.player_name || 'ANON')}</span>
                    <span class="font-bold text-cyan-400">${entry.score}</span>
                </div>
            `;
        }).join('');
    } catch (e) {
        leaderboardList.innerHTML = '<div class="text-center text-neutral-500 py-4 text-xs">Offline - Cache Only</div>';
    }
}

// --- Event Handlers & Controls ---
window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ') {
        e.preventDefault();
        gamePaused ? startGame() : pauseGame();
    } else if (k === 'enter') {
        e.preventDefault();
        startGame();
    } else if (k === 'arrowleft' || k === 'a') {
        if (dx !== 1) { dx = -1; dy = 0; changingDirection = true; }
    } else if (k === 'arrowup' || k === 'w') {
        if (dy !== 1) { dx = 0; dy = -1; changingDirection = true; }
    } else if (k === 'arrowright' || k === 'd') {
        if (dx !== -1) { dx = 1; dy = 0; changingDirection = true; }
    } else if (k === 'arrowdown' || k === 's') {
        if (dy !== -1) { dx = 0; dy = 1; changingDirection = true; }
    }
});

if (canvas) {
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
        if (gamePaused || gameOver) {
            startGame();
            return;
        }
        e.preventDefault();
        rotateDirection(e.button === 2);
    });
}

window.addEventListener('resize', () => {
    const wasPaused = gamePaused;
    pauseGame();
    resizeBoard();
    if (!wasPaused && !gameOver && messageOverlay) {
        messageOverlay.classList.remove('hidden');
    }
});

addSafeListener(playBtn, 'click', startGame);
addSafeListener(pauseBtn, 'click', pauseGame);
addSafeListener(restartBtn, 'click', () => { resetGame(); startGame(); });
addSafeListener(overlayActionBtn, 'click', startGame);
addSafeListener(refreshLeaderboardBtn, 'click', loadLeaderboard);

if (playerNameInput) {
    playerNameInput.addEventListener('input', updateHUD);
}

gridSizeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const sizeKey = e.currentTarget.dataset.size;
        if (!GRID_SIZES[sizeKey]) return;
        currentGridKey = sizeKey;
        gridSize = GRID_SIZES[sizeKey];
        gridSizeBtns.forEach(b => b.classList.toggle('active', b === btn));
        resizeBoard();
        resetGame();
    });
});

diffBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const diff = e.currentTarget.dataset.diff;
        if (!DIFFICULTY_CONFIG[diff]) return;
        currentDiffKey = diff;
        diffBtns.forEach(b => b.classList.toggle('active', b === btn));
        updateHUD();
    });
});

// --- Initialization ---
function init() {
    resizeBoard();
    resetGame();
    updateHUD();

    if (overlayTitle) overlayTitle.textContent = 'NEON SNAKE';
    if (overlayActionBtn) overlayActionBtn.textContent = 'ENGAGE RUN';
    if (setupForm) setupForm.classList.remove('hidden');
    if (messageOverlay) messageOverlay.classList.remove('hidden');

    // Run network calls in parallel without blocking game interactivity
    fetchGlobalHighScore();
    loadLeaderboard();
}

// Ensure the DOM has painted so clientWidth/Height are non-zero
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}