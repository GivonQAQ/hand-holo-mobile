import {
  FilesetResolver,
  GestureRecognizer
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";
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
const toastEl = document.querySelector("#toast");

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

const particleCount = 180;
const particlePositions = new Float32Array(particleCount * 3);
const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
const particleMat = new THREE.PointsMaterial({ color: 0x72fff3, size: 3.2, transparent: true, opacity: .72, blending: THREE.AdditiveBlending, depthTest: false, sizeAttenuation: false });
const particles = new THREE.Points(particleGeo, particleMat);
energyGroup.add(particles);

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

function detectPinch(landmarks) {
  const tipDistance = dist(landmarks[4], landmarks[8]);
  const palmWidth = Math.max(dist(landmarks[5], landmarks[17]), 0.001);
  const ratio = tipDistance / palmWidth;

  // Hysteresis prevents rapid flicker around the threshold.
  if (!pinchLatched && ratio < 0.38) pinchLatched = true;
  if (pinchLatched && ratio > 0.50) pinchLatched = false;
  return { isPinch: pinchLatched, ratio };
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
  recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    cannedGesturesClassifierOptions: { scoreThreshold: 0.45, maxResults: 1 }
  });
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

function processResult(result) {
  currentResult = result;
  const landmarks = result?.landmarks?.[0];
  if (!landmarks) {
    currentGesture = "None";
    currentConfidence = 0;
    pinchLatched = false;
    updateUi(result, null);
    return;
  }

  const pinch = detectPinch(landmarks);
  const canned = result?.gestures?.[0]?.[0];
  currentGesture = pinch.isPinch ? "PINCH" : (canned?.categoryName || "None");
  currentConfidence = pinch.isPinch ? Math.min(1, 1.1 - pinch.ratio) : (canned?.score || 0);

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
    processResult(result);
    inferenceFrames++;
  } catch (err) {
    console.warn("Inference error", err);
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
  if (!landmarks || !pts) {
    energyGroup.visible = false;
    renderer.render(scene, camera);
    return;
  }

  const tip = pts[8];
  energyGroup.visible = true;
  energyGroup.position.set(tip.x, tip.y, 0);

  const pinch = currentGesture === "PINCH";
  const fist = currentGesture === "Closed_Fist";
  const open = currentGesture === "Open_Palm";
  const victory = currentGesture === "Victory";

  const pulse = 1 + Math.sin(now * .009) * .08;
  const scale = (pinch ? 1.5 : fist ? .65 : 1.0) * pulse;
  core.scale.setScalar(scale);
  innerCore.scale.setScalar(pinch ? 1.45 + Math.sin(now * .02) * .18 : .9);
  ringA.visible = !fist;
  ringB.visible = victory || pinch;
  ringA.scale.setScalar(pinch ? 1.35 : 1);
  ringB.scale.setScalar(victory ? 1.55 : pinch ? 1.15 : .8);
  core.rotation.x += .018;
  core.rotation.y += .025;
  ringA.rotation.z += .028;
  ringB.rotation.x -= .02;
  innerCore.material.opacity = pinch ? .95 : .55;
  particleMat.color.setHex(open ? 0x72fff3 : pinch ? 0xffd06a : 0x72fff3);

  const radiusBase = fist ? 22 : open ? 82 : pinch ? 45 : 58;
  const positions = particleGeo.attributes.position.array;
  for (let i = 0; i < particleCount; i++) {
    const seed = i * 12.9898;
    const a = seed + now * (0.0007 + (i % 7) * 0.000025);
    const b = i * .61 + now * .0005;
    const rr = radiusBase * (.34 + ((i * 37) % 100) / 100 * .72);
    positions[i * 3] = Math.cos(a) * rr;
    positions[i * 3 + 1] = Math.sin(a) * rr * (.52 + .36 * Math.sin(b));
    positions[i * 3 + 2] = Math.sin(b) * 80;
  }
  particleGeo.attributes.position.needsUpdate = true;
  particles.rotation.z += open ? .026 : .009;
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
  } else {
    updateTrail(null, now);
  }

  drawBurst(center, now);
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
