import {
  FilesetResolver,
  GestureRecognizer,
  PoseLandmarker,
  FaceLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";
const POSE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";

const video = document.querySelector("#camera");
const fxCanvas = document.querySelector("#fxCanvas");
const ctx = fxCanvas.getContext("2d");
const threeCanvas = document.querySelector("#threeCanvas");
const startBtn = document.querySelector("#startBtn");
const flipBtn = document.querySelector("#flipBtn");
const startPanel = document.querySelector("#startPanel");
const secureHint = document.querySelector("#secureHint");
const statusEl = document.querySelector("#status");
const gestureEl = document.querySelector("#gesture");
const gestureZhEl = document.querySelector("#gestureZh");
const confEl = document.querySelector("#confidence");
const confBar = document.querySelector("#confidenceBar");
const handednessEl = document.querySelector("#handedness");
const fpsEl = document.querySelector("#fps");
const pinchValueEl = document.querySelector("#pinchValue");
const bodyStateEl = document.querySelector("#bodyState");
const faceStateEl = document.querySelector("#faceState");
const toastEl = document.querySelector("#toast");
const helpBtn = document.querySelector("#helpBtn");
const helpOverlay = document.querySelector("#helpOverlay");
const helpCloseBtn = document.querySelector("#helpCloseBtn");

let recognizer = null;
let stream = null;
let running = false;
let facingMode = "user";
let mirror = true;
let lastVideoTime = -1;
let lastInferenceAt = 0;
let inferenceFrames = 0;
let fpsWindowStart = performance.now();
let currentResult = null;
let currentGesture = "None";
let currentConfidence = 0;
let pinchLatched = false;
let trail = [];
let prevGesture = "None";
let burstEnergy = 0;
let toastTimer = null;

// ---------- motion speed + wave/throw state ----------
let palmHistory = [];
let speedEMA = 0;
let pinchActivePrev = false;
let projectiles = [];
let impacts = [];
let waveMarks = [];
let lastCenterX = null;
let lastCenterDir = 0;
let universeActive = false;
let universeStartedAt = 0;
let universeCooldownUntil = 0;

const THROW_MIN_SPEED = 0.42;    // px/ms flick speed needed to launch an orb
const WAVE_SPEED_THRESHOLD = 0.85; // px/ms average speed needed to count as a "fast wave"
const UNIVERSE_DURATION = 3000;
const UNIVERSE_COOLDOWN = 3500;
const GRAVITY = 0.0016; // px/ms^2, gentle arc on thrown orbs

// ---------- full-body pose + facial expression state ----------
let poseLandmarker = null;
let faceLandmarker = null;
let inferenceTick = 0;

let posePts = null;
let prevPosePts = null;
let danceEnergy = 0;
let dancing = false;
let danceSince = 0;
let danceUniverseFired = false;
let armsRaised = false;

let facePts = null;
let faceScale = 90; // px proxy for on-screen face size, used to scale the smile halo
let currentExpression = "Neutral";
let prevExpression = "Neutral";
let smileStrength = 0;
let shockwaves = [];

const POSE_TRACK_IDS = [11, 12, 15, 16, 23, 24]; // shoulders, wrists, hips
const DANCE_ENERGY_ON = 5.5;   // avg px moved per pose-tick to count as "dancing" (lower = easier to trigger)
const DANCE_ENERGY_OFF = 2.2;  // falls back below this to stop
const DANCE_UNIVERSE_DELAY = 700; // ms of sustained dancing before it opens the starfield
const ARMS_RAISED_MARGIN = 20; // px above the nose the wrists must clear
const SMILE_ON = 0.32;         // blendshape score rarely gets near 1.0 for a natural smile
const SURPRISE_JAW_ON = 0.35;
const SURPRISE_BROW_ON = 0.28;
const NEBULA_HUES = [190, 265, 320, 45]; // teal, violet, pink, gold

const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17]
];

const GESTURE_ZH = {
  None: "把手放進畫面",
  Closed_Fist: "握拳・粒子收束",
  Open_Palm: "張手・能量爆散",
  Pointing_Up: "指向・鎖定模式",
  Thumb_Down: "倒讚",
  Thumb_Up: "讚・穩定核心",
  Victory: "Victory・雙環模式",
  ILoveYou: "I Love You",
  PINCH: "捏合・能量核心"
};

// Per-gesture 3D look: color, base scale/radius, which rings show, spin multiplier.
const GESTURE_FX = {
  PINCH:       { scale: 1.5,  radius: 45, color: 0xffd06a, ringA: true,  ringB: true,  spin: 1.0 },
  Closed_Fist: { scale: .62,  radius: 20, color: 0x72fff3, ringA: false, ringB: false, spin: 1.6 },
  Open_Palm:   { scale: 1.15, radius: 84, color: 0x72fff3, ringA: true,  ringB: false, spin: 1.3 },
  Victory:     { scale: 1.05, radius: 60, color: 0x9cf2ff, ringA: true,  ringB: true,  spin: 0.9 },
  Pointing_Up: { scale: .82,  radius: 34, color: 0x72fff3, ringA: true,  ringB: false, spin: 2.1 },
  Thumb_Up:    { scale: 1.1,  radius: 50, color: 0xffd06a, ringA: true,  ringB: false, spin: 1.1 },
  Thumb_Down:  { scale: .85,  radius: 42, color: 0x5a7bff, ringA: false, ringB: true,  spin: .7,  sink: true },
  ILoveYou:    { scale: 1.2,  radius: 66, color: 0xff5fa8, ringA: true,  ringB: true,  spin: 1.4 },
  None:        { scale: 1.0,  radius: 58, color: 0x72fff3, ringA: true,  ringB: false, spin: 1.0 }
};

// ---------- THREE.JS hologram layer ----------
const renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, alpha: true, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, innerWidth, 0, innerHeight, -1000, 1000);
camera.position.z = 100;

const energyGroup = new THREE.Group();
scene.add(energyGroup);
energyGroup.visible = false;

// ---------- shared soft-glow dot texture (every particle uses this instead of a flat square) ----------
function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d");
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
const glowTexture = makeGlowTexture();

const core = new THREE.Mesh(
  new THREE.IcosahedronGeometry(18, 1),
  new THREE.MeshBasicMaterial({ color: 0x72fff3, wireframe: true, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthTest: false })
);
energyGroup.add(core);

