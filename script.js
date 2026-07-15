const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Elements for the HUD
const speedIndicator = document.getElementById('btn-speed');
const reactIndicator = document.getElementById('btn-react');
const audioIndicator = document.getElementById('btn-audio');

// --- GAME CONFIG & STATE ---
const PADDLE_WIDTH = 12;
const PADDLE_HEIGHT = 80;
const BALL_SIZE = 10;

const state = {
    audioEnabled: true,
    audioInitialized: false,
    scores: { p1: 0, ai: 0 },
    server: 'p1', // "p1" or "ai" (determines who gets points on won rallies)
    lastHitBy: 'p1', // Tracks who had the last valid hit
    p1: { x: 30, y: 210, score: 0 },
    ai: { x: 758, y: 210, score: 0, speedLevel: 5, reactionLevel: 3 },
    ball: { x: 400, y: 250, vx: 0, vy: 0, lastVx: 0 },
    ghost: {
        x: 400,
        y: 250,
        directionY: 1, // 1 = down, -1 = up
        colorIndex: 0, // 0 = Red, 1 = White, 2 = Blue
        colors: ['#FF0000', '#FFFFFF', '#0000FF'],
        width: 16,
        height: 24,
        spawnTimer: 0, // Active countdown if > 0
        active: false
    },
    particles: [],
    keys: {},
    // Trap mitigation tracking variables
    flatBounceCount: 0,
    consecutivePaddleHits: 0,
    lastPaddleHitTime: 0
};

// --- AUDIO SYNTHESIS SYSTEM (Web Audio API) ---
let audioCtx = null;

function initAudio() {
    if (state.audioInitialized) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
        audioCtx = new AudioContextClass();
        state.audioInitialized = true;
    }
}

function playSound(type) {
    if (!state.audioEnabled) return;
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const t = audioCtx.currentTime;

    if (type === 'hit') {
        // "pok" - Square wave, 800Hz, 0.05 seconds
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, t);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.05);
    } 
    else if (type === 'wall') {
        // "thud" - Triangle wave, 180Hz, 0.08 seconds
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, t);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.08);
    } 
    else if (type === 'miss') {
        // White noise "wosh" sweeping down (1000Hz -> 100Hz) over 0.4s
        const bufferSize = audioCtx.sampleRate * 0.4;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noiseNode = audioCtx.createBufferSource();
        noiseNode.buffer = buffer;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, t);
        filter.frequency.exponentialRampToValueAtTime(100, t + 0.4);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

        noiseNode.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);

        noiseNode.start(t);
        noiseNode.stop(t + 0.4);
    } 
    else if (type === 'explosion') {
        // Pac-Man death sound
        // Phase 1: Descending sweep (900Hz to 200Hz over 1.2 seconds)
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(900, t);
        
        // 11 discrete steps
        const steps = 11;
        const duration1 = 1.2;
        for (let i = 0; i <= steps; i++) {
            const stepTime = t + (duration1 / steps) * i;
            const freq = 900 - (700 * (i / steps));
            osc1.frequency.setValueAtTime(freq, stepTime);
        }

        gain1.gain.setValueAtTime(0.15, t);
        gain1.gain.exponentialRampToValueAtTime(0.01, t + duration1);

        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.start(t);
        osc1.stop(t + duration1);

        // Phase 2: 4 low-pitched sawtooth pulses (120Hz down to 50Hz, from 1.2s to 1.7s)
        const startTime2 = t + 1.2;
        const pulseDur = 0.1;
        const frequencies = [120, 95, 70, 50];

        frequencies.forEach((freq, idx) => {
            const pulseTime = startTime2 + idx * 0.125;
            const osc2 = audioCtx.createOscillator();
            const gain2 = audioCtx.createGain();

            osc2.type = 'sawtooth';
            osc2.frequency.setValueAtTime(freq, pulseTime);
            
            gain2.gain.setValueAtTime(0.12, pulseTime);
            gain2.gain.exponentialRampToValueAtTime(0.001, pulseTime + pulseDur);

            osc2.connect(gain2);
            gain2.connect(audioCtx.destination);
            
            osc2.start(pulseTime);
            osc2.stop(pulseTime + pulseDur);
        });
    }
}

// --- PARTICLE SYSTEM ---
// Converts hex colors dynamically to RGBA to easily fade them
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function spawnGhostExplosion(x, y, color) {
    for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 4;
        state.particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: color,
            alpha: 1.0,
            decay: 0.02 + Math.random() * 0.02,
            size: 2 + Math.random() * 3
        });
    }
}

