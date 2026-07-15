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

// --- Anti-Trap Tracking ---
let consecutiveFlatBounces = 0;
let recentBounceTimeline = []; 

// --- Single Ghost Obstacle Configuration ---
const ghost = {
    x: canvas.width / 2 - 15,
    y: 0,
    width: 30,
    height: 35,
    active: false, 
    
    topLimit: 10,
    bottomLimit: canvas.height - 45,
    timeElapsed: 0,
    
    colors: ["#FF3333", "#FFFFFF", "#3333FF"], 
    colorIndex: 0,
    wasMovingDown: true 
};

let particles = [];
let ghostTimeout = null; 

// ==========================================
// --- WEB AUDIO API AUDIO SYNTHESIZER ---
// ==========================================

let audioCtx = null;

// Initialize the audio context on the first user interaction (browser security policy)
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (common in some browsers)
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// 1. Core synthesizer player for tones (Paddles, Walls, Explosions)
function playTone(startFreq, endFreq, type, duration) {
    if (!audioCtx) return;
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, audioCtx.currentTime);
    
    // Pitch sweep/bend if an end frequency is provided
    if (endFreq !== startFreq) {
        osc.frequency.exponentialRampToValueAtTime(endFreq, audioCtx.currentTime + duration);
    }
    
    // Smooth volume fade-out (prevents speaker clicking)
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

// 2. Specialized synthesizer for the "Wosh" (Missed Ball / Pass) using white noise
function playWosh() {
    if (!audioCtx) return;

    const bufferSize = audioCtx.sampleRate * 0.4; // 0.4 seconds duration
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    
    // Fill buffer with random noise values
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }

    const noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = buffer;

    // Apply a lowpass filter to make it sound like rushing air (wosh)
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.4);

    // Fade out volume smoothly
    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);

    noiseNode.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    noiseNode.start();
}

// ==========================================

function createExplosion(x, y, color) {
    // Play a heavy, deep retro pitch-bend explosion
    playTone(150, 10, "sawtooth", 0.5);

    for (let i = 0; i < 20; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            radius: Math.random() * 4 + 2,
            alpha: 1,
            color: color 
        });
    }
}

function startNewGame() {
    initAudio();
    player.score = 0;
    computer.score = 0;
    particles = []; 
    currentServer = Math.random() > 0.5 ? "player" : "computer"; 
    resetBall();
}

