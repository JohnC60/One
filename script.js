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

const computer = {
    x: canvas.width - 20,
    y: canvas.height / 2 - 50,
    width: 10,
    height: 100,
    score: 0,
    color: "#FFF",
    speed: 4.5
};

// --- Obstacles & Explosion Particles ---
const obstacles = [
    { x: canvas.width / 2 - 15, y: 0, width: 30, height: 30, active: true },
    { x: canvas.width / 2 - 15, y: 0, width: 30, height: 30, active: true }
];

let particles = [];

// Function to randomize obstacle Y positions along the centerline
function randomizeObstacles() {
    // Obstacle 1: Upper half of the centerline
    obstacles[0].y = Math.random() * (canvas.height / 2 - 60) + 20;
    obstacles[0].active = true;

    // Obstacle 2: Lower half of the centerline
    obstacles[1].y = Math.random() * (canvas.height / 2 - 60) + (canvas.height / 2) + 20;
    obstacles[1].active = true;
}

// Randomize them immediately on start, then setup a timer for every 5 seconds (5000ms)
randomizeObstacles();
setInterval(randomizeObstacles, 5000);

// Function to trigger the explosion particle effect
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

// --- Input Tracking ---
const keysPressed = {};
window.addEventListener('keydown', (e) => keysPressed[e.key] = true);
window.addEventListener('keyup', (e) => keysPressed[e.key] = false);

// --- Helper Drawing Functions ---
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

function drawNet() {
    for (let i = 0; i <= canvas.height; i += 15) {
        drawRect(canvas.width / 2 - 1, i, 2, 10, "#444"); // Darker net so obstacles stand out
    }
}

function drawText(text, x, y, color) {
    ctx.fillStyle = color;
    ctx.font = "45px 'Courier New'";
    ctx.fillText(text, x, y);
}

function resetBall() {
    ball.x = canvas.width / 2;
    ball.y = canvas.height / 2;
    ball.speedX = -ball.speedX; 
    ball.speedY = 4 * (Math.random() > 0.5 ? 1 : -1);
}

// --- Collision Detection ---
function collision(b, box) {
    return b.x + b.radius > box.x && 
           b.x - b.radius < box.x + box.width && 
           b.y + b.radius > box.y && 
           b.y - b.radius < box.y + box.height;
}

// --- Game Logic Update ---
function update() {
    // 1. Player Paddle Movement
    if (keysPressed['ArrowUp'] && player.y > 0) player.y -= player.speed;
    if (keysPressed['ArrowDown'] && player.y < canvas.height - player.height) player.y += player.speed;

    // 2. Computer AI Movement
    let computerCenter = computer.y + (computer.height / 2);
    if (computerCenter < ball.y - 15) computer.y += computer.speed;
    else if (computerCenter > ball.y + 15) computer.y -= computer.speed;

    if (computer.y < 0) computer.y = 0;
    if (computer.y > canvas.height - computer.height) computer.y = canvas.height - computer.height;

    // 3. Ball Movement
    ball.x += ball.speedX;
    ball.y += ball.speedY;

    // 4. Ball Collision with Top/Bottom Walls
    if (ball.y - ball.radius < 0 || ball.y + ball.radius > canvas.height) {
        ball.speedY = -ball.speedY;
    }

    // 5. Obstacle Collisions ("Eating" the ball and exploding)
    obstacles.forEach(obs => {
        if (obs.active && collision(ball, obs)) {
            obs.active = false; // Deactivate the obstacle until the next 5s reset
            createExplosion(obs.x + obs.width / 2, obs.y + obs.height / 2);
            resetBall(); // The obstacle "eats" the ball and respawns it
        }
    });

    // 6. Particle Updates (Explosion physics)
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.02; // Fade out slowly
        if (p.alpha <= 0) {
            particles.splice(i, 1); // Remove dead particles
        }
    }

    // 7. Paddle Collisions
    let playerPaddle = (ball.x < canvas.width / 2) ? player : computer;
    if (collision(ball, playerPaddle)) {
        ball.speedX = -ball.speedX;
        let collidePoint = (ball.y - (playerPaddle.y + playerPaddle.height / 2));
        collidePoint = collidePoint / (playerPaddle.height / 2);
        ball.speedY = collidePoint * 7;
    }

    // 8. Scoring
    if (ball.x - ball.radius < 0) {
        computer.score++;
        resetBall();
    } else if (ball.x + ball.radius > canvas.width) {
        player.score++;
        resetBall();
    }
}

// --- Render Everything ---
function render() {
    // Clear screen
    drawRect(0, 0, canvas.width, canvas.height, "#000");

    // Draw background elements
    drawNet();
    drawText(player.score, canvas.width / 4, 60, "#FFF");
    drawText(computer.score, 3 * canvas.width / 4, 60, "#FFF");

    // Draw active obstacles (Bright Red Retro Squares)
    obstacles.forEach(obs => {
        if (obs.active) {
            drawRect(obs.x, obs.y, obs.width, obs.height, "#FF3333");
            // Give it a tiny inner detail to look like a dangerous block
            drawRect(obs.x + 5, obs.y + 5, obs.width - 10, obs.height - 10, "#A00000");
        }
    });

    // Draw explosion particles
    particles.forEach(p => {
        ctx.fillStyle = `rgba(255, 100, 0, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw Paddles and Ball
    drawRect(player.x, player.y, player.width, player.height, player.color);
    drawRect(computer.x, computer.y, computer.width, computer.height, computer.color);
    drawCircle(ball.x, ball.y, ball.radius, ball.color);
}

// --- Main Game Loop ---
function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
}

gameLoop();
