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

// Track who touched the ball last ("player" or "computer")
let lastHitBy = null; 

// --- Obstacles & Explosion Particles ---
const obstacles = [
    { x: canvas.width / 2 - 15, y: 0, width: 30, height: 30, active: true },
    { x: canvas.width / 2 - 15, y: 0, width: 30, height: 30, active: true }
];

let particles = [];

function randomizeObstacles() {
    obstacles[0].y = Math.random() * (canvas.height / 2 - 60) + 20;
    obstacles[0].active = true;

    obstacles[1].y = Math.random() * (canvas.height / 2 - 60) + (canvas.height / 2) + 20;
    obstacles[1].active = true;
}

randomizeObstacles();
setInterval(randomizeObstacles, 5000);

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
        drawRect(canvas.width / 2 - 1, i, 2, 10, "#444"); 
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
    
    // Serve the ball towards the side that just missed/lost the point
    ball.speedX = (ball.speedX > 0) ? -5 : 5; 
    ball.speedY = 4 * (Math.random() > 0.5 ? 1 : -1);
    
    lastHitBy = null; 
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

    // 5. Paddle Collisions & Last Hit Tracking
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

    // 6. Obstacle Collisions (Missed Ball Logic)
    obstacles.forEach(obs => {
        if (obs.active && collision(ball, obs)) {
            obs.active = false; 
            createExplosion(obs.x + obs.width / 2, obs.y + obs.height / 2);
            
            // If the ball hits an obstacle, award the point to the opponent 
            // and treat it as a missed serve (fault)
            if (lastHitBy === "player") {
                computer.score++;
            } else if (lastHitBy === "computer") {
                player.score++;
            }
            
            resetBall(); 
        }
    });

    // 7. Particle Updates
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.02; 
        if (p.alpha <= 0) {
            particles.splice(i, 1); 
        }
    }

    // 8. Regular Goal Scoring
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
    drawRect(0, 0, canvas.width, canvas.height, "#000");

    drawNet();
    drawText(player.score, canvas.width / 4, 60, "#FFF");
    drawText(computer.score, 3 * canvas.width / 4, 60, "#FFF");

    obstacles.forEach(obs => {
        if (obs.active) {
            drawRect(obs.x, obs.y, obs.width, obs.height, "#FF3333");
            drawRect(obs.x + 5, obs.y + 5, obs.width - 10, obs.height - 10, "#A00000");
        }
    });

    particles.forEach(p => {
        ctx.fillStyle = `rgba(255, 100, 0, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
    });

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
