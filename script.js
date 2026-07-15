const canvas = document.getElementById('pongCanvas');
const ctx = canvas.getContext('2d');

// --- Game Objects ---

// The Ball
const ball = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    radius: 8,
    speedX: 5,
    speedY: 5,
    color: "#FFF"
};

// Player 1 Paddle (Left)
const player = {
    x: 10,
    y: canvas.height / 2 - 50,
    width: 10,
    height: 100,
    score: 0,
    color: "#FFF",
    speed: 7
};

// Computer Paddle (Right)
const computer = {
    x: canvas.width - 20,
    y: canvas.height / 2 - 50,
    width: 10,
    height: 100,
    score: 0,
    color: "#FFF",
    speed: 4.5 // Slightly slower than the ball to make it beatable
};

// --- Input Tracking ---
const keysPressed = {};

window.addEventListener('keydown', (e) => {
    keysPressed[e.key] = true;
});

window.addEventListener('keyup', (e) => {
    keysPressed[e.key] = false;
});

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
    // Draws the dashed line down the center
    for (let i = 0; i <= canvas.height; i += 15) {
        drawRect(canvas.width / 2 - 1, i, 2, 10, "#FFF");
    }
}

function drawText(text, x, y, color) {
    ctx.fillStyle = color;
    ctx.font = "45px 'Courier New'";
    ctx.fillText(text, x, y);
}

// Reset the ball back to the center after someone scores
function resetBall() {
    ball.x = canvas.width / 2;
    ball.y = canvas.height / 2;
    ball.speedX = -ball.speedX; // Send it towards the player who just scored
    ball.speedY = 4 * (Math.random() > 0.5 ? 1 : -1); // Randomize Y direction slightly
}

// --- Collision Detection ---
function collision(b, p) {
    // Simple bounding box collision check
    return b.x + b.radius > p.x && 
           b.x - b.radius < p.x + p.width && 
           b.y + b.radius > p.y && 
           b.y - b.radius < p.y + p.height;
}

// --- Game Logic Update ---
function update() {
    // 1. Player Paddle Movement
    if (keysPressed['ArrowUp'] && player.y > 0) {
        player.y -= player.speed;
    }
    if (keysPressed['ArrowDown'] && player.y < canvas.height - player.height) {
        player.y += player.speed;
    }

    // 2. Computer AI Movement (Tracks the ball's Y position)
    let computerCenter = computer.y + (computer.height / 2);
    if (computerCenter < ball.y - 15) {
        computer.y += computer.speed;
    } else if (computerCenter > ball.y + 15) {
        computer.y -= computer.speed;
    }
    
    // Prevent computer paddle from going out of bounds
    if (computer.y < 0) computer.y = 0;
    if (computer.y > canvas.height - computer.height) computer.y = canvas.height - computer.height;

    // 3. Ball Movement
    ball.x += ball.speedX;
    ball.y += ball.speedY;

    // 4. Ball Collision with Top and Bottom Walls
    if (ball.y - ball.radius < 0 || ball.y + ball.radius > canvas.height) {
        ball.speedY = -ball.speedY;
    }

    // 5. Determine which paddle the ball is moving towards
    let playerPaddle = (ball.x < canvas.width / 2) ? player : computer;

    // 6. Paddle Collisions
    if (collision(ball, playerPaddle)) {
        // Reverse X direction
        ball.speedX = -ball.speedX;
        
        // Dynamic bouncing: Change Y speed based on where the ball hits the paddle
        let collidePoint = (ball.y - (playerPaddle.y + playerPaddle.height / 2));
        collidePoint = collidePoint / (playerPaddle.height / 2); // Normalize to a value between -1 and 1
        
        ball.speedY = collidePoint * 7; // 7 controls max angle severity
    }

    // 7. Scoring and Resetting
    if (ball.x - ball.radius < 0) {
        computer.score++;
        resetBall();
    } else if (ball.x + ball.radius > canvas.width) {
        player.score++;
        resetBall();
    }
}

// --- Render Everything onto the Canvas ---
function render() {
    // Clear the canvas
    drawRect(0, 0, canvas.width, canvas.height, "#000");

    // Draw the net
    drawNet();

    // Draw Scores
    drawText(player.score, canvas.width / 4, 60, "#FFF");
    drawText(computer.score, 3 * canvas.width / 4, 60, "#FFF");

    // Draw Paddles
    drawRect(player.x, player.y, player.width, player.height, player.color);
    drawRect(computer.x, computer.y, computer.width, computer.height, computer.color);

    // Draw Ball
    drawCircle(ball.x, ball.y, ball.radius, ball.color);
}

// --- Main Game Loop ---
function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
}

// Start the game!
gameLoop();
