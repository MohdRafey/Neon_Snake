import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

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

// DOM Elements
const canvas = document.getElementById('gameCanvas'); 
const ctx = canvas.getContext('2d'); 
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
const refreshLeaderboard = document.getElementById('refreshLeaderboard'); 
const gridSizeBtns = document.querySelectorAll('.grid-size-btn');
const diffBtns = document.querySelectorAll('.diff-btn');

// Grid Configurations
const GRID_SIZES = {
    big: 40,
    small: 20,
    tiny: 12
};
let currentGridKey = 'small';
let gridSize = GRID_SIZES[currentGridKey];
let tileCount; 

// Difficulty Configuration: 8, 10, 12 points
const DIFFICULTY_CONFIG = {
    slow:   { base: 120, min: 60, step: 6, points: 8 },
    normal: { base: 85,  min: 45, step: 5, points: 10 },
    fast:   { base: 55,  min: 30, step: 3, points: 12 }
};
let currentDiffKey = 'normal';

// Game State
let snake = [{ x: 10, y: 10 }]; 
let food = {}; // General Cherry (Blue) 
let specialFood = null; // { x, y, type: 'red' | 'green' | 'gold', totalDuration, expiresAt }
let dx = 0; 
let dy = 0; 
let score = 0; 
let changingDirection = false; 
let gamePaused = true; 
let gameOver = false; 
let hasStartedOnce = false;
let gameLoopTimeout = null;

// Buff System
let redSlowMod = 0; // Speed reduction caused by Red dot
let goldBuffExpiresAt = 0; // Timestamp for active Gold snake state

// High Score Cache
let highScore = parseInt(localStorage.getItem('snakeHighScore') || '0', 10); 
let highScorePlayer = localStorage.getItem('snakeHighScorePlayer') || 'ANON'; 

// --- Speed Calculation ---