function updateParticles() {
    for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;
        if (p.alpha <= 0) {
            state.particles.splice(i, 1);
        }
    }
}

// --- GAME LOGIC FUNCTIONS ---
function resetBall(servingPlayer) {
    state.ball.x = 400;
    state.ball.y = 250;
    
    // Serve direction towards the receiver
    const dir = servingPlayer === 'p1' ? 1 : -1;
    state.ball.vx = dir * 4;
    state.ball.vy = (Math.random() * 2 - 1) * 2;
    state.lastHitBy = servingPlayer;

    // Reset flat line detector
    state.flatBounceCount = 0;

    // Spawn / Protect the Ghost Obstacle
    state.ghost.active = false;
    state.ghost.spawnTimer = 60; // 60 frames (~1 second) buffer of complete safety
}

function resolveRally(winner) {
    if (winner === state.server) {
        // Point is gained only if winner is the server
        state.scores[winner]++;
    } else {
        // Side-out: service is passed to the winner, no points gained
        state.server = winner;
    }

    // Prepare next rally
    resetBall(state.server);
}

function handleGhostCollision() {
    playSound('explosion');
    spawnGhostExplosion(state.ghost.x, state.ghost.y, state.ghost.colors[state.ghost.colorIndex]);
    
    // The player who last struck the ball is charged with a missed serve/rally
    const offender = state.lastHitBy;
    const winner = offender === 'p1' ? 'ai' : 'p1';
    
    resolveRally(winner);
}

// --- INPUT HANDLERS ---
window.addEventListener('keydown', (e) => {
    initAudio(); // Initialize audio context upon first key stroke
    state.keys[e.key] = true;

    // (S)peed adjustments
    if (e.key === 's' || e.key === 'S') {
        state.ai.speedLevel = (state.ai.speedLevel + 1) % 10;
        speedIndicator.innerHTML = `<kbd>S</kbd>eed: ${state.ai.speedLevel}`;
    }

    // (R)eaction adjustments
    if (e.key === 'r' || e.key === 'R') {
        state.ai.reactionLevel = (state.ai.reactionLevel + 1) % 10;
        reactIndicator.innerHTML = `<kbd>R</kbd>eaction: ${state.ai.reactionLevel}`;
    }

    // (A)udio toggle
    if (e.key === 'a' || e.key === 'A') {
        state.audioEnabled = !state.audioEnabled;
        audioIndicator.innerHTML = `<kbd>A</kbd>udio: ${state.audioEnabled ? 'ON' : 'OFF'}`;
    }

    // (N)ew Game shortcut
    if (e.key === 'n' || e.key === 'N') {
        state.scores.p1 = 0;
        state.scores.ai = 0;
        state.server = 'p1';
        resetBall('p1');
    }

    // Debug: Force flat line scenario (Z)
    if (e.key === 'z' || e.key === 'Z') {
        state.ball.x = 400;
        state.ball.y = canvas.height - BALL_SIZE - 5;
        state.ball.vx = 5;
        state.ball.vy = 0;
    }
});

window.addEventListener('keyup', (e) => {
    state.keys[e.key] = false;
});

