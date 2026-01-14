// Firebase imports (using CDN version 9+)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ⚠️ REPLACE THIS WITH YOUR FIREBASE CONFIG
const firebaseConfig = {
    apiKey: "AIzaSyA7A7sBin8tIOPxNzBspVLwHxNiDlMstq4",
    authDomain: "neon-snake-game-eadb5.firebaseapp.com",
    projectId: "neon-snake-game-eadb5",
    storageBucket: "neon-snake-game-eadb5.firebasestorage.app",
    messagingSenderId: "987724873748",
    appId: "1:987724873748:web:d228086f81e0ab3c9ce701"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM Elements
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('highScore');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const playerNameInput = document.getElementById('playerNameInput');
const messageOverlay = document.getElementById('messageOverlay');
const leaderboardList = document.getElementById('leaderboardList');
const refreshLeaderboard = document.getElementById('refreshLeaderboard');

// Game settings
const gridSize = 20;
let canvasSize;
let tileCount;

// Game state
let snake = [{ x: 10, y: 10 }];
let food = {};
let dx = 0;
let dy = 0;
let score = 0;
let changingDirection = false;
let gamePaused = true;
let gameOver = false;
let gameLoop;

// High score
let highScore = 0;
let highScorePlayer = 'ANON';
let isLoadingHighScore = true;

// --- Firebase Functions ---

async function fetchGlobalHighScore() {
    try {
        const q = query(collection(db, 'highscores'), orderBy('score', 'desc'), limit(1));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            const topScore = querySnapshot.docs[0].data();
            highScore = topScore.score;
            highScorePlayer = topScore.player_name;
        } else {
            highScore = 0;
            highScorePlayer = 'ANON';
        }
        
        updateHighScoreDisplay();
    } catch (error) {
        console.error('Failed to fetch high score:', error);
        // Fallback to localStorage
        highScore = localStorage.getItem('snakeHighScore') || 0;
        highScorePlayer = localStorage.getItem('snakeHighScorePlayer') || 'ANON';
        updateHighScoreDisplay();
    } finally {
        isLoadingHighScore = false;
    }
}

async function submitScoreToFirebase(playerName, scoreValue) {
    try {
        // Add score to Firestore
        await addDoc(collection(db, 'highscores'), {
            player_name: playerName,
            score: scoreValue,
            timestamp: serverTimestamp()
        });
        
        // Check if it's a new record
        const isNewRecord = scoreValue > highScore;
        
        if (isNewRecord) {
            messageOverlay.innerHTML = '🏆 NEW WORLD RECORD! 🏆<br><span class="text-2xl">GAME OVER</span>';
            highScore = scoreValue;
            highScorePlayer = playerName;
            updateHighScoreDisplay();
        } else {
            messageOverlay.textContent = 'GAME OVER';
        }
        
        // Refresh leaderboard
        await fetchLeaderboard();
        
        return { success: true, isNewRecord };
    } catch (error) {
        console.error('Failed to submit score:', error);
        // Fallback to localStorage
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
        const q = query(collection(db, 'highscores'), orderBy('score', 'desc'), limit(10));
        const querySnapshot = await getDocs(q);
        
        const leaderboard = [];
        querySnapshot.forEach((doc) => {
            leaderboard.push(doc.data());
        });
        
        displayLeaderboard(leaderboard);
    } catch (error) {
        console.error('Failed to fetch leaderboard:', error);
        leaderboardList.innerHTML = '<div class="text-center text-red-500 py-4">Failed to load leaderboard</div>';
    }
}