const innerCore = new THREE.Mesh(
  new THREE.SphereGeometry(6.5, 18, 18),
  new THREE.MeshBasicMaterial({ color: 0xffd06a, transparent: true, opacity: .78, blending: THREE.AdditiveBlending, depthTest: false })
);
energyGroup.add(innerCore);

const ringA = new THREE.Mesh(
  new THREE.TorusGeometry(31, .8, 8, 64),
  new THREE.MeshBasicMaterial({ color: 0x72fff3, transparent: true, opacity: .6, blending: THREE.AdditiveBlending, depthTest: false })
);
const ringB = ringA.clone();
ringA.rotation.x = 1.08;
ringB.rotation.y = 1.17;
ringB.scale.setScalar(.78);
energyGroup.add(ringA, ringB);

const particleCount = 260;
const particlePositions = new Float32Array(particleCount * 3);
const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
const particleMat = new THREE.PointsMaterial({ map: glowTexture, color: 0x72fff3, size: 6, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthTest: false, sizeAttenuation: false });
const particles = new THREE.Points(particleGeo, particleMat);
energyGroup.add(particles);

// ---------- warp-speed starfield (fast wave => "universe" mode) ----------
const STAR_COUNT = 460;
const starAngles = new Float32Array(STAR_COUNT);
const starBaseR = new Float32Array(STAR_COUNT);
const starSpeed = new Float32Array(STAR_COUNT);
for (let i = 0; i < STAR_COUNT; i++) {
  starAngles[i] = Math.random() * Math.PI * 2;
  starBaseR[i] = 10 + Math.random() * 40;
  starSpeed[i] = 0.5 + Math.random() * 1.6;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(STAR_COUNT * 3), 3));
const starColors = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++) {
  const hue = NEBULA_HUES[i % NEBULA_HUES.length] + (Math.random() * 20 - 10);
  const c = new THREE.Color(`hsl(${hue}, 85%, ${65 + Math.random() * 15}%)`);
  starColors[i * 3] = c.r; starColors[i * 3 + 1] = c.g; starColors[i * 3 + 2] = c.b;
}
starGeo.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
const starMat = new THREE.PointsMaterial({ map: glowTexture, size: 6.5, transparent: true, opacity: 0, vertexColors: true, blending: THREE.AdditiveBlending, depthTest: false, sizeAttenuation: false });
const starField = new THREE.Points(starGeo, starMat);
starField.visible = false;
scene.add(starField);

// light-trail tracker: samples a subset of star particles' actual on-screen
// position each frame and draws fading streaks behind them (see drawParticleTrail).
const STAR_TRAIL = { indices: Array.from({ length: 60 }, (_, k) => Math.floor(k * STAR_COUNT / 60)), history: [] };
STAR_TRAIL.history = STAR_TRAIL.indices.map(() => []);

// ---------- full-body cosmic aura (sustained dancing) ----------
const AURA_COUNT = 480;
const auraGeo = new THREE.BufferGeometry();
auraGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(AURA_COUNT * 3), 3));
const auraColors = new Float32Array(AURA_COUNT * 3);
for (let i = 0; i < AURA_COUNT; i++) {
  const hue = NEBULA_HUES[i % NEBULA_HUES.length] + (Math.random() * 24 - 12);
  const c = new THREE.Color(`hsl(${hue}, 85%, 68%)`);
  auraColors[i * 3] = c.r; auraColors[i * 3 + 1] = c.g; auraColors[i * 3 + 2] = c.b;
}
auraGeo.setAttribute("color", new THREE.BufferAttribute(auraColors, 3));
const auraBaseColors = auraColors.slice(); // immutable copy — auraColors itself gets re-tinted per frame for the twinkle
const auraMat = new THREE.PointsMaterial({ map: glowTexture, size: 5.5, transparent: true, opacity: 0, vertexColors: true, blending: THREE.AdditiveBlending, depthTest: false, sizeAttenuation: false });
const auraPoints = new THREE.Points(auraGeo, auraMat);
auraPoints.visible = false;
scene.add(auraPoints);

// same idea as STAR_TRAIL but for the body-aura ring, so the nebula leaves flowing light streaks as it swirls.
const AURA_TRAIL = { indices: Array.from({ length: 48 }, (_, k) => Math.floor(k * AURA_COUNT / 48)), history: [] };
AURA_TRAIL.history = AURA_TRAIL.indices.map(() => []);

// second, larger ring of aura particles orbiting further out for a "bigger than the body" feel
const AURA_OUTER_COUNT = 220;
const auraOuterGeo = new THREE.BufferGeometry();
auraOuterGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(AURA_OUTER_COUNT * 3), 3));
const auraOuterColors = new Float32Array(AURA_OUTER_COUNT * 3);
for (let i = 0; i < AURA_OUTER_COUNT; i++) {
  const hue = NEBULA_HUES[(i + 2) % NEBULA_HUES.length] + (Math.random() * 24 - 12);
  const c = new THREE.Color(`hsl(${hue}, 90%, 72%)`);
  auraOuterColors[i * 3] = c.r; auraOuterColors[i * 3 + 1] = c.g; auraOuterColors[i * 3 + 2] = c.b;
}
auraOuterGeo.setAttribute("color", new THREE.BufferAttribute(auraOuterColors, 3));
const auraOuterBaseColors = auraOuterColors.slice();
const auraOuterMat = new THREE.PointsMaterial({ map: glowTexture, size: 4.2, transparent: true, opacity: 0, vertexColors: true, blending: THREE.AdditiveBlending, depthTest: false, sizeAttenuation: false });
const auraOuterPoints = new THREE.Points(auraOuterGeo, auraOuterMat);
auraOuterPoints.visible = false;
scene.add(auraOuterPoints);

// ---------- arms-raised energy pillar ----------
const PILLAR_COUNT = 160;
const pillarGeo = new THREE.BufferGeometry();
pillarGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PILLAR_COUNT * 3), 3));
const pillarMat = new THREE.PointsMaterial({ map: glowTexture, size: 7.5, transparent: true, opacity: 0, color: 0xffe08a, blending: THREE.AdditiveBlending, depthTest: false, sizeAttenuation: false });
const pillarPoints = new THREE.Points(pillarGeo, pillarMat);
pillarPoints.visible = false;
scene.add(pillarPoints);