// --- ENGINE LOOPS ---
function update() {
    // 1. Move Player Paddle
    if (state.keys['ArrowUp'] || state.keys['Up']) {
        state.p1.y = Math.max(0, state.p1.y - 6);
    }
    if (state.keys['ArrowDown'] || state.keys['Down']) {
        state.p1.y = Math.min(canvas.height - PADDLE_HEIGHT, state.p1.y + 6);
    }

    // 2. AI Paddle Logic (Configured using speed and reaction zone levels)
    // Reaction Dead-Zone maps directly to AI precision tracking buffer
    const deadZone = (10 - state.ai.reactionLevel) * 12; 
    const aiSpeed = state.ai.speedLevel * 1.1; 
    
    const paddleCenter = state.ai.y + PADDLE_HEIGHT / 2;
    const targetY = state.ball.y;

    if (Math.abs(paddleCenter - targetY) > deadZone) {
        if (paddleCenter < targetY) {
            state.ai.y = Math.min(canvas.height - PADDLE_HEIGHT, state.ai.y + aiSpeed);
        } else {
            state.ai.y = Math.max(0, state.ai.y - aiSpeed);
        }
    }

    // 3. Update the Ghost Obstacle state
    if (state.ghost.spawnTimer > 0) {
        state.ghost.spawnTimer--;
        state.ghost.active = false;
    } else {
        state.ghost.active = true;
    }

    if (state.ghost.active) {
        // Sinusoidal movement completing a continuous edge-to-edge sweep precisely every 2 seconds (120 frames at 60fps)
        const timeFactor = (Date.now() % 4000) / 4000; // 4s full loop (down & back)
        const angle = timeFactor * Math.PI * 2;
        
        // Calculate next y coordinate safely
        const minY = 30;
        const maxY = canvas.height - 30;
        const range = maxY - minY;
        const nextY = minY + range * (Math.sin(angle) + 1) / 2;

        // Color cycle on direction boundaries (approximate limits)
        const movingDown = Math.cos(angle) > 0;
        const wasMovingDown = state.ghost.directionY === 1;
        if (movingDown !== wasMovingDown) {
            state.ghost.directionY = movingDown ? 1 : -1;
            // Shift color through sequence: Red -> White -> Blue
            state.ghost.colorIndex = (state.ghost.colorIndex + 1) % state.ghost.colors.length;
        }

        state.ghost.y = nextY;
    }

    // 4. Move Ball
    state.ball.x += state.ball.vx;
    state.ball.y += state.ball.vy;

    // 5. Wall Collisions
    if (state.ball.y <= 0) {
        state.ball.y = 0;
        state.ball.vy = -state.ball.vy;
        playSound('wall');
    }
    if (state.ball.y >= canvas.height - BALL_SIZE) {
        state.ball.y = canvas.height - BALL_SIZE;
        state.ball.vy = -state.ball.vy;
        playSound('wall');
    }

    // 6. Paddle Collisions & Trap Protection Mechanics
    const checkPaddleCollision = (paddle, isP1) => {
        const ballLeft = state.ball.x;
        const ballRight = state.ball.x + BALL_SIZE;
        const ballTop = state.ball.y;
        const ballBottom = state.ball.y + BALL_SIZE;

        const paddleLeft = paddle.x;
        const paddleRight = paddle.x + PADDLE_WIDTH;
        const paddleTop = paddle.y;
        const paddleBottom = paddle.y + PADDLE_HEIGHT;

        // General AABB Box overlap check
        if (ballRight >= paddleLeft && ballLeft <= paddleRight &&
            ballBottom >= paddleTop && ballTop <= paddleBottom) {
            
            // --- AGGRESSIVE CORNER-CLIPPING GUARD ---
            const now = Date.now();
            const elapsed = now - state.lastPaddleHitTime;
            
            if (elapsed < 400) {
                state.consecutivePaddleHits++;
            } else {
                state.consecutivePaddleHits = 1;
            }
            state.lastPaddleHitTime = now;

            // If trapped inside/behind or oscillating intensely in collision box
            if (state.consecutivePaddleHits >= 3 || 
                (isP1 && ballLeft < paddleLeft + PADDLE_WIDTH / 2) || 
                (!isP1 && ballRight > paddleRight - PADDLE_WIDTH / 2)) {
                
                // Forcefully eject the ball, resolve the rally instantly
                const winner = isP1 ? 'ai' : 'p1';
                resolveRally(winner);
                playSound('miss');
                return;
            }

            // Normal robust physics collision bounce calculation
            playSound('hit');
            state.lastHitBy = isP1 ? 'p1' : 'ai';

            // Calculate bounce angle based on point of contact
            const relativeIntersectY = (paddle.y + (PADDLE_HEIGHT / 2)) - (state.ball.y + (BALL_SIZE / 2));
            const normalizedIntersectY = relativeIntersectY / (PADDLE_HEIGHT / 2);
            const bounceAngle = normalizedIntersectY * (Math.PI / 4.5); // Max bounce angle ~40 deg

            const speed = Math.sqrt(state.ball.vx * state.ball.vx + state.ball.vy * state.ball.vy);
            const newSpeed = Math.min(speed * 1.05, 12); // Slightly accelerate hit velocity

            const direction = isP1 ? 1 : -1;
            state.ball.vx = direction * newSpeed * Math.cos(bounceAngle);
            state.ball.vy = -newSpeed * Math.sin(bounceAngle);

            // Shift ball directly out of hitbox bounds
            if (isP1) {
                state.ball.x = paddleRight + 1;
            } else {
                state.ball.x = paddleLeft - BALL_SIZE - 1;
            }

            // --- FLAT-LINE TRAP DETECTION ---
            if (Math.abs(state.ball.vy) < 0.25) {
                state.flatBounceCount++;
                if (state.flatBounceCount >= 2) {
                    // Forcefully break flat lockouts with vertical injection
                    state.ball.vy = (Math.random() > 0.5 ? 1.5 : -1.5);
                    state.flatBounceCount = 0;
                }
            } else {
                state.flatBounceCount = 0;
            }
        }
    };

    checkPaddleCollision(state.p1, true);
    checkPaddleCollision(state.ai, false);

    // 7. Ghost Obstacle Collisions
    if (state.ghost.active) {
        const ballRight = state.ball.x + BALL_SIZE;
        const ballLeft = state.ball.x;
        const ballTop = state.ball.y;
        const ballBottom = state.ball.y + BALL_SIZE;

        const ghostRight = state.ghost.x + state.ghost.width / 2;
        const ghostLeft = state.ghost.x - state.ghost.width / 2;
        const ghostTop = state.ghost.y - state.ghost.height / 2;
        const ghostBottom = state.ghost.y + state.ghost.height / 2;

        if (ballRight >= ghostLeft && ballLeft <= ghostRight &&
            ballBottom >= ghostTop && ballTop <= ghostBottom) {
            handleGhostCollision();
        }
    }

    // 8. Out of Bounds (Points & Side-outs checking)
    if (state.ball.x < 0) {
        playSound('miss');
        resolveRally('ai');
    } else if (state.ball.x > canvas.width) {
        playSound('miss');
        resolveRally('p1');
    }

    // 9. Particles
    updateParticles();
}