function displayLeaderboard(leaderboard) {
    if (leaderboard.length === 0) {
        leaderboardList.innerHTML = '<div class="text-center text-gray-500 py-4">No scores yet. Be the first!</div>';
        return;
    }

    let html = '';
    leaderboard.forEach((entry, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const highlightClass = index < 3 ? 'text-yellow-400' : 'text-gray-300';
        
        html += `
            <div class="flex justify-between items-center p-2 bg-black bg-opacity-50 rounded ${highlightClass}">
                <span class="text-lg font-bold w-8">${medal}</span>
                <span class="flex-1 truncate px-2">${escapeHtml(entry.player_name)}</span>
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

// --- Game Initialization ---

function setupCanvas() {
    const container = canvas.parentElement;
    const size = Math.min(container.clientWidth, container.clientHeight);
    canvas.width = size;
    canvas.height = size;
    canvasSize = size;
    tileCount = canvas.width / gridSize;
    
    if(snake.length === 1) {
        const center = Math.floor(tileCount / 2);
        snake = [{ x: center, y: center }];
    }
}

async function initializeGame() {
    await fetchGlobalHighScore();
    await fetchLeaderboard();
    setupCanvas();
    resetGame();
    draw();
}

function resetGame() {
    const center = Math.floor(tileCount / 2);
    snake = [{ x: center, y: center }];
    dx = 0;
    dy = 0;
    score = 0;
    scoreEl.textContent = 0;
    gameOver = false;
    gamePaused = true;
    messageOverlay.classList.add('hidden');
    messageOverlay.textContent = 'GAME OVER';
    generateFood();
}

window.addEventListener('resize', () => {
    const wasPaused = gamePaused;
    pauseGame();
    setupCanvas();
    draw();
    if (!wasPaused) {
        messageOverlay.textContent = 'PAUSED';
        messageOverlay.classList.remove('hidden');
    }
});

// --- Drawing Functions ---

function draw() {
    if (!ctx) return;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGridDots();
    drawSnake();
    drawFood();
}

function drawGridDots() {
    ctx.fillStyle = '#333';
    ctx.shadowBlur = 0;
    const dotRadius = 1.5;

    for (let i = 0; i <= tileCount; i++) {
        for (let j = 0; j <= tileCount; j++) {
            ctx.beginPath();
            ctx.arc(i * gridSize, j * gridSize, dotRadius, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
}

function drawSnake() {
    const baseHue = 180;
    snake.forEach((segment, index) => {
        const hue = (baseHue + index * 5) % 360;
        ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
        ctx.shadowColor = `hsl(${hue}, 100%, 70%)`;
        ctx.shadowBlur = 10;
        ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize, gridSize);
    });
    ctx.shadowBlur = 0;
}

function drawFood() {
    ctx.fillStyle = '#ff1a1a';
    ctx.shadowColor = '#ff1a1a';
    ctx.shadowBlur = 15;
    
    ctx.beginPath();
    ctx.arc(food.x * gridSize + gridSize / 2, food.y * gridSize + gridSize / 2, gridSize / 2, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.shadowBlur = 0;
}

// --- Game Logic ---

function main() {
    if (gamePaused || gameOver) return;

    changingDirection = false;
    moveSnake();

    if (checkGameOver()) {
        handleGameOver();
        return;
    }

    if (checkFoodCollision()) {
        handleFoodEaten();
    }

    draw();
}

function moveSnake() {
    const head = { x: snake[0].x + dx, y: snake[0].y + dy };
    snake.unshift(head);
    snake.pop();
}

function checkFoodCollision() {
    return snake[0].x === food.x && snake[0].y === food.y;
}

function handleFoodEaten() {
    score += 10;
    scoreEl.textContent = score;

    const head = { x: snake[0].x, y: snake[0].y };
    snake.unshift({ x: head.x + dx, y: head.y + dy});
    
    generateFood();
}

function generateFood() {
    let newFoodPosition;
    do {
        newFoodPosition = {
            x: Math.floor(Math.random() * tileCount),
            y: Math.floor(Math.random() * tileCount)
        };
    } while (isFoodOnSnake(newFoodPosition));
    food = newFoodPosition;
}

function isFoodOnSnake(position) {
    return snake.some(segment => segment.x === position.x && segment.y === position.y);
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
    clearInterval(gameLoop);
    messageOverlay.textContent = 'GAME OVER';
    messageOverlay.classList.remove('hidden');
    
    await checkAndSubmitHighScore();
}

// --- Controls ---

function changeDirection(event) {
    if (changingDirection) return;
    changingDirection = true;

    const keyPressed = event.key;
    const goingUp = dy === -1;
    const goingDown = dy === 1;
    const goingRight = dx === 1;
    const goingLeft = dx === -1;

    if ((keyPressed === "ArrowLeft" || keyPressed.toLowerCase() === "a") && !goingRight) { dx = -1; dy = 0; }
    if ((keyPressed === "ArrowUp" || keyPressed.toLowerCase() === "w") && !goingDown) { dx = 0; dy = -1; }
    if ((keyPressed === "ArrowRight" || keyPressed.toLowerCase() === "d") && !goingLeft) { dx = 1; dy = 0; }
    if ((keyPressed === "ArrowDown" || keyPressed.toLowerCase() === "s") && !goingUp) { dx = 0; dy = 1; }
}

function startGame() {
    if (gameOver) {
        resetGame();
        draw();
    }
    if (gamePaused) {
        if (dx === 0 && dy === 0) {
            dx = 1; 
        }
        gamePaused = false;
        messageOverlay.classList.add('hidden');
        gameLoop = setInterval(main, 100);
    }
}

function pauseGame() {
    if (!gameOver) {
        gamePaused = true;
        messageOverlay.textContent = 'PAUSED';
        messageOverlay.classList.remove('hidden');
        clearInterval(gameLoop);
    }
}

// --- High Score Logic ---

async function checkAndSubmitHighScore() {
    if (score > 0) {
        const playerName = playerNameInput.value.trim() || 'ANON';
        await submitScoreToFirebase(playerName, score);
    }
}

function updateHighScoreDisplay() {
    if (isLoadingHighScore) {
        highScoreEl.textContent = 'Loading...';
    } else {
        highScoreEl.textContent = `${highScore} (${highScorePlayer})`;
    }
}

// Event Listeners
document.addEventListener("keydown", changeDirection);
playBtn.addEventListener('click', startGame);
pauseBtn.addEventListener('click', pauseGame);
refreshLeaderboard.addEventListener('click', fetchLeaderboard);

// Initialize
initializeGame();