// ---------- smile halo ----------
const faceHalo = new THREE.Mesh(
  new THREE.TorusGeometry(46, 4.5, 10, 56),
  new THREE.MeshBasicMaterial({ color: 0xffd06a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false })
);
scene.add(faceHalo);
const faceHalo2 = new THREE.Mesh(
  new THREE.TorusGeometry(64, 2.4, 10, 56),
  new THREE.MeshBasicMaterial({ color: 0xff9ad6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false })
);
scene.add(faceHalo2);

// A thrown energy orb: small wireframe shell + glowing core, same palette as the hand-anchored one.
function makeOrb() {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(9, 1),
    new THREE.MeshBasicMaterial({ color: 0xffd06a, wireframe: true, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthTest: false })
  );
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(4, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0x72fff3, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthTest: false })
  );
  group.add(shell, glow);
  scene.add(group);
  return { group, shell, glow };
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  fxCanvas.width = Math.round(innerWidth * dpr);
  fxCanvas.height = Math.round(innerHeight * dpr);
  fxCanvas.style.width = `${innerWidth}px`;
  fxCanvas.style.height = `${innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  renderer.setSize(innerWidth, innerHeight, false);
  camera.left = 0;
  camera.right = innerWidth;
  camera.top = 0;
  camera.bottom = innerHeight;
  camera.updateProjectionMatrix();

  starField.position.set(innerWidth / 2, innerHeight / 2, 0);
}
window.addEventListener("resize", resize, { passive: true });
resize();

// Correctly maps MediaPipe's normalized video coordinate to an object-fit: cover screen.
function mapPoint(lm) {
  const vw = video.videoWidth || innerWidth;
  const vh = video.videoHeight || innerHeight;
  const scale = Math.max(innerWidth / vw, innerHeight / vh);
  const rw = vw * scale;
  const rh = vh * scale;
  const ox = (innerWidth - rw) / 2;
  const oy = (innerHeight - rh) / 2;
  const nx = mirror ? (1 - lm.x) : lm.x;
  return { x: ox + nx * rw, y: oy + lm.y * rh, z: lm.z || 0 };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Slowly rotating hue used to give beams/particles a "cosmic" cycling color.
function cosmicHue(now, offset = 0) {
  return (now * 0.03 + offset) % 360;
}
function cosmicHex(now, offset = 0, s = 85, l = 62) {
  return new THREE.Color(`hsl(${cosmicHue(now, offset)}, ${s}%, ${l}%)`).getHex();
}

// Samples a subset of a Points object's particles each frame and remembers their
// actual on-screen position (local position transformed by the object's own
// position + z-rotation), so drawParticleTrail can draw fading light streaks
// behind them on the 2D canvas without tracking all hundreds of particles.
function trackParticleTrail(tracker, pointsObj, positions, now, life, active) {
  const rot = pointsObj.rotation.z;
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  for (let k = 0; k < tracker.indices.length; k++) {
    const hist = tracker.history[k];
    if (active) {
      const i = tracker.indices[k];
      const lx = positions[i * 3], ly = positions[i * 3 + 1];
      hist.push({
        x: pointsObj.position.x + (lx * cosR - ly * sinR),
        y: pointsObj.position.y + (lx * sinR + ly * cosR),
        t: now
      });
    }
    while (hist.length && now - hist[0].t > life) hist.shift();
  }
}

function drawParticleTrail(tracker, colors, now, life, widthMul = 1) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.globalCompositeOperation = "lighter";
  for (let k = 0; k < tracker.indices.length; k++) {
    const i = tracker.indices[k];
    const r = Math.round(colors[i * 3] * 255), g = Math.round(colors[i * 3 + 1] * 255), b = Math.round(colors[i * 3 + 2] * 255);
    const hist = tracker.history[k];
    for (let j = 1; j < hist.length; j++) {
      const a = hist[j - 1], bp = hist[j];
      const alpha = Math.max(0, 1 - (now - bp.t) / life);
      if (alpha <= 0) continue;
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * .85})`;
      ctx.lineWidth = (1.2 + alpha * 3.2) * widthMul;
      ctx.shadowColor = `rgba(${r},${g},${b},.9)`;
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bp.x, bp.y); ctx.stroke();
    }
  }
  ctx.restore();
}

