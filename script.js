const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- GAME SYSTEM CONFIG & CONSTANTS ---
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const PADDLE_WIDTH = 12;
const PADDLE_HEIGHT = 80;
const BALL_SIZE = 10;

const state = {
    audioEnabled: true,
    audioContext: null,
    scores: { p1: 0, ai: 0 },
    server: 'p1',       // Current server who can score. 'p1' or 'ai'
    lastHitBy: 'p1',    // Last player to strike the ball during the rally
    p1: { x: 30, y: 210 },
    ai: { x: 758, y: 210, speed: 5, reaction: 3 },
    ball: { x: 400, y: 250, vx: 0, vy: 0 },
    ghost: {
        x: 400,
        y: 250,
        width: 16,
        height: 24,
        directionY: 1, // 1 = down, -1 = up
        colorIndex: 0,
        colors: ['#FF0000', '#FFFFFF', '#0000FF'],
        spawnTimer: 0, // Frame count down until it activates (1 second / 60 frames)
        active: false,
        phaseOffset: 0 // Base phase for Math.sin
    },
    particles: [],
    keys: {},
    // Trap mitigation variables
    flatBounceCount: 0,
    paddleHitsRegistry: [], // Timestamps of recent hits to prevent corner sticking
};

// --- SOUND ENGINE (Web Audio API) ---
function initAudio() {
    if (!state.audioContext) {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playSynthSound(type) {
    if (!state.audioEnabled || !state.audioContext) return;
    if (state.audioContext.state === 'suspended') {
        state.audioContext.resume();
    }

    const actx = state.audioContext;
    const now = actx.currentTime;

    if (type === 'hit') {
        // Paddle Hit: Short square wave, 800Hz, 0.05s duration
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, now);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        
        osc.connect(gain);
        gain.connect(actx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
    } 
    else if (type === 'wall') {
        // Wall Bounce: Low-frequency "thud", Triangle wave, 180Hz, 0.08s duration
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(gain);
        gain.connect(actx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
    } 
    else if (type === 'miss') {
        // Missed / Out of Bounds: White noise "wosh" sweep, fading 1000Hz to 100Hz over 0.4s
        const bufferSize = actx.sampleRate * 0.4;
        const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = actx.createBufferSource();
        noise.buffer = buffer;

        const filter = actx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, now);
        filter.frequency.exponentialRampToValueAtTime(100, now + 0.4);

        const gain = actx.createGain();
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(actx.destination);
        noise.start(now);
        noise.stop(now + 0.4);
    } 
    else if (type === 'explosion') {
        // Pac-Man death sound:
        // Phase 1: 11-step descending triangle-wave sweep from 900Hz to 200Hz over 1.2s
        const p1Osc = actx.createOscillator();
        const p1Gain = actx.createGain();
        p1Osc.type = 'triangle';
        
        const steps = 11;
        const duration1 = 1.2;
        for (let i = 0; i <= steps; i++) {
            const stepTime = now + (duration1 / steps) * i;
            const freq = 900 - (700 * (i / steps));
            p1Osc.frequency.setValueAtTime(freq, stepTime);
        }

        p1Gain.gain.setValueAtTime(0.15, now);
        p1Gain.gain.exponentialRampToValueAtTime(0.01, now + duration1);

        p1Osc.connect(p1Gain);
        p1Gain.connect(actx.destination);
        p1Osc.start(now);
        p1Osc.stop(now + duration1);

        // Phase 2: 4 sawtooth pulses descending from 120Hz to 50Hz, duration 1.2s to 1.7s
        const phase2Start = now + 1.2;
        const pulseDur = 0.1;
        const pulseFreqs = [120, 95, 70, 50];

        pulseFreqs.forEach((freq, index) => {
            const osc = actx.createOscillator();
            const gain = actx.createGain();
            const pulseTime = phase2Start + (index * 0.125);

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, pulseTime);
            
            gain.gain.setValueAtTime(0.12, pulseTime);
            gain.gain.exponentialRampToValueAtTime(0.001, pulseTime + pulseDur);

            osc.connect(gain);
            gain.connect(actx.destination);
            osc.start(pulseTime);
            osc.stop(pulseTime + pulseDur);
        });
    }
}

// --- PARTICLE SYSTEM ---
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.substring(1, 3), 16);
    const g = parseInt(hex.substring(3, 5), 16);
    const b = parseInt(hex.substring(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function spawnExplosionParticles(x, y, colorHex) {
    for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 3.5;
        state.particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            colorHex: colorHex,
            alpha: 1.0,
            decay: 0.015 + Math.random() * 0.02,
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

// --- GAME LOGIC ---
function resetServe(server) {
    state.ball.x = 400;
    state.ball.y = 250;
    
    // Server determined: Ball launches away from server
    const dir = (server === 'p1') ? 1 : -1;
    state.ball.vx = dir * 4.5;
    state.ball.vy = (Math.random() * 2 - 1) * 2;

    state.lastHitBy = server; // Initial server hit credit
    state.flatBounceCount = 0;
    state.paddleHitsRegistry = [];

    // Silence and shield the Ghost Obstacle for exactly 1 second (60 frames at 60fps)
    state.ghost.active = false;
    state.ghost.spawnTimer = 60;
    state.ghost.phaseOffset = (Date.now() / 1000) * Math.PI; // Sync phase offset to prevent jumps
}

function resolveRally(winner) {
    if (winner === state.server) {
        state.scores[winner]++;
    } else {
        // "Side-out": Pass serve to the winner
        state.server = winner;
    }
    resetServe(state.server);
}

function handleGhostCollision() {
    playSynthSound('explosion');
    spawnExplosionParticles(state.ghost.x, state.ghost.y, state.ghost.colors[state.ghost.colorIndex]);
    
    // Rally terminates immediately; point or side-out goes to the defender
    const offender = state.lastHitBy;
    const winner = (offender === 'p1') ? 'ai' : 'p1';
    resolveRally(winner);
}

// --- EVENT LISTENERS ---
window.addEventListener('keydown', (e) => {
    initAudio();
    state.keys[e.key] = true;

    // Difficulty Speed Cycle (S)
    if (e.key === 's' || e.key === 'S') {
        state.ai.speed = (state.ai.speed + 1) % 10;
    }
    // Difficulty Reaction Dead-zone Cycle (R)
    if (e.key === 'r' || e.key === 'R') {
        state.ai.reaction = (state.ai.reaction + 1) % 10;
    }
    // New Match Shortcut (N)
    if (e.key === 'n' || e.key === 'N') {
        state.scores.p1 = 0;
        state.scores.ai = 0;
        state.server = 'p1';
        resetServe('p1');
    }
    // Audio Mute Toggle (A)
    if (e.key === 'a' || e.key === 'A') {
        state.audioEnabled = !state.audioEnabled;
    }
    // Debug Force Flat Trajectory Trap Key (Z) - Still functional but hidden from the HUD
    if (e.key === 'z' || e.key === 'Z') {
        state.ball.x = 400;
        state.ball.y = CANVAS_HEIGHT - BALL_SIZE - 2;
        state.ball.vx = 6;
        state.ball.vy = 0;
    }
});

window.addEventListener('keyup', (e) => {
    state.keys[e.key] = false;
});

// --- ENGINE LOOP AND PHYSICS ---
function update() {
    // 1. Move Left Paddle (P1)
    if (state.keys['ArrowUp'] || state.keys['Up']) {
        state.p1.y = Math.max(0, state.p1.y - 5.5);
    }
    if (state.keys['ArrowDown'] || state.keys['Down']) {
        state.p1.y = Math.min(CANVAS_HEIGHT - PADDLE_HEIGHT, state.p1.y + 5.5);
    }

    // 2. Compute AI Paddle Logic
    // Reaction Level scales dead-zone buffer dynamically
    const deadZone = (10 - state.ai.reaction) * 11;
    const speedCoeff = state.ai.speed * 1.05;
    
    const paddleCenter = state.ai.y + PADDLE_HEIGHT / 2;
    const targetY = state.ball.y;

    if (Math.abs(paddleCenter - targetY) > deadZone) {
        if (paddleCenter < targetY) {
            state.ai.y = Math.min(CANVAS_HEIGHT - PADDLE_HEIGHT, state.ai.y + speedCoeff);
        } else {
            state.ai.y = Math.max(0, state.ai.y - speedCoeff);
        }
    }

    // 3. Update the Centerline Ghost Obstacle
    if (state.ghost.spawnTimer > 0) {
        state.ghost.spawnTimer--;
        state.ghost.active = false;
    } else {
        state.ghost.active = true;
    }

    if (state.ghost.active) {
        // Complete sweep from top to bottom limits in exactly 2 seconds (120 frames)
        const totalDurationMs = 2000;
        const timeFactor = (Date.now() / totalDurationMs) * Math.PI;
        
        const minY = 30;
        const maxY = CANVAS_HEIGHT - 30;
        const range = maxY - minY;
        
        // Sine sweep
        const nextY = minY + (range * (Math.sin(timeFactor) + 1) / 2);

        // Track directions and check limits to swap colors
        const movingDown = Math.cos(timeFactor) > 0;
        const wasMovingDown = state.ghost.directionY === 1;
        if (movingDown !== wasMovingDown) {
            state.ghost.directionY = movingDown ? 1 : -1;
            // Advance through cycle sequence: Red -> White -> Blue
            state.ghost.colorIndex = (state.ghost.colorIndex + 1) % state.ghost.colors.length;
        }
        state.ghost.y = nextY;
    }

    // 4. Move Ball
    state.ball.x += state.ball.vx;
    state.ball.y += state.ball.vy;

    // 5. Ceiling and Floor Bounds
    if (state.ball.y <= 0) {
        state.ball.y = 0;
        state.ball.vy = -state.ball.vy;
        playSynthSound('wall');
    }
    if (state.ball.y >= CANVAS_HEIGHT - BALL_SIZE) {
        state.ball.y = CANVAS_HEIGHT - BALL_SIZE;
        state.ball.vy = -state.ball.vy;
        playSynthSound('wall');
    }

    // 6. Paddle Collisions & Dynamic Trap Protections
    const checkPaddleCollision = (paddle, isP1) => {
        const ballLeft = state.ball.x;
        const ballRight = state.ball.x + BALL_SIZE;
        const ballTop = state.ball.y;
        const ballBottom = state.ball.y + BALL_SIZE;

        const padLeft = paddle.x;
        const padRight = paddle.x + PADDLE_WIDTH;
        const padTop = paddle.y;
        const padBottom = paddle.y + PADDLE_HEIGHT;

        // Basic AABB overlap check
        if (ballRight >= padLeft && ballLeft <= padRight &&
            ballBottom >= padTop && ballTop <= padBottom) {
            
            // --- TRAP DETECTION: CORNER CLIPPING / INTERPENETRATION GUARD ---
            const now = Date.now();
            state.paddleHitsRegistry = state.paddleHitsRegistry.filter(t => now - t < 400);
            state.paddleHitsRegistry.push(now);

            // Register triggers if paddle gets 3 hits in 400ms or attempts to sneak behind paddle bounds
            const isBehindFace = isP1 ? (ballLeft < padLeft + PADDLE_WIDTH / 2) : (ballRight > padRight - PADDLE_WIDTH / 2);
            if (state.paddleHitsRegistry.length >= 3 || isBehindFace) {
                // Instantly push out ball, play miss audio, and resolve rally for opponent
                playSynthSound('miss');
                resolveRally(isP1 ? 'ai' : 'p1');
                return;
            }

            // Normal robust bounce angle mapping based on vertical impact point
            playSynthSound('hit');
            state.lastHitBy = isP1 ? 'p1' : 'ai';

            const relY = (paddle.y + PADDLE_HEIGHT / 2) - (state.ball.y + BALL_SIZE / 2);
            const normalizedY = relY / (PADDLE_HEIGHT / 2);
            const bounceAngle = normalizedY * (Math.PI / 4.5); // Max ~40 degrees

            const currentSpeed = Math.sqrt(state.ball.vx * state.ball.vx + state.ball.vy * state.ball.vy);
            const newSpeed = Math.min(currentSpeed * 1.05, 12.0); // Safe acceleration cap

            const dirX = isP1 ? 1 : -1;
            state.ball.vx = dirX * newSpeed * Math.cos(bounceAngle);
            state.ball.vy = -newSpeed * Math.sin(bounceAngle);

            // Push physical coordinates clean out of contact zones to block double hits
            if (isP1) {
                state.ball.x = padRight + 1;
            } else {
                state.ball.x = padLeft - BALL_SIZE - 1;
            }

            // --- TRAP DETECTION: FLAT-LINE DETECTOR ---
            if (Math.abs(state.ball.vy) < 0.2) {
                state.flatBounceCount++;
                if (state.flatBounceCount >= 2) {
                    // Break repetitive vertical dead locks by injecting random offset angles
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

        const gLeft = state.ghost.x - state.ghost.width / 2;
        const gRight = state.ghost.x + state.ghost.width / 2;
        const gTop = state.ghost.y - state.ghost.height / 2;
        const gBottom = state.ghost.y + state.ghost.height / 2;

        if (ballRight >= gLeft && ballLeft <= gRight &&
            ballBottom >= gTop && ballTop <= gBottom) {
            handleGhostCollision();
        }
    }

    // 8. Out of Bounds (Points & Side-outs checking)
    if (state.ball.x < 0) {
        playSynthSound('miss');
        resolveRally('ai');
    } else if (state.ball.x > CANVAS_WIDTH) {
        playSynthSound('miss');
        resolveRally('p1');
    }

    // 9. Particle Updates
    updateParticles();
}

// --- CANVAS GRAPHICS RENDER ---
function drawPixelGhost(ctx, cx, cy, width, height, color) {
    ctx.fillStyle = color;
    const x = cx - width / 2;
    const y = cy - height / 2;

    // Draw retro pixel outline
    ctx.fillRect(x + 2, y, width - 4, height - 4);
    ctx.fillRect(x, y + 4, width, height - 8);
    
    // Tiny ghost skirt frills
    ctx.fillRect(x, y + height - 4, 3, 4);
    ctx.fillRect(x + 6, y + height - 4, 4, 4);
    ctx.fillRect(x + 13, y + height - 4, 3, 4);

    // black retro eyes
    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 3, y + 5, 3, 4);
    ctx.fillRect(x + 10, y + 5, 3, 4);
}

function draw() {
    // Clear display buffer
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Dash divider lines down vertical midpoint
    ctx.strokeStyle = '#252525';
    ctx.lineWidth = 4;
    ctx.setLineDash([15, 15]);
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2, 0);
    ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]); // Reset default rendering line dashes

    // Setup typography styling
    ctx.font = "40px 'Courier New', Courier, monospace";
    ctx.textAlign = 'center';

    // Player 1 (Left) HUD Text details
    const p1ScoreString = state.scores.p1 + (state.server === 'p1' ? '*' : '');
    ctx.fillStyle = state.server === 'p1' ? '#FFD700' : '#777777';
    ctx.fillText(p1ScoreString, 200, 70);

    // AI Computer (Right) HUD Text details
    const aiScoreString = (state.server === 'ai' ? '*' : '') + state.scores.ai;
    ctx.fillStyle = state.server === 'ai' ? '#FFD700' : '#777777';
    ctx.fillText(aiScoreString, 600, 70);

    // Draw Left Paddle (Glow yellow if server)
    if (state.server === 'p1') {
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#FFD700';
        ctx.fillStyle = '#FFD700';
    } else {
        ctx.fillStyle = '#FFFFFF';
    }
    ctx.fillRect(state.p1.x, state.p1.y, PADDLE_WIDTH, PADDLE_HEIGHT);
    ctx.shadowBlur = 0; // Clear shadow buffer context

    // Draw Right Paddle (Glow yellow if server)
    if (state.server === 'ai') {
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#FFD700';
        ctx.fillStyle = '#FFD700';
    } else {
        ctx.fillStyle = '#FFFFFF';
    }
    ctx.fillRect(state.ai.x, state.ai.y, PADDLE_WIDTH, PADDLE_HEIGHT);
    ctx.shadowBlur = 0;

    // Draw Ball
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(state.ball.x, state.ball.y, BALL_SIZE, BALL_SIZE);

    // Draw Obstacle Ghost
    if (state.ghost.active) {
        drawPixelGhost(ctx, state.ghost.x, state.ghost.y, state.ghost.width, state.ghost.height, state.ghost.colors[state.ghost.colorIndex]);
    }

    // Draw Ghost Particles using Dynamic Convert HEX-to-RGBA Opacity Faders
    state.particles.forEach((p) => {
        ctx.fillStyle = hexToRgba(p.colorHex, p.alpha);
        ctx.fillRect(p.x, p.y, p.size, p.size);
    });

    // --- INTEGRATED IN-CANVAS HUD INSTRUMENTS ---
    ctx.font = "14px 'Courier New', Courier, monospace";
    ctx.textAlign = 'left';
    ctx.fillStyle = '#888888';

    // Right Score Column Dashboard Details
    ctx.fillText(`(S)peed: ${state.ai.speed}`, 500, 105);
    ctx.fillText(`(R)eaction: ${state.ai.reaction}`, 500, 125);

    // Bottom Footer Controls Dashboard Panels (Z control removed)
    ctx.textAlign = 'center';
    ctx.fillStyle = '#666666';
    const audioStatus = state.audioEnabled ? "ON" : "OFF";
    ctx.fillText(`▲/▼ : Move    (A)udio: ${audioStatus}    (N)ew game`, CANVAS_WIDTH / 2, CANVAS_HEIGHT - 15);
}

// Initial serve setup
resetServe('p1');

// Run Continuous Frames
function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