function getEffectiveSpeedMultiplier() {
    const config = DIFFICULTY_CONFIG[currentDiffKey];
    const pointsTier = Math.floor(score / 50);
    const naturalSpeed = Math.max(config.min, config.base - (pointsTier * config.step));
    
    let mult = config.base / naturalSpeed;
    // Red slow reduction
    mult = Math.max(0.6, mult - redSlowMod);

    // Gold Surge boost (+0.5x)
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

function updateSpeedHUD() {
    const mult = getEffectiveSpeedMultiplier();
    if (hudSpeed) {
        hudSpeed.textContent = `${mult.toFixed(1)}x`;
    }
}

// --- Firebase Operations ---

function updateHighScoreDisplay() {
    if (!highScoreEl) return;
    highScoreEl.textContent = highScore > 0 ? `${highScore} (${highScorePlayer})` : '0 (ANON)';
}

async function fetchGlobalHighScore() {
    try {
        const q = query(collection(db, 'highscores'), orderBy('score', 'desc'), limit(1)); 
        const querySnapshot = await getDocs(q); 
        
        if (!querySnapshot.empty) { 
            const topScore = querySnapshot.docs[0].data(); 
            if (topScore.score >= highScore) {
                highScore = topScore.score; 
                highScorePlayer = topScore.player_name || 'ANON';
            }
        }
    } catch (error) {
        console.warn('Firebase top score fetch fallback to local cache:', error);
    } finally {
        updateHighScoreDisplay();
    }
}

async function submitScoreToFirebase(playerName, scoreValue) {
    try {
        await addDoc(collection(db, 'highscores'), { 
            player_name: playerName, 
            score: scoreValue, 
            timestamp: serverTimestamp() 
        });
        
        const isNewRecord = scoreValue > highScore; 
        if (isNewRecord) { 
            overlayTitle.innerHTML = '🏆 NEW RECORD! 🏆<br><span class="text-xl mt-2 block">GAME OVER</span>';
            highScore = scoreValue; 
            highScorePlayer = playerName; 
            localStorage.setItem('snakeHighScore', highScore); 
            localStorage.setItem('snakeHighScorePlayer', highScorePlayer); 
            updateHighScoreDisplay();
        } else {
            overlayTitle.textContent = 'GAME OVER'; 
        }
        
        await fetchLeaderboard(); 
        return { success: true, isNewRecord }; 
    } catch (error) {
        if (scoreValue > highScore) { 
            highScore = scoreValue; 
            highScorePlayer = playerName; 
            localStorage.setItem('snakeHighScore', highScore); 
            localStorage.setItem('snakeHighScorePlayer', highScorePlayer); 
            updateHighScoreDisplay();
        }
        return { success: false }; 
    }
}

async function fetchLeaderboard() {
    try {
        const q = query(collection(db, 'highscores'), orderBy('score', 'desc'), limit(15));
        const querySnapshot = await getDocs(q); 
        
        const leaderboard = []; 
        querySnapshot.forEach((doc) => { 
            leaderboard.push(doc.data()); 
        });
        displayLeaderboard(leaderboard); 
    } catch (error) {
        console.warn('Leaderboard fetch failed:', error);
        leaderboardList.innerHTML = '<div class="text-center text-neutral-500 py-4 text-xs">Offline - Cache Only</div>';
    }
}

function displayLeaderboard(leaderboard) {
    if (leaderboard.length === 0) { 
        leaderboardList.innerHTML = '<div class="text-center text-gray-500 py-4 text-xs">No scores yet.</div>'; 
        return; 
    }

    let html = ''; 
    leaderboard.forEach((entry, index) => { 
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`; 
        const highlightClass = index < 3 ? 'text-yellow-400 border-yellow-500/20' : 'text-gray-300 border-white/5';
        
        html += `
            <div class="flex justify-between items-center px-2 py-1 bg-black/50 border ${highlightClass} rounded text-xs">
                <span class="font-bold w-6">${medal}</span>
                <span class="flex-1 truncate px-2 font-mono">${escapeHtml(entry.player_name || 'ANON')}</span>
                <span class="font-bold text-cyan-400">${entry.score}</span>
            </div>
        `;
    });
    leaderboardList.innerHTML = html; 
}

function escapeHtml(text) {
    const div = document.createElement('div'); 
    div.textContent = text; 
    return div.innerHTML; 
}

// --- Canvas Sizing & HUD ---

function setupCanvas() {
    const container = canvas.parentElement; 
    const maxSide = Math.floor(Math.min(container.clientWidth, container.clientHeight));
    const snappedSize = Math.floor(maxSide / gridSize) * gridSize;

    canvas.width = snappedSize;
    canvas.height = snappedSize;
    tileCount = snappedSize / gridSize; 

    if (snake.length === 1) { 
        const center = Math.floor(tileCount / 2); 
        snake = [{ x: center, y: center }]; 
    }
}

function updateHUD() {
    const name = playerNameInput.value.trim() || 'ANON';
    hudPlayerName.textContent = name.toUpperCase();
    hudGridSize.textContent = `${currentGridKey.toUpperCase()} (${gridSize}px)`;
    hudDifficulty.textContent = `${currentDiffKey.toUpperCase()} (${DIFFICULTY_CONFIG[currentDiffKey].points}pt)`;
    updateSpeedHUD();
    updateHighScoreDisplay();
}

function setGameSize(sizeKey) {
    if (!GRID_SIZES[sizeKey]) return;
    currentGridKey = sizeKey;
    gridSize = GRID_SIZES[sizeKey];

    gridSizeBtns.forEach(btn => {
        btn.className = btn.dataset.size === sizeKey
            ? "grid-size-btn py-1.5 border border-cyan-500 rounded text-black bg-cyan-400 font-bold text-[11px] font-mono transition-colors"
            : "grid-size-btn py-1.5 border border-cyan-500/40 rounded text-cyan-300 text-[11px] font-mono transition-colors";
    });

    updateHUD();
    setupCanvas();
    resetGame();
}

function setDifficulty(diffKey) {
    if (!DIFFICULTY_CONFIG[diffKey]) return;
    currentDiffKey = diffKey;

    diffBtns.forEach(btn => {
        btn.className = btn.dataset.diff === diffKey
            ? "diff-btn py-1.5 border border-pink-500 rounded text-black bg-pink-500 font-bold text-[11px] font-mono transition-colors"
            : "diff-btn py-1.5 border border-pink-500/40 rounded text-pink-300 text-[11px] font-mono transition-colors";
    });

    updateHUD();
}

async function initializeGame() {
    updateHighScoreDisplay();
    updateHUD();
    setupCanvas(); 
    resetGame(); 
    draw(); 

    overlayTitle.textContent = 'NEON SNAKE';
    overlayActionBtn.textContent = 'ENGAGE RUN';
    setupForm.classList.remove('hidden');
    messageOverlay.classList.remove('hidden'); 

    await fetchGlobalHighScore(); 
    await fetchLeaderboard(); 
}

function resetGame() {
    clearTimeout(gameLoopTimeout);
    const center = Math.floor(tileCount / 2); 
    snake = [{ x: center, y: center }]; 
    dx = 0; 
    dy = 0; 
    score = 0; 
    scoreEl.textContent = 0; 
    gameOver = false; 
    gamePaused = true; 
    changingDirection = false; 
    specialFood = null;
    redSlowMod = 0;
    goldBuffExpiresAt = 0;

    updateSpeedHUD();
    generateFood(); 
    draw(); 
}

window.addEventListener('resize', () => { 
    const wasPaused = gamePaused; 
    pauseGame(); 
    setupCanvas(); 
    draw(); 
    if (!wasPaused && !gameOver) {
        overlayTitle.textContent = 'PAUSED';
        overlayActionBtn.textContent = 'RESUME';
        setupForm.classList.add('hidden');
        messageOverlay.classList.remove('hidden'); 
    }
});

// --- Food & Powerup Spawning ---

function generateFood() {
    let newFoodPosition; 
    do {
        newFoodPosition = {
            x: Math.floor(Math.random() * tileCount), 
            y: Math.floor(Math.random() * tileCount) 
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

    // 1. Gold Cherry (15%): +0.5x speed & +1 pt bonus for 30s
    if (roll < 0.15 && Date.now() > goldBuffExpiresAt) {
        spawnSpecial('gold');
        return;
    }

    // 2. Green Cherry (18%): +25 pts with 10s countdown ring
    if (roll < 0.33) {
        spawnSpecial('green', 10000);
        return;
    }

    // 3. Red Cherry (15%): -0.2x speed ONLY at 200+ points
    if (roll < 0.48 && score >= 200) {
        spawnSpecial('red');
        return;
    }
}

function spawnSpecial(type, durationMs = null) {
    let pos;
    do {
        pos = {
            x: Math.floor(Math.random() * tileCount),
            y: Math.floor(Math.random() * tileCount)
        };
    } while (isOccupied(pos.x, pos.y) || (food.x === pos.x && food.y === pos.y));

    specialFood = {
        ...pos,
        type,
        totalDuration: durationMs,
        expiresAt: durationMs ? Date.now() + durationMs : null
    };
}

function isOccupied(x, y) {
    return snake.some(segment => segment.x === x && segment.y === y); 
}

// --- Drawing Functions ---

function draw() {
    if (!ctx) return; 
    ctx.fillStyle = '#06070a';
    ctx.fillRect(0, 0, canvas.width, canvas.height); 

    drawGridDots(); 
    drawSnake(); 
    drawFood(); 
    drawSpecialFood();
}

function drawGridDots() {
    ctx.fillStyle = '#171a22';
    ctx.shadowBlur = 0; 
    const dotRadius = gridSize >= 36 ? 2 : gridSize >= 20 ? 1.25 : 0.85;

    for (let i = 0; i <= tileCount; i++) { 
        for (let j = 0; j <= tileCount; j++) { 
            ctx.beginPath(); 
            ctx.arc(i * gridSize, j * gridSize, dotRadius, 0, 2 * Math.PI); 
            ctx.fill(); 
        }
    }
}

function drawSnake() {
    const now = Date.now();
    const isGoldActive = now < goldBuffExpiresAt;
    const remainingGoldMs = isGoldActive ? goldBuffExpiresAt - now : 0;
    
    // In the last 1 second, flicker snake rapidly between gold and default
    let renderGold = isGoldActive;
    if (isGoldActive && remainingGoldMs <= 1000) {
        renderGold = Math.floor(now / 100) % 2 === 0;
    }

    const baseHue = 180;

    snake.forEach((segment, index) => {
        const isHead = index === 0;

        if (renderGold) {
            // Radiant Intense Gold Glow
            ctx.fillStyle = '#fff066';
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = isHead ? 24 : 16;
        } else {
            // Vivid Cyan/Rainbow Neon Glow
            const hue = (baseHue + index * 5) % 360;
            ctx.fillStyle = `hsl(${hue}, 100%, 55%)`;
            ctx.shadowColor = `hsl(${hue}, 100%, 70%)`;
            ctx.shadowBlur = isHead ? 18 : 12;
        }

        ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize, gridSize);
    });
    ctx.shadowBlur = 0;
}

// General Cherry: Vivid Neon BLUE with Multi-Pass Bloom
function drawFood() {
    const cx = food.x * gridSize + gridSize / 2;
    const cy = food.y * gridSize + gridSize / 2;
    const r = gridSize / 2;

    ctx.save();
    // 1. Intense Outer Bloom Pass
    ctx.fillStyle = '#00e5ff';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fill();

    // 2. Bright Inner Core Pass
    ctx.fillStyle = '#e6ffff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
}

function drawSpecialFood() {
    if (!specialFood) return;

    const now = Date.now();
    const cx = specialFood.x * gridSize + gridSize / 2;
    const cy = specialFood.y * gridSize + gridSize / 2;
    const radius = (gridSize / 2) - 1;

    // Remove expired timed dots
    if (specialFood.expiresAt && now > specialFood.expiresAt) {
        specialFood = null;
        return;
    }

    ctx.save();

    // 1. RED CHERRY (-0.2x speed down) - Intense Crimson Bloom
    if (specialFood.type === 'red') {
        ctx.fillStyle = '#ff1a40';
        ctx.shadowColor = '#ff2b56';
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        // Bright Hotspot Core
        ctx.fillStyle = '#ffe6ea';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
        ctx.fill();
    }
    // 2. GOLD CHERRY (+0.5x speed surge) - Radiant Solar Bloom
    else if (specialFood.type === 'gold') {
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = '#ffea00';
        ctx.shadowBlur = 24;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        // Golden White Core
        ctx.fillStyle = '#fffdf0';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
        ctx.fill();
    }
    // 3. GREEN CHERRY (+25 pts with Ring) - Vivid Laser Green
    else if (specialFood.type === 'green') {
        const remainingMs = Math.max(0, specialFood.expiresAt - now);
        const progress = remainingMs / specialFood.totalDuration;

        // Flicker effect on the last 3 seconds
        let alpha = 1;
        if (remainingMs <= 3000) {
            alpha = Math.floor(now / 120) % 2 === 0 ? 0.25 : 1;
        }

        ctx.globalAlpha = alpha;

        // Outer Glow Ball
        ctx.fillStyle = '#00ff66';
        ctx.shadowColor = '#00ff66';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.85, 0, Math.PI * 2);
        ctx.fill();

        // White-Green Center Core
        ctx.fillStyle = '#e6fff0';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.4, 0, Math.PI * 2);
        ctx.fill();

        // High-Intensity Glowing Radial Ring
        const ringRadius = radius * 1.35;
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
// --- Dynamic Game Loop ---

function gameTick() {
    if (gamePaused || gameOver) return; 

    changingDirection = false; 
    moveSnake(); 

    if (checkGameOver()) { 
        handleGameOver(); 
        return; 
    }

    checkCollisions();
    draw(); 

    gameLoopTimeout = setTimeout(gameTick, getCurrentSpeedInterval());
}

function moveSnake() {
    const head = { x: snake[0].x + dx, y: snake[0].y + dy }; 
    snake.unshift(head); 
    snake.pop(); 
}

function checkCollisions() {
    const head = snake[0];

    // 1. General Cherry Collision (Blue)
    if (head.x === food.x && head.y === food.y) { 
        const basePts = DIFFICULTY_CONFIG[currentDiffKey].points;
        const bonus = Date.now() < goldBuffExpiresAt ? 1 : 0;
        score += (basePts + bonus);
        scoreEl.textContent = score; 

        snake.unshift({ x: head.x + dx, y: head.y + dy }); 
        updateSpeedHUD();
        generateFood(); 
    }

    // 2. Special Cherry Collision
    if (specialFood && head.x === specialFood.x && head.y === specialFood.y) {
        if (specialFood.type === 'red') {
            redSlowMod += 0.2;
        } else if (specialFood.type === 'green') {
            score += 25;
            scoreEl.textContent = score; 
        } else if (specialFood.type === 'gold') {
            goldBuffExpiresAt = Date.now() + 30000;
        }

        specialFood = null;
        updateSpeedHUD();
    }
}

function checkGameOver() {
    if (snake[0].x < 0 || snake[0].x >= tileCount || snake[0].y < 0 || snake[0].y >= tileCount) { 
        return true; 
    }
    for (let i = 4; i < snake.length; i++) { 
        if (snake[i].x === snake[0].x && snake[i].y === snake[0].y) { 
            return true; 
        }
    }
    return false; 
}

async function handleGameOver() {
    gameOver = true; 
    clearTimeout(gameLoopTimeout);
    overlayTitle.textContent = 'GAME OVER';
    overlayActionBtn.textContent = 'CONFIGURE RUN';
    setupForm.classList.remove('hidden');
    messageOverlay.classList.remove('hidden'); 
    
    const playerName = playerNameInput.value.trim() || 'ANON'; 
    await submitScoreToFirebase(playerName, score); 
}

// --- Controls (Keyboard + Mouse Steering) ---

function changeDirection(event) {
    const keyPressed = event.key.toLowerCase();

    if (keyPressed === ' ') {
        event.preventDefault();
        if (gameOver) restartGame();
        else if (gamePaused) startGame(); 
        else pauseGame(); 
        return;
    }

    if (keyPressed === 'enter') {
        event.preventDefault();
        if (gameOver || !hasStartedOnce) startGame(); 
        else restartGame();
        return;
    }

    if (changingDirection) return; 

    const goingUp = dy === -1; 
    const goingDown = dy === 1; 
    const goingRight = dx === 1; 
    const goingLeft = dx === -1; 

    if ((keyPressed === "arrowleft" || keyPressed === "a") && !goingRight) { 
        dx = -1; dy = 0; changingDirection = true; 
    }
    if ((keyPressed === "arrowup" || keyPressed === "w") && !goingDown) { 
        dx = 0; dy = -1; changingDirection = true; 
    }
    if ((keyPressed === "arrowright" || keyPressed === "d") && !goingLeft) { 
        dx = 1; dy = 0; changingDirection = true; 
    }
    if ((keyPressed === "arrowdown" || keyPressed === "s") && !goingUp) { 
        dx = 0; dy = 1; changingDirection = true; 
    }

    if (gamePaused && !gameOver && (dx !== 0 || dy !== 0)) {
        startGame(); 
    }
}

function rotateDirection(clockwise = true) {
    if (dx === 0 && dy === 0) {
        dx = 1; dy = 0;
        return;
    }
    if (changingDirection) return; 

    let newDx = 0;
    let newDy = 0;

    if (clockwise) {
        newDx = -dy;
        newDy = dx;
    } else {
        newDx = dy;
        newDy = -dx;
    }

    dx = newDx;
    dy = newDy;
    changingDirection = true; 
}

function startGame() {
    updateHUD();
    hasStartedOnce = true;
    if (gameOver) {
        resetGame(); 
    }
    if (gamePaused) { 
        if (dx === 0 && dy === 0) { 
            dx = 1; 
        }
        gamePaused = false; 
        messageOverlay.classList.add('hidden'); 
        setupForm.classList.add('hidden');
        clearTimeout(gameLoopTimeout);
        gameTick();
    }
}

function pauseGame() {
    if (!gameOver && !gamePaused) { 
        gamePaused = true; 
        overlayTitle.textContent = 'PAUSED';
        overlayActionBtn.textContent = 'RESUME';
        setupForm.classList.add('hidden');
        messageOverlay.classList.remove('hidden'); 
        clearTimeout(gameLoopTimeout);
    }
}

function restartGame() {
    resetGame();
    startGame(); 
}

function handleOverlayAction() {
    if (gameOver) {
        resetGame(); 
        startGame(); 
    } else {
        startGame(); 
    }
}

// Mouse Controls
window.addEventListener('contextmenu', (e) => {
    if (e.target === canvas || canvas.contains(e.target)) {
        e.preventDefault();
    }
});

canvas.addEventListener('mousedown', (e) => {
    if (gamePaused || gameOver) {
        startGame(); 
        return;
    }
    e.preventDefault();
    if (e.button === 0) {
        rotateDirection(false);
    } else if (e.button === 2) {
        rotateDirection(true);
    }
});

// Event Listeners
window.addEventListener("keydown", changeDirection); 
playBtn.addEventListener('click', startGame); 
pauseBtn.addEventListener('click', pauseGame); 
restartBtn.addEventListener('click', restartGame);
overlayActionBtn.addEventListener('click', handleOverlayAction);
refreshLeaderboard.addEventListener('click', fetchLeaderboard); 

gridSizeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        setGameSize(e.currentTarget.dataset.size);
    });
});

diffBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        setDifficulty(e.currentTarget.dataset.diff);
    });
});

playerNameInput.addEventListener('input', updateHUD);

// Initialize
initializeGame(); 