// Soft radial-gradient halo on the 2D overlay canvas — same technique as the
// universe-mode screen tint below, just re-usable for any glow (dance aura,
// energy pillar, smile halo). Additive blending means draw order doesn't matter.
function drawGlow(x, y, radius, hue, alpha) {
  if (alpha <= 0 || radius <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, `hsla(${hue},90%,72%,${alpha})`);
  g.addColorStop(0.5, `hsla(${(hue + 50) % 360},90%,62%,${alpha * 0.5})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawCosmicGlows(now) {
  if (dancing && posePts) {
    const center = torsoCenter();
    if (center) {
      const bodyScale = Math.max(60, dist(posePts[11], posePts[23]));
      const r = bodyScale * 2.6;
      drawGlow(center.x, center.y, r, cosmicHue(now), Math.min(0.5, auraMat.opacity * 0.55));
    }
  }
  if (armsRaised && posePts) {
    const midX = (posePts[15].x + posePts[16].x) / 2;
    const topY = Math.min(posePts[15].y, posePts[16].y);
    drawGlow(midX, topY, 190, cosmicHue(now), Math.min(0.55, pillarMat.opacity * 0.6));
  }
  if (facePts && smileStrength > 0.05) {
    const strength = Math.min(1, smileStrength * 1.9);
    const scale = Math.max(0.8, faceScale / 55);
    drawGlow(facePts.x, facePts.y, 140 * scale, 45, strength * 0.6);
  }
}

function triggerUniverse(now, reason) {
  if (now <= universeCooldownUntil) return;
  universeActive = true;
  universeStartedAt = now;
  universeCooldownUntil = now + UNIVERSE_DURATION + UNIVERSE_COOLDOWN;
  waveMarks = [];
  showToast(reason || "🌌 宇宙展開！！");
}

function detectPinch(landmarks) {
  const tipDistance = dist(landmarks[4], landmarks[8]);
  const palmWidth = Math.max(dist(landmarks[5], landmarks[17]), 0.001);
  const ratio = tipDistance / palmWidth;

  // Hysteresis prevents rapid flicker around the threshold.
  if (!pinchLatched && ratio < 0.38) pinchLatched = true;
  if (pinchLatched && ratio > 0.50) pinchLatched = false;
  return { isPinch: pinchLatched, ratio };
}

// ---------- overall hand speed (drives effect intensity + wave/throw detection) ----------
function trackHandSpeed(center, now) {
  if (center) {
    palmHistory.push({ x: center.x, y: center.y, t: now });
    palmHistory = palmHistory.filter(p => now - p.t < 450);
  } else {
    palmHistory = [];
  }

  let speed = 0;
  if (palmHistory.length >= 2) {
    const a = palmHistory[0], b = palmHistory[palmHistory.length - 1];
    const dt = Math.max(1, b.t - a.t);
    speed = dist(a, b) / dt;
  }
  speedEMA = speedEMA * 0.82 + speed * 0.18;

  if (center) {
    if (lastCenterX !== null) {
      const dx = center.x - lastCenterX;
      const dir = dx > 3 ? 1 : dx < -3 ? -1 : 0;
      if (dir !== 0 && lastCenterDir !== 0 && dir !== lastCenterDir) {
        waveMarks.push(now);
      }
      if (dir !== 0) lastCenterDir = dir;
    }
    lastCenterX = center.x;
  } else {
    lastCenterX = null;
    lastCenterDir = 0;
  }
  waveMarks = waveMarks.filter(t => now - t < 900);

  if (waveMarks.length >= 4 && speedEMA > WAVE_SPEED_THRESHOLD) {
    triggerUniverse(now, "🌌 宇宙展開！！");
  }
}

// ---------- throwable energy orb ----------
function trySpawnThrow(now) {
  if (trail.length < 2) return;
  const a = trail[trail.length - 2], b = trail[trail.length - 1];
  const dt = Math.max(1, b.t - a.t);
  const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
  if (Math.hypot(vx, vy) < THROW_MIN_SPEED) return;

  const orb = makeOrb();
  projectiles.push({ ...orb, x: b.x, y: b.y, vx, vy, born: now, last: now, life: 1600, trailPts: [] });
  showToast("💥 光球發射！");
}

function updateProjectiles(now) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const dt = Math.min(48, now - p.last);
    p.vy += GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.last = now;

    p.group.position.set(p.x, p.y, 0);
    p.shell.rotation.x += 0.12;
    p.shell.rotation.y += 0.09;

    const age = now - p.born;
    const fade = Math.max(0, 1 - age / p.life);
    p.shell.material.opacity = .95 * fade;
    p.glow.material.opacity = .85 * fade;

    p.trailPts.push({ x: p.x, y: p.y, t: now });
    p.trailPts = p.trailPts.filter(q => now - q.t < 260);

    const offscreen = p.x < -60 || p.x > innerWidth + 60 || p.y < -60 || p.y > innerHeight + 60;
    if (age > p.life || offscreen) {
      scene.remove(p.group);
      impacts.push({ x: p.x, y: p.y, born: now });
      projectiles.splice(i, 1);
    }
  }
}

function drawProjectileTrails(now) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.globalCompositeOperation = "lighter";
  for (const p of projectiles) {
    const pts = p.trailPts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const age = (now - b.t) / 260;
      const alpha = Math.max(0, 1 - age);
      ctx.strokeStyle = `rgba(255,208,106,${alpha * .6})`;
      ctx.lineWidth = 1 + alpha * 4;
      ctx.shadowColor = "rgba(255,190,70,.8)";
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawImpacts(now) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = impacts.length - 1; i >= 0; i--) {
    const imp = impacts[i];
    const age = now - imp.born;
    const life = 480;
    if (age > life) { impacts.splice(i, 1); continue; }
    const progress = age / life;
    const count = 20;
    for (let j = 0; j < count; j++) {
      const a = (j / count) * Math.PI * 2;
      const r = 6 + progress * 70;
      const x = imp.x + Math.cos(a) * r;
      const y = imp.y + Math.sin(a) * r;
      ctx.fillStyle = `rgba(255,208,106,${(1 - progress) * .8})`;
      ctx.shadowColor = "#ffd06a";
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, 2 + (1 - progress) * 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

// ---------- fast-wave "universe" starfield ----------
function updateUniverse(now) {
  if (!universeActive) {
    starField.visible = false;
    trackParticleTrail(STAR_TRAIL, starField, starGeo.attributes.position.array, now, 320, false);
    return;
  }
  const t = now - universeStartedAt;
  if (t > UNIVERSE_DURATION) { universeActive = false; starField.visible = false; return; }

  starField.visible = true;
  const growth = t * 0.62;
  const positions = starGeo.attributes.position.array;
  for (let i = 0; i < STAR_COUNT; i++) {
    const r = starBaseR[i] + growth * starSpeed[i];
    positions[i * 3] = Math.cos(starAngles[i]) * r;
    positions[i * 3 + 1] = Math.sin(starAngles[i]) * r;
    positions[i * 3 + 2] = 0;
  }
  starGeo.attributes.position.needsUpdate = true;

  const fadeIn = Math.min(1, t / 260);
  const fadeOut = 1 - Math.max(0, (t - (UNIVERSE_DURATION - 500)) / 500);
  const envelope = Math.max(0, Math.min(fadeIn, fadeOut));
  starMat.opacity = envelope * 0.95;
  starField.rotation.z += 0.0009 * (1 + speedEMA);
  trackParticleTrail(STAR_TRAIL, starField, positions, now, 320, true);
}

function drawPointingLaser(pts, now) {
  const from = pts[5], to = pts[8];
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const beamLen = 260 + speedEMA * 140;
  const ex = to.x + ux * beamLen, ey = to.y + uy * beamLen;
  const hue = cosmicHue(now);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `hsla(${hue}, 90%, 70%, .8)`;
  ctx.lineWidth = 2.4;
  ctx.shadowColor = `hsl(${hue}, 90%, 65%)`;
  ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.moveTo(to.x, to.y); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.restore();
}

// ---------- full-body pose: dancing + arms-raised ----------
function torsoCenter() {
  if (!posePts) return null;
  const ids = [11, 12, 23, 24];
  let x = 0, y = 0;
  for (const id of ids) { x += posePts[id].x; y += posePts[id].y; }
  return { x: x / ids.length, y: y / ids.length };
}

// A rough loop around the body's silhouette (head -> arm -> leg -> other leg
// -> other arm -> head) used to keep the aura fairy-dust hugging the outline
// instead of ballooning out from a single point in the chest.
const BODY_OUTLINE_IDS = [0, 11, 13, 15, 23, 25, 27, 28, 26, 24, 16, 14, 12, 0];

function buildBodyOutline(pts) {
  const nodes = BODY_OUTLINE_IDS.map(id => pts[id]);
  const segLens = [];
  let total = 0;
  for (let i = 1; i < nodes.length; i++) {
    const d = Math.max(1, dist(nodes[i - 1], nodes[i]));
    segLens.push(d);
    total += d;
  }
  return { nodes, segLens, total };
}

// Walks t (0-1, wraps around) along the outline loop and returns the point
// there plus the outward-ish normal, so particles can float just outside it.
function pointOnOutline(outline, t) {
  let target = (((t % 1) + 1) % 1) * outline.total;
  for (let i = 0; i < outline.segLens.length; i++) {
    const segLen = outline.segLens[i];
    if (target <= segLen || i === outline.segLens.length - 1) {
      const a = outline.nodes[i], b = outline.nodes[i + 1];
      const frac = segLen > 0 ? target / segLen : 0;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: a.x + dx * frac, y: a.y + dy * frac, nx: -dy / len, ny: dx / len };
    }
    target -= segLen;
  }
  const last = outline.nodes[outline.nodes.length - 1];
  return { x: last.x, y: last.y, nx: 0, ny: -1 };
}

function updatePoseUi() {
  bodyStateEl.textContent = dancing
    ? (armsRaised ? "跳舞+舉手" : "跳舞中")
    : (armsRaised ? "舉手" : (posePts ? "偵測中" : "—"));
}

function processPose(result, now) {
  const lm = result?.landmarks?.[0];
  if (!lm) {
    posePts = null;
    prevPosePts = null;
    danceEnergy *= 0.85;
    if (danceEnergy < DANCE_ENERGY_OFF) dancing = false;
    armsRaised = false;
    updatePoseUi();
    return;
  }

  const pts = lm.map(mapPoint);
  posePts = pts;

  if (prevPosePts) {
    let energy = 0;
    for (const id of POSE_TRACK_IDS) energy += dist(pts[id], prevPosePts[id]);
    danceEnergy = danceEnergy * 0.75 + (energy / POSE_TRACK_IDS.length) * 0.25;
  }
  prevPosePts = pts;

  if (!dancing && danceEnergy > DANCE_ENERGY_ON) {
    dancing = true;
    danceSince = now;
    danceUniverseFired = false;
    showToast("💃 舞力全開！");
  } else if (dancing && danceEnergy < DANCE_ENERGY_OFF) {
    dancing = false;
  }

  if (dancing && !danceUniverseFired && now - danceSince > DANCE_UNIVERSE_DELAY) {
    danceUniverseFired = true;
    triggerUniverse(now, "🌌 舞動宇宙展開！！");
  }

  armsRaised = pts[15].y < pts[0].y - ARMS_RAISED_MARGIN && pts[16].y < pts[0].y - ARMS_RAISED_MARGIN;

  updatePoseUi();
}

function updateBodyAura(now) {
  const active = dancing && !!posePts;
  if (!active) {
    auraMat.opacity = Math.max(0, auraMat.opacity - 0.05);
    auraOuterMat.opacity = Math.max(0, auraOuterMat.opacity - 0.05);
    trackParticleTrail(AURA_TRAIL, auraPoints, auraGeo.attributes.position.array, now, 420, false);
    if (auraMat.opacity <= 0) { auraPoints.visible = false; auraOuterPoints.visible = false; }
    return;
  }
  auraPoints.visible = true;
  auraOuterPoints.visible = true;
  auraMat.opacity = Math.min(1, auraMat.opacity + 0.08);
  auraOuterMat.opacity = Math.min(0.75, auraOuterMat.opacity + 0.06);

  // Fairy-dust particles ride along the body's outline (not a blob centered in
  // the chest) so they visually wrap around the person instead of sitting inside them.
  const outline = buildBodyOutline(posePts);
  const bodyScale = Math.max(60, dist(posePts[11], posePts[23])) / 130;

  const positions = auraGeo.attributes.position.array;
  const colors = auraGeo.attributes.color.array;
  for (let i = 0; i < AURA_COUNT; i++) {
    const t = i / AURA_COUNT + now * 0.00014;
    const p = pointOnOutline(outline, t);
    const flutter = Math.sin(now * 0.008 + i * 2.7) * 14 * bodyScale;
    const breathe = 16 + (Math.sin(now * 0.0016 + i * 1.3) * .5 + .5) * 44 * bodyScale;
    const off = breathe + flutter;
    positions[i * 3] = p.x + p.nx * off;
    positions[i * 3 + 1] = p.y + p.ny * off;
    positions[i * 3 + 2] = Math.sin(now * 0.003 + i) * 40;

    const twinkle = 0.3 + 0.7 * Math.max(0, Math.sin(now * 0.01 + i * 4.13));
    colors[i * 3] = auraBaseColors[i * 3] * twinkle;
    colors[i * 3 + 1] = auraBaseColors[i * 3 + 1] * twinkle;
    colors[i * 3 + 2] = auraBaseColors[i * 3 + 2] * twinkle;
  }
  auraGeo.attributes.position.needsUpdate = true;
  auraGeo.attributes.color.needsUpdate = true;
  trackParticleTrail(AURA_TRAIL, auraPoints, positions, now, 420, true);

  const outerPositions = auraOuterGeo.attributes.position.array;
  const outerColors = auraOuterGeo.attributes.color.array;
  for (let i = 0; i < AURA_OUTER_COUNT; i++) {
    const t = i / AURA_OUTER_COUNT - now * 0.00009;
    const p = pointOnOutline(outline, t);
    const breathe = 60 + (Math.sin(now * 0.0011 + i * .9) * .5 + .5) * 70 * bodyScale;
    outerPositions[i * 3] = p.x + p.nx * breathe;
    outerPositions[i * 3 + 1] = p.y + p.ny * breathe;
    outerPositions[i * 3 + 2] = Math.cos(now * 0.002 + i) * 60;

    const twinkle = 0.25 + 0.75 * Math.max(0, Math.sin(now * 0.007 + i * 3.7));
    outerColors[i * 3] = auraOuterBaseColors[i * 3] * twinkle;
    outerColors[i * 3 + 1] = auraOuterBaseColors[i * 3 + 1] * twinkle;
    outerColors[i * 3 + 2] = auraOuterBaseColors[i * 3 + 2] * twinkle;
  }
  auraOuterGeo.attributes.position.needsUpdate = true;
  auraOuterGeo.attributes.color.needsUpdate = true;
}

function updatePillar(now) {
  if (!armsRaised || !posePts) {
    pillarMat.opacity = Math.max(0, pillarMat.opacity - 0.06);
    if (pillarMat.opacity <= 0) { pillarPoints.visible = false; return; }
  } else {
    pillarPoints.visible = true;
    pillarMat.opacity = Math.min(1, pillarMat.opacity + 0.1);
    const midX = (posePts[15].x + posePts[16].x) / 2;
    const topY = Math.min(posePts[15].y, posePts[16].y);
    pillarPoints.position.set(midX, topY, 0);
  }
  pillarMat.color.setHex(cosmicHex(now));

  const positions = pillarGeo.attributes.position.array;
  for (let i = 0; i < PILLAR_COUNT; i++) {
    const t = (i / PILLAR_COUNT + (now * 0.0009) % 1) % 1;
    const h = -t * 520; // shoot upward (negative y = up on screen)
    const wob = Math.sin(now * 0.006 + i) * 18 * (1 - t);
    positions[i * 3] = wob;
    positions[i * 3 + 1] = h;
    positions[i * 3 + 2] = Math.cos(now * 0.004 + i) * 12;
  }
  pillarGeo.attributes.position.needsUpdate = true;
}

// ---------- facial expression: smile halo + surprise shockwave ----------
function updateFaceUi() {
  faceStateEl.textContent = currentExpression === "Neutral" ? "—" : currentExpression;
}

function processFace(result, now) {
  const lm = result?.faceLandmarks?.[0];
  const shapes = result?.faceBlendshapes?.[0]?.categories;
  if (!lm || !shapes) {
    facePts = null;
    currentExpression = "Neutral";
    prevExpression = "Neutral";
    smileStrength = Math.max(0, smileStrength - 0.08);
    updateFaceUi();
    return;
  }

  facePts = mapPoint(lm[1]); // landmark 1 ~= nose tip
  const eyeL = mapPoint(lm[33]);
  const eyeR = mapPoint(lm[263]);
  faceScale = Math.max(30, dist(eyeL, eyeR) * 2.2); // proxy for on-screen face width

  const score = {};
  for (const c of shapes) score[c.categoryName] = c.score;

  const smile = ((score.mouthSmileLeft || 0) + (score.mouthSmileRight || 0)) / 2;
  const jawOpen = score.jawOpen || 0;
  const browUp = score.browInnerUp || 0;
  smileStrength = smileStrength * 0.55 + smile * 0.45;

  let expr = "Neutral";
  if (jawOpen > SURPRISE_JAW_ON && browUp > SURPRISE_BROW_ON) expr = "Surprise";
  else if (smile > SMILE_ON) expr = "Smile";

  if (expr !== prevExpression) {
    if (expr === "Surprise") {
      shockwaves.push({ x: facePts.x, y: facePts.y, born: now });
      showToast("😮 驚訝衝擊波！");
    } else if (expr === "Smile") {
      showToast("😊 微笑能量！");
    }
    prevExpression = expr;
  }
  currentExpression = expr;
  updateFaceUi();
}

function updateFaceHalo(now) {
  if (!facePts || smileStrength < 0.05) {
    faceHalo.material.opacity = Math.max(0, faceHalo.material.opacity - 0.05);
    faceHalo2.material.opacity = Math.max(0, faceHalo2.material.opacity - 0.05);
    return;
  }

  const strength = Math.min(1, smileStrength * 1.9);
  const scale = Math.max(0.8, faceScale / 55);
  const pulse = 1 + Math.sin(now * 0.006) * 0.06;

  faceHalo.position.set(facePts.x, facePts.y, 0);
  faceHalo2.position.set(facePts.x, facePts.y, 0);

  faceHalo.material.opacity = Math.min(0.95, strength);
  faceHalo2.material.opacity = Math.min(0.7, strength * 0.8);

  faceHalo.scale.setScalar(scale * pulse);
  faceHalo2.scale.setScalar(scale * (1 + Math.sin(now * 0.005 + 1) * 0.08));
  faceHalo.rotation.z += 0.01;
  faceHalo2.rotation.z -= 0.008;
}

function drawShockwaves(now) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    const age = now - s.born;
    const life = 700;
    if (age > life) { shockwaves.splice(i, 1); continue; }
    const p = age / life;
    ctx.strokeStyle = `rgba(180,220,255,${(1 - p) * .85})`;
    ctx.lineWidth = 3 + (1 - p) * 4;
    ctx.shadowColor = "#bcefff";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 20 + p * 160, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 900);
}

function setStatus(text, kind = "") {
  statusEl.className = `status ${kind}`;
  statusEl.innerHTML = `<span class="status-dot"></span>${text}`;
}

async function initRecognizer() {
  if (recognizer) return;
  setStatus("載入 AI 模型…");
  startBtn.disabled = true;
  startBtn.textContent = "載入模型中…";

  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const [hand, pose, face] = await Promise.all([
    GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      cannedGesturesClassifierOptions: { scoreThreshold: 0.45, maxResults: 1 }
    }),
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL },
      runningMode: "VIDEO",
      numPoses: 1
    }),
    FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL_URL },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true
    })
  ]);
  recognizer = hand;
  poseLandmarker = pose;
  faceLandmarker = face;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("此瀏覽器不支援相機 API");
  if (stream) stream.getTracks().forEach(t => t.stop());

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 60 }
    }
  };

  stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  await video.play();
  mirror = facingMode === "user";
  video.style.transform = mirror ? "scaleX(-1)" : "none";
  flipBtn.disabled = false;
  setStatus("CAMERA ONLINE", "ready");
}

startBtn.addEventListener("click", async () => {
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    secureHint.textContent = "手機相機需要 HTTPS。請先把這個資料夾放到 GitHub Pages / Netlify / Vercel 等 HTTPS 靜態網站再開啟。";
    return;
  }

  try {
    secureHint.textContent = "";
    await initRecognizer();
    await startCamera();
    running = true;
    startPanel.classList.add("hidden");
    startBtn.textContent = "啟動相機";
    startBtn.disabled = false;
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    startBtn.textContent = "重新嘗試";
    setStatus("啟動失敗", "error");
    secureHint.textContent = `無法啟動：${err?.message || err}。請確認已允許相機權限。`;
  }
});

flipBtn.addEventListener("click", async () => {
  if (!running) return;
  flipBtn.disabled = true;
  facingMode = facingMode === "user" ? "environment" : "user";
  try {
    await startCamera();
    showToast(facingMode === "user" ? "前鏡頭" : "後鏡頭");
  } catch (err) {
    console.error(err);
    facingMode = facingMode === "user" ? "environment" : "user";
    showToast("切換鏡頭失敗");
  } finally {
    flipBtn.disabled = false;
  }
});

helpBtn.addEventListener("click", () => helpOverlay.classList.remove("hidden"));
helpCloseBtn.addEventListener("click", () => helpOverlay.classList.add("hidden"));
helpOverlay.addEventListener("click", (e) => {
  if (e.target === helpOverlay) helpOverlay.classList.add("hidden");
});

function updateUi(result, pinch) {
  const gesture = currentGesture;
  gestureEl.textContent = gesture === "None" ? "SCANNING" : gesture;
  gestureZhEl.textContent = GESTURE_ZH[gesture] || gesture;
  confEl.textContent = `${Math.round(currentConfidence * 100)}%`;
  confBar.style.width = `${Math.round(currentConfidence * 100)}%`;
  pinchValueEl.textContent = Number.isFinite(pinch?.ratio) ? pinch.ratio.toFixed(2) : "—";

  const handed = result?.handedness?.[0]?.[0]?.categoryName;
  handednessEl.textContent = handed || "—";
}

function processResult(result, now) {
  currentResult = result;
  const landmarks = result?.landmarks?.[0];
  if (!landmarks) {
    currentGesture = "None";
    currentConfidence = 0;
    pinchLatched = false;
    if (pinchActivePrev) trySpawnThrow(now);
    pinchActivePrev = false;
    updateUi(result, null);
    return;
  }

  const pinch = detectPinch(landmarks);
  const canned = result?.gestures?.[0]?.[0];
  currentGesture = pinch.isPinch ? "PINCH" : (canned?.categoryName || "None");
  currentConfidence = pinch.isPinch ? Math.min(1, 1.1 - pinch.ratio) : (canned?.score || 0);

  if (pinchActivePrev && !pinch.isPinch) trySpawnThrow(now);
  pinchActivePrev = pinch.isPinch;

  if (currentGesture !== prevGesture && currentGesture !== "None") {
    if (currentGesture === "Open_Palm") burstEnergy = 1;
    showToast(GESTURE_ZH[currentGesture] || currentGesture);
    prevGesture = currentGesture;
  } else if (currentGesture === "None") {
    prevGesture = "None";
  }

  updateUi(result, pinch);
}

function infer(now) {
  if (!running || !recognizer || video.readyState < 2) return;
  // ~18–20 inference FPS is a good mobile balance; effects still render at display refresh rate.
  if (now - lastInferenceAt < 52) return;
  if (video.currentTime === lastVideoTime) return;

  lastInferenceAt = now;
  lastVideoTime = video.currentTime;
  try {
    const result = recognizer.recognizeForVideo(video, now);
    processResult(result, now);
    inferenceFrames++;
  } catch (err) {
    console.warn("Hand inference error", err);
  }

  // Pose and face are heavier models; alternate them across ticks so hand
  // tracking (the core interaction) keeps its full inference rate.
  inferenceTick++;
  try {
    if (inferenceTick % 2 === 0) {
      if (poseLandmarker) processPose(poseLandmarker.detectForVideo(video, now), now);
    } else {
      if (faceLandmarker) processFace(faceLandmarker.detectForVideo(video, now), now);
    }
  } catch (err) {
    console.warn("Pose/face inference error", err);
  }

  if (now - fpsWindowStart >= 1000) {
    fpsEl.textContent = String(inferenceFrames);
    inferenceFrames = 0;
    fpsWindowStart = now;
  }
}

function palmCenter(landmarks) {
  const ids = [0, 5, 9, 13, 17];
  let x = 0, y = 0;
  for (const id of ids) {
    const p = mapPoint(landmarks[id]);
    x += p.x; y += p.y;
  }
  return { x: x / ids.length, y: y / ids.length };
}

function drawHudReticle(x, y, radius, now) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "rgba(114,255,243,.62)";
  ctx.lineWidth = 1;
  ctx.shadowColor = "rgba(114,255,243,.8)";
  ctx.shadowBlur = 8;

  const rot = now * 0.0012;
  for (let i = 0; i < 4; i++) {
    const a0 = rot + i * Math.PI / 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, a0, a0 + .52);
    ctx.stroke();
  }

  ctx.globalAlpha = .42;
  ctx.beginPath(); ctx.arc(0, 0, radius * .68, -rot, -rot + Math.PI * 1.45); ctx.stroke();
  ctx.globalAlpha = .32;
  ctx.beginPath();
  ctx.moveTo(-radius * 1.2, 0); ctx.lineTo(-radius * .72, 0);
  ctx.moveTo(radius * .72, 0); ctx.lineTo(radius * 1.2, 0);
  ctx.moveTo(0, -radius * 1.2); ctx.lineTo(0, -radius * .72);
  ctx.moveTo(0, radius * .72); ctx.lineTo(0, radius * 1.2);
  ctx.stroke();
  ctx.restore();
}

function drawSkeleton(landmarks) {
  const pts = landmarks.map(mapPoint);
  ctx.save();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "rgba(114,255,243,.66)";
  ctx.shadowColor = "rgba(114,255,243,.85)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  for (const [a, b] of CONNECTIONS) {
    ctx.moveTo(pts[a].x, pts[a].y);
    ctx.lineTo(pts[b].x, pts[b].y);
  }
  ctx.stroke();

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    ctx.beginPath();
    ctx.fillStyle = i === 8 ? "#ffd06a" : "rgba(196,255,251,.95)";
    ctx.arc(p.x, p.y, i === 8 ? 3.8 : 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return pts;
}

function updateTrail(indexTip, now) {
  if (indexTip) trail.push({ x: indexTip.x, y: indexTip.y, t: now });
  trail = trail.filter(p => now - p.t < 620).slice(-42);

  if (trail.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "lighter";
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i];
    const age = (now - b.t) / 620;
    const alpha = Math.max(0, 1 - age);
    ctx.strokeStyle = `rgba(255,208,106,${alpha * .72})`;
    ctx.lineWidth = 1 + alpha * 5;
    ctx.shadowColor = "rgba(255,190,70,.85)";
    ctx.shadowBlur = 10 + alpha * 12;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

function drawBurst(center, now) {
  if (burstEnergy <= 0 || !center) return;
  const progress = 1 - burstEnergy;
  const count = 28;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i++) {
    const a = i / count * Math.PI * 2 + i * .27;
    const r = 24 + progress * (90 + (i % 5) * 10);
    const x = center.x + Math.cos(a) * r;
    const y = center.y + Math.sin(a) * r;
    ctx.fillStyle = `rgba(114,255,243,${burstEnergy * .75})`;
    ctx.shadowColor = "#72fff3";
    ctx.shadowBlur = 9;
    ctx.beginPath(); ctx.arc(x, y, 1.2 + burstEnergy * 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  burstEnergy = Math.max(0, burstEnergy - .045);
}

function updateThree(landmarks, pts, now) {
  updateProjectiles(now);
  updateUniverse(now);
  updateBodyAura(now);
  updatePillar(now);
  updateFaceHalo(now);

  // Fast hand motion pumps up scale/spin/spread across whatever effect is active.
  const speedMul = Math.min(3.2, 1 + speedEMA * 1.2);

  if (!landmarks || !pts) {
    energyGroup.visible = false;
    renderer.render(scene, camera);
    return;
  }

  const tip = pts[8];
  energyGroup.visible = true;
  energyGroup.position.set(tip.x, tip.y, 0);

  const fx = GESTURE_FX[currentGesture] || GESTURE_FX.None;
  const pinch = currentGesture === "PINCH";

  const pulse = 1 + Math.sin(now * .009) * (.08 + speedEMA * .06);
  core.scale.setScalar(fx.scale * pulse);
  innerCore.scale.setScalar(pinch ? 1.45 + Math.sin(now * .02) * .18 : .9);
  ringA.visible = fx.ringA;
  ringB.visible = fx.ringB;
  ringA.scale.setScalar(pinch ? 1.35 : 1);
  ringB.scale.setScalar(currentGesture === "Victory" ? 1.55 : pinch ? 1.15 : .8);
  core.rotation.x += .018 * fx.spin * speedMul;
  core.rotation.y += .025 * fx.spin * speedMul;
  ringA.rotation.z += .028 * fx.spin * speedMul;
  ringB.rotation.x -= .02 * fx.spin * speedMul;
  innerCore.material.opacity = pinch ? .95 : .55;
  core.material.color.setHex(fx.color);
  particleMat.color.setHex(fx.color);

  const radiusBase = fx.radius * Math.min(1.6, 1 + speedEMA * .5);
  const positions = particleGeo.attributes.position.array;
  const sinkBias = fx.sink ? 40 : 0;
  for (let i = 0; i < particleCount; i++) {
    const seed = i * 12.9898;
    const a = seed + now * (0.0007 + (i % 7) * 0.000025) * fx.spin;
    const b = i * .61 + now * .0005;
    const rr = radiusBase * (.34 + ((i * 37) % 100) / 100 * .72);
    positions[i * 3] = Math.cos(a) * rr;
    positions[i * 3 + 1] = Math.sin(a) * rr * (.52 + .36 * Math.sin(b)) + sinkBias * (.34 + ((i * 37) % 100) / 100);
    positions[i * 3 + 2] = Math.sin(b) * 80;
  }
  particleGeo.attributes.position.needsUpdate = true;
  particles.rotation.z += .009 * fx.spin * speedMul;
  particles.rotation.x = Math.sin(now * .001) * .4;

  renderer.render(scene, camera);
}

function draw(now) {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const landmarks = currentResult?.landmarks?.[0];
  let pts = null;
  let center = null;

  if (landmarks) {
    pts = drawSkeleton(landmarks);
    center = palmCenter(landmarks);
    const palmRadius = Math.max(36, dist(pts[5], pts[17]) * .62);
    drawHudReticle(center.x, center.y, palmRadius, now);
    updateTrail(pts[8], now);

    if (currentGesture === "PINCH") {
      const t = (now * .005) % (Math.PI * 2);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(255,208,106,.9)";
      ctx.lineWidth = 1.5;
      ctx.shadowColor = "#ffd06a";
      ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(pts[8].x, pts[8].y, 28 + Math.sin(t) * 5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (currentGesture === "Pointing_Up") drawPointingLaser(pts, now);
  } else {
    updateTrail(null, now);
  }

  trackHandSpeed(center, now);
  drawBurst(center, now);
  drawProjectileTrails(now);
  drawImpacts(now);
  drawShockwaves(now);
  drawParticleTrail(AURA_TRAIL, auraColors, now, 420);
  drawParticleTrail(STAR_TRAIL, starColors, now, 320, 1.3);
  drawCosmicGlows(now);

  if (universeActive) {
    const t = (now - universeStartedAt) / UNIVERSE_DURATION;
    const alpha = 0.9 * Math.sin(Math.min(1, t) * Math.PI);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(
      innerWidth / 2, innerHeight / 2, 0,
      innerWidth / 2, innerHeight / 2, Math.max(innerWidth, innerHeight) * 0.7
    );
    g.addColorStop(0, `rgba(255,210,140,${0.1 * alpha})`);
    g.addColorStop(0.45, `rgba(160,110,255,${0.1 * alpha})`);
    g.addColorStop(1, "rgba(20,10,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    ctx.restore();
  }

  updateThree(landmarks, pts, now);
}

function loop(now) {
  infer(now);
  draw(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
  secureHint.textContent = "注意：手機瀏覽器的相機通常只允許在 HTTPS 網站使用。直接雙擊 index.html 可能無法開相機。";
}

// Pause camera when the page is hidden to save battery; restart video playback when visible.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    video.pause();
  } else if (running && stream) {
    video.play().catch(() => {});
  }
});