// --- RENDER SYSTEM ---
function drawPixelGhost(ctx, cx, cy, width, height, color) {
    ctx.fillStyle = color;
    const x = cx - width / 2;
    const y = cy - height / 2;

    // Smooth retro pixel art approximation representing our phantom
    // Draw central body frame
    ctx.fillRect(x + 2, y, width - 4, height - 4);
    ctx.fillRect(x, y + 4, width, height - 10);
    
    // Bottom frills / tentacle pixel notches
    ctx.fillRect(x, y + height - 4, 3, 4);
    ctx.fillRect(x + 6, y + height - 4, 4, 4);
    ctx.fillRect(x + 13, y + height - 4, 3, 4);

    // Eyes
    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 3, y + 6, 3, 4);
    ctx.fillRect(x + 10, y + 6, 3, 4);
}

function draw() {
    // Clear backbuffer
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Center divider dash lines
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 4;
    ctx.setLineDash([15, 15]);
    ctx.beginPath();
    ctx.moveTo(400, 0);
    ctx.lineTo(400, canvas.height);
    ctx.stroke();
    ctx.setLineDash([]); // Reset

    // HUD / Typography Scores & Indicators
    ctx.font = "48px 'Courier New', Courier, monospace";
    ctx.textAlign = 'center';

    // Player 1 (Left) Score Panel
    const p1ScoreText = state.scores.p1 + (state.server === 'p1' ? '*' : '');
    ctx.fillStyle = state.server === 'p1' ? '#FFD700' : '#888888';
    ctx.fillText(p1ScoreText, 200, 70);

    // AI Computer (Right) Score Panel
    const aiScoreText = (state.server === 'ai' ? '*' : '') + state.scores.ai;
    ctx.fillStyle = state.server === 'ai' ? '#FFD700' : '#888888';
    ctx.fillText(aiScoreText, 600, 70);

    // Draw Player 1 Paddle (Glow if server)
    if (state.server === 'p1') {
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#FFD700';
        ctx.fillStyle = '#FFD700';
    } else {
        ctx.fillStyle = '#ffffff';
    }
    ctx.fillRect(state.p1.x, state.p1.y, PADDLE_WIDTH, PADDLE_HEIGHT);
    // Reset glow shadows
    ctx.shadowBlur = 0;

    // Draw AI Paddle (Glow if server)
    if (state.server === 'ai') {
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#FFD700';
        ctx.fillStyle = '#FFD700';
    } else {
        ctx.fillStyle = '#ffffff';
    }
    ctx.fillRect(state.ai.x, state.ai.y, PADDLE_WIDTH, PADDLE_HEIGHT);
    ctx.shadowBlur = 0;

    // Draw the Ball
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(state.ball.x, state.ball.y, BALL_SIZE, BALL_SIZE);

    // Draw Active Ghost Obstacle
    if (state.ghost.active) {
        drawPixelGhost(ctx, state.ghost.x, state.ghost.y, state.ghost.width, state.ghost.height, state.ghost.colors[state.ghost.colorIndex]);
    }

    // Draw Burst Particles
    state.particles.forEach((p) => {
        ctx.fillStyle = hexToRgba(p.color, p.alpha);
        ctx.fillRect(p.x, p.y, p.size, p.size);
    });
}

// Initialize placement and start serve
resetBall('p1');

// Run continuous Loop
function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