// --- Input Tracking ---
const keysPressed = {};
window.addEventListener('keydown', (e) => {
    initAudio(); // Initialize sound on key down
    keysPressed[e.key] = true;
    if (e.key === 's' || e.key === 'S') computer.speedLevel = (computer.speedLevel + 1) % 10;
    if (e.key === 'r' || e.key === 'R') computer.reactionLevel = (computer.reactionLevel + 1) % 10;
    if (e.key === 'n' || e.key === 'N') startNewGame();
    
    if (e.key === 'z' || e.key === 'Z') {
        ball.y = canvas.height - ball.radius - 2; 
        ball.speedY = 0;                          
        ball.speedX = (ball.speedX > 0) ? 5 : -5;  
        consecutiveFlatBounces = 0;                
    }
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
    ctx.fillStyle = ghost.colors[ghost.colorIndex];
    
    ctx.beginPath();
    ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0, false);
    ctx.lineTo(x + w, y + h);
    
    ctx.lineTo(x + w - (w * 0.25), y + h - 5);
    ctx.lineTo(x + w - (w * 0.5), y + h);
    ctx.lineTo(x + (w * 0.25), y + h - 5);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = (ghost.colorIndex === 1) ? "#DDD" : "#FFF";
    ctx.fillRect(x + 6, y + 8, 4, 6);
    ctx.fillRect(x + 18, y + 8, 4, 6);
    ctx.fillStyle = "#002";
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
    consecutiveFlatBounces = 0; 
    recentBounceTimeline = []; 

    clearTimeout(ghostTimeout);
    ghost.active = false; 

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

function detectAndFixCornerTrap() {
    const now = performance.now();
    recentBounceTimeline.push(now);
    recentBounceTimeline = recentBounceTimeline.filter(time => now - time < 400);

    if (recentBounceTimeline.length >= 3) {
        if (ball.y > canvas.height / 2) {
            ball.y -= 25; 
            ball.speedY = -Math.abs(ball.speedY) - 2; 
        } else {
            ball.y += 25; 
            ball.speedY = Math.abs(ball.speedY) + 2;  
        }

        if (ball.x > canvas.width / 2) {
            ball.x -= 20;
            ball.speedX = -5; 
        } else {
            ball.x += 20;
            ball.speedX = 5;  
        }
        
        recentBounceTimeline = []; 
        return true; 
    }
    return false;
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
        
        // SOUND: Wall Ricochet Thud (triangle wave, 180Hz, 0.08s)
        playTone(180, 180, "triangle", 0.08);
    }

    // 5. Ghost Movement & Color Cycling
    ghost.timeElapsed += (1 / 60); 
    let oscillation = (Math.sin((Math.PI * 2 * ghost.timeElapsed) / 4) + 1) / 2; 
    
    let nextY = ghost.topLimit + oscillation * (ghost.bottomLimit - ghost.topLimit);
    
    let isMovingDownNow = (nextY > ghost.y);
    if (ghost.wasMovingDown !== isMovingDownNow) {
        ghost.colorIndex = (ghost.colorIndex + 1) % ghost.colors.length;
    }
    
    ghost.y = nextY;
    ghost.wasMovingDown = isMovingDownNow; 

    // 6. Paddle Collisions & Anti-Trap Execution
    if (collision(ball, player)) {
        if (!detectAndFixCornerTrap()) {
            ball.x = player.x + player.width + ball.radius;
            ball.speedX = Math.abs(ball.speedX); 
            
            // SOUND: High-pitch "Pok" (square wave, 800Hz, 0.05s)
            playTone(800, 800, "square", 0.05);

            if (Math.abs(ball.speedY) < 0.2) consecutiveFlatBounces++;
            else consecutiveFlatBounces = 0;

            if (consecutiveFlatBounces >= 2) {
                ball.speedY = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 1.5 + 0.5);
                consecutiveFlatBounces = 0;
            } else {
                let collidePoint = (ball.y - (player.y + player.height / 2)) / (player.height / 2);
                ball.speedY = collidePoint * 7;
            }
        }
        lastHitBy = "player"; 
    }
    else if (collision(ball, computer)) {
        if (!detectAndFixCornerTrap()) {
            ball.x = computer.x - ball.radius;
            ball.speedX = -Math.abs(ball.speedX); 
            
            // SOUND: High-pitch "Pok" (square wave, 800Hz, 0.05s)
            playTone(800, 800, "square", 0.05);

            if (Math.abs(ball.speedY) < 0.2) consecutiveFlatBounces++;
            else consecutiveFlatBounces = 0;

            if (consecutiveFlatBounces >= 2) {
                ball.speedY = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 1.5 + 0.5);
                consecutiveFlatBounces = 0;
            } else {
                let collidePoint = (ball.y - (computer.y + computer.height / 2)) / (computer.height / 2);
                ball.speedY = collidePoint * 7;
            }
        }
        lastHitBy = "computer"; 
    }

    // 7. Ghost Obstacle Collision
    if (ghost.active && collision(ball, ghost)) {
        ghost.active = false; 
        
        // SOUND: Triggered inside createExplosion
        createExplosion(ghost.x + ghost.width / 2, ghost.y + ghost.height / 2, ghost.colors[ghost.colorIndex]);
        
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

    // 9. Regular Goal Scoring (Rally Ends with a "Wosh" sound)
    if (ball.x < 0 || ball.x - ball.radius < player.x) {
        // SOUND: Rushing air missed ball
        playWosh();
        resolveRally("computer");
    } else if (ball.x > canvas.width || ball.x + ball.radius > computer.x + computer.width) {
        // SOUND: Rushing air missed ball
        playWosh();
        resolveRally("player");
    }
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
    drawText("(Z) Trigger trap test", canvas.width - 240, canvas.height - 25, "#333", "16px");

    // Draw Ghost
    if (ghost.active) {
        drawGhost(ghost.x, ghost.y, ghost.width, ghost.height);
    }

    // Particles
    particles.forEach(p => {
        ctx.fillStyle = p.color.replace(")", `, ${p.alpha})`).replace("#FF3333", `rgba(255, 51, 51, ${p.alpha})`).replace("#FFFFFF", `rgba(255, 255, 255, ${p.alpha})`).replace("#3333FF", `rgba(51, 51, 255, ${p.alpha})`);
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
