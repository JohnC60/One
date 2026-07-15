const canvas = document.getElementById('pongCanvas');
const ctx = canvas.getContext('2d');

// --- Game Objects ---

const ball = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    radius: 8,
    speedX: 5,
    speedY: 5,
    color: "#FFF"
};

const player = {
    x: 10,
    y: canvas.height / 2 - 50,
    width: 10,
    height: 100,
    score: 0,
    color: "#FFF",
    speed: 7
};

// --- Computer AI Configuration ---
const computer = {
    x: canvas.width - 20,
    y: canvas.height / 2 - 50,
    width: 10,
    height: 100,
    score: 0,
    color: "#FFF",
    speedLevel: 4,     
    reactionLevel: 4   
};

const speedMapping = [0, 2.0, 3.0, 3.8, 4.5, 5.2, 5.8, 6.4, 7.0, 7.5];
const reactionMapping = [200, 50, 40, 30, 20, 15, 10, 5, 2, 0];

// --- Volleyball / Side-Out Scoring State ---
let currentServer = Math.random() > 0.5 ? "player" : "computer"; 
let lastHitBy = null; 

// --- Single Ghost Obstacle Configuration ---
const ghost = {
    x: canvas.width / 2 - 15,
    y: 0,
    width: 30,
    height: 35,
    active: false, // Starts false, turned on 1 second after serving
    
    // Bounds for full-length travel (with 10px padding from top/bottom walls)
    topLimit: 10,
    bottomLimit: canvas.height - 45,
    timeElapsed: 0
};

let particles = [];
let ghostTimeout = null; // Holds the 1-second delay timer reference

function createExplosion(x, y) {
    for (let i = 0; i < 20; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            radius: Math.random() * 4 + 2,
            alpha: 1
        });
    }
}

function startNewGame() {
    player.score = 0;
    computer.score = 0;
    particles = []; 
    currentServer = Math.random() > 0.5 ? "player" : "computer"; 
    resetBall();
}

// --- Input Tracking ---
const keysPressed = {};
window.addEventListener('keydown', (e) => {
    keysPressed[e.key] = true;
    if (e.key === 's' || e.key === 'S') computer.speedLevel = (computer.speedLevel + 1) % 10;
    if (e.key === 'r' || e.key === 'R') computer.reactionLevel = (computer.reactionLevel + 1) % 10;
    if (e.key === 'n' || e.key === 'N') startNewGame();
});
window.addEventListener('keyup', (e) => keysPressed[e.key] = false);

// --- Drawing Helper Functions ---
function drawRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
}

function drawCircle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2, false);
    ctx.closePath();
    ctx.fill();
}

function drawGhost(x, y, w, h) {
    ctx.fillStyle = "#FF3333";
    
    ctx.beginPath();
    ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0, false);
    ctx.lineTo(x + w, y + h);
    
    ctx.lineTo(x + w - (w * 0.25), y + h - 5);
    ctx.lineTo(x + w - (w * 0.5), y + h);
    ctx.lineTo(x + (w * 0.25), y + h - 5);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#FFF";
    ctx.fillRect(x + 6, y + 8, 4, 6);
    ctx.fillRect(x + 18, y + 8, 4, 6);
    ctx.fillStyle = "#00F";
    ctx.fillRect(x + 6, y + 10, 2, 4);
    ctx.fillRect(x + 18, y + 10, 2, 4);
}

function drawNet() {
    for (let i = 0; i <= canvas.height; i += 15) {
        drawRect(canvas.width / 2 - 1, i, 2, 10, "#444"); 
    }
}

function drawText(text, x, y, color, fontSize = "45px") {
    ctx.fillStyle = color;
    ctx.font = `${fontSize} 'Courier New'`;
    ctx.fillText(text, x, y);
}

function resetBall() {
    ball.x = canvas.width / 2;
    ball.y = canvas.height / 2;
    ball.speedX = (currentServer === "player") ? 5 : -5; 
    ball.speedY = 4 * (Math.random() > 0.5 ? 1 : -1);
    lastHitBy = null; 

    // Clear any existing delayed timer so they don't stack up
    clearTimeout(ghostTimeout);
    ghost.active = false; 

    // NEW: Activate the ghost exactly 1 second (1000 milliseconds) after serve
    ghostTimeout = setTimeout(() => {
        ghost.active = true;
    }, 1000);
}

function collision(b, box) {
    return b.x + b.radius > box.x && 
           b.x - b.radius < box.x + box.width && 
           b.y + b.radius > box.y && 
           b.y - b.radius < box.y + box.height;
}

function resolveRally(rallyWinner) {
    if (currentServer === rallyWinner) {
        if (rallyWinner === "player") player.score++;
        else computer.score++;
    } else {
        currentServer = rallyWinner;
    }
    resetBall();
}

// --- Game Logic Update ---
function update() {
    // 1. Player Paddle Movement
    if (keysPressed['ArrowUp'] && player.y > 0) player.y -= player.speed;
    if (keysPressed['ArrowDown'] && player.y < canvas.height - player.height) player.y += player.speed;

    // 2. Computer AI Movement
    let currentSpeed = speedMapping[computer.speedLevel];
    let currentDeadZone = reactionMapping[computer.reactionLevel];
    let computerCenter = computer.y + (computer.height / 2);
    
    if (computerCenter < ball.y - currentDeadZone) computer.y += currentSpeed;
    else if (computerCenter > ball.y + currentDeadZone) computer.y -= currentSpeed;

    if (computer.y < 0) computer.y = 0;
    if (computer.y > canvas.height - computer.height) computer.y = canvas.height - computer.height;

    // 3. Ball Movement
    ball.x += ball.speedX;
    ball.y += ball.speedY;

    // 4. Ball Collision with Top/Bottom Walls
    if (ball.y - ball.radius < 0 || ball.y + ball.radius > canvas.height) {
        ball.speedY = -ball.speedY;
    }

    // 5. Ghost Movement Logic (Continuous full-length pacing, 2s edge-to-edge)
    ghost.timeElapsed += (1 / 60); 
    let oscillation = (Math.sin((Math.PI * 2 * ghost.timeElapsed) / 4) + 1) / 2; 
    ghost.y = ghost.topLimit + oscillation * (ghost.bottomLimit - ghost.topLimit);

    // 6. Paddle Collisions
    if (collision(ball, player)) {
        ball.speedX = -ball.speedX;
        let collidePoint = (ball.y - (player.y + player.height / 2)) / (player.height / 2);
        ball.speedY = collidePoint * 7;
        lastHitBy = "player"; 
    }
    else if (collision(ball, computer)) {
        ball.speedX = -ball.speedX;
        let collidePoint = (ball.y - (computer.y + computer.height / 2)) / (computer.height / 2);
        ball.speedY = collidePoint * 7;
        lastHitBy = "computer"; 
    }

    // 7. Ghost Obstacle Collision (Only checked when active)
    if (ghost.active && collision(ball, ghost)) {
        ghost.active = false; 
        createExplosion(ghost.x + ghost.width / 2, ghost.y + ghost.height / 2);
        
        if (lastHitBy === "player") resolveRally("computer");
        else if (lastHitBy === "computer") resolveRally("player");
        else resolveRally(currentServer === "player" ? "computer" : "player");
    }

    // 8. Particle Updates
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.02; 
        if (p.alpha <= 0) particles.splice(i, 1); 
    }

    // 9. Regular Goal Scoring
    if (ball.x - ball.radius < 0) resolveRally("computer");
    else if (ball.x + ball.radius > canvas.width) resolveRally("player");
}

// --- Render Everything ---
function render() {
    drawRect(0, 0, canvas.width, canvas.height, "#000");
    drawNet();
    
    // Scores & UI
    let playerText = player.score + (currentServer === "player" ? "*" : "");
    let computerText = computer.score + (currentServer === "computer" ? "*" : "");
    drawText(playerText, canvas.width / 4, 60, "#FFF");
    drawText(computerText, 3 * canvas.width / 4, 60, "#FFF");
    drawText(`(S)peed: ${computer.speedLevel}`, 3 * canvas.width / 4 - 60, 100, "#888", "16px");
    drawText(`(R)eaction: ${computer.reactionLevel}`, 3 * canvas.width / 4 - 60, 125, "#888", "16px");
    drawText("(N)ew game", 25, canvas.height - 25, "#555", "16px");

    // Draw Ghost (Only renders if active)
    if (ghost.active) {
        drawGhost(ghost.x, ghost.y, ghost.width, ghost.height);
    }

    // Particles
    particles.forEach(p => {
        ctx.fillStyle = `rgba(255, 100, 0, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
    });

    // Paddles & Ball
    let playerPaddleColor = (currentServer === "player") ? "#FFD700" : player.color;
    let computerPaddleColor = (currentServer === "computer") ? "#FFD700" : computer.color;

    drawRect(player.x, player.y, player.width, player.height, playerPaddleColor);
    drawRect(computer.x, computer.y, computer.width, computer.height, computerPaddleColor);
    drawCircle(ball.x, ball.y, ball.radius, ball.color);
}

// --- Main Game Loop ---
function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
}

resetBall();
gameLoop();
