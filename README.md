# Hand Holo Lab — 手機手勢科幻 HUD Demo

這是一個 **純前端** Demo：手機相機 → MediaPipe（手勢 + 全身姿勢 + 臉部表情）→ Canvas HUD / 光軌 → Three.js 3D 能量球、宇宙星空與粒子。

## 已做好的互動

- 🤏 **Pinch 捏合**：拇指 + 食指靠近時顯示能量核心
- ✊ **Closed Fist 握拳**：3D 粒子收束
- ✋ **Open Palm 張手**：粒子爆散
- ✌️ **Victory**：雙環模式
- 👉 **Pointing Up**：食指延伸雷射光束（方向跟著手指指向）
- 👍 **Thumb Up** / 👎 **Thumb Down**（下沉粒子渦流）/ 🤟 **I Love You**：各自獨立配色與粒子形狀
- 每種手勢在 [app.js](app.js) 的 `GESTURE_FX` 都有專屬顏色、能量球縮放、光環顯示、粒子擴散半徑與自轉速度
- **動作快慢會即時放大特效**：手移動越快，能量球脈動、自轉速度、粒子擴散半徑都會等比放大（`speedEMA` 平滑後的手部移動速度）
- 🤏💨 **捏合後快速甩開**：放開瞬間偵測到甩動速度，會把能量核心當光球丟出去，帶拋物線重力、拖尾與落地爆裂特效
- 👋💨 **快速左右揮手**：偵測到連續方向反轉且速度夠快，會展開約 3 秒的 warp-speed 星空「宇宙模式」
- 21 點手部骨架
- 食指金色光線 Trail
- 掌心科幻 HUD Reticle
- 前 / 後鏡頭切換
- 手機友善、無 build step

### 全身動作（新增）

- 💃 **持續大動作 / 跳舞**：偵測肩膀、手腕、髖部的移動能量（`danceEnergy`），超過門檻進入「跳舞中」狀態，觸發一圈跟著身體中心飄動的全身宇宙光環（`auraPoints`）；跳超過 1.2 秒還會自動展開一次宇宙星空模式
- 🙌 **雙手舉高過頭**：兩手腕都高於鼻子，觸發一道往上衝的金黃能量光柱（`pillarPoints`）

### 表情（新增）

用 MediaPipe FaceLandmarker 的 52 種表情強度分數（blendshapes）判斷：

- 😊 **微笑**：`mouthSmileLeft/Right` 平均超過門檻，臉部出現金色光暈環，強度跟笑的程度連動
- 😮 **驚訝**：`jawOpen`（張嘴）+ `browInnerUp`（挑眉）同時超過門檻，觸發從臉部炸開的衝擊波

點畫面右上角的 **?** 按鈕可以打開完整的「動作/表情對照教學」，列出所有手勢、全身動作、表情各自對應的效果。

### 宇宙感強化（新增）

- 所有粒子（能量球、星空、跳舞光環、能量光柱）都改用**柔邊發光貼圖**（`glowTexture`），不再是生硬的方塊，看起來是一顆顆會發光的圓點
- 跳舞光環、星空粒子會取樣其中一部分粒子，用它們的真實螢幕座標畫出**會隨移動拖出的光線軌跡**（`AURA_TRAIL` / `STAR_TRAIL` + `drawParticleTrail`），而不是瞬間移動的死板點陣
- 跳舞、舉手、微笑時會在 2D 疊圖層畫一個放射狀光暈（`drawCosmicGlows`），提供背景的柔光/暈染感，比單靠 WebGL 粒子密度更有「發光」的感覺
- 星空/光環/光柱都改用星雲色票（青、紫、粉、金）而不是單一顏色，看起來更有銀河感
- 指向手勢的雷射光束改成隨時間緩慢轉色（`cosmicHue`），視覺上更像宇宙能量而不是單色雷射
- 宇宙模式的螢幕色調從單一淡紫平塗改成中心放射的星雲漸層（金→紫→透明）

## 技術

- `@mediapipe/tasks-vision@1.0.1`
  - `GestureRecognizer`：手勢 + 21 點手部
  - `PoseLandmarker`（lite 版）：33 點全身姿勢
  - `FaceLandmarker`：478 點臉部網格 + 52 種表情 blendshape 分數
- `three@0.185.1`
- HTML / CSS / JavaScript
- 不需要 Python、Node.js、TouchDesigner

> 第一次載入需要網路，因為 MediaPipe WASM、AI 模型與 Three.js 由 CDN 載入。

---

## 手機怎麼測？（重要）

手機的 `getUserMedia()` 相機權限通常要求 **HTTPS**。因此不要把 `index.html` 丟到手機後直接用檔案 App 打開。

### 方法 A：GitHub Pages（免費）

1. 在 GitHub 建一個 repo，例如 `hand-holo-lab`。
2. 把這個資料夾的 `index.html`、`style.css`、`app.js` 上傳到 repo 根目錄。
3. GitHub Repo → **Settings → Pages**。
4. `Build and deployment` 選 **Deploy from a branch**。
5. Branch 選 `main`，資料夾選 `/ (root)`，Save。
6. 等 GitHub 產生 `https://你的帳號.github.io/hand-holo-lab/`。
7. 用手機 Chrome / Safari 開啟網址 → 按「啟動相機」→ 允許相機。

### 方法 B：任何 HTTPS 靜態網站

Netlify、Vercel、Cloudflare Pages 等都可以。這個專案完全是靜態檔案，不需要 Server 或資料庫。

---

## 桌機先測

如果電腦有 Python，可在資料夾內開終端機：

```bash
python -m http.server 8000
```

瀏覽器開：

```text
http://localhost:8000
```

`localhost` 屬於瀏覽器允許相機的安全例外，因此可直接測。

---

## 手勢說明

MediaPipe 官方 Gesture Recognizer 內建：

- `Closed_Fist`
- `Open_Palm`
- `Pointing_Up`
- `Thumb_Down`
- `Thumb_Up`
- `Victory`
- `ILoveYou`

`PINCH` 是本 Demo 另外用 Landmark 距離計算：

```text
拇指尖 landmark 4
        ↘
       距離 / 手掌寬度
        ↗
食指尖 landmark 8
```

採相對比例而不是固定 px，因此手靠近或遠離鏡頭時比較穩。

---

## 效能

AI 推論刻意限制在約 18–20 FPS，但畫面特效會跟螢幕刷新率持續繪製。這樣比每個 animation frame 都跑 AI 更適合手機。

現在同時跑 3 個模型（手勢、姿勢、表情），姿勢和表情比手勢重很多，所以做法是：**手勢每個推論 tick 都跑（維持原本手感），姿勢和表情兩個輪流跑**（`app.js` 的 `infer()` 用 `inferenceTick % 2` 切換），單獨姿勢/表情的更新頻率大約是手勢的一半。

**啟動時間也會變長**：第一次啟動要下載 3 個模型（手勢+姿勢+表情），比原本只下載手勢模型慢。活動現場建議提前用同一台裝置開一次頁面暖機（瀏覽器快取住模型檔案），正式上場才不會讓排隊的人等太久。

如果手機偏舊，可在 `app.js` 找到：

```js
if (now - lastInferenceAt < 52) return;
```

改成：

```js
if (now - lastInferenceAt < 80) return;
```

會降低 AI 推論頻率、比較省電。也可以把 `PoseLandmarker` / `FaceLandmarker` 其中一個註解掉不建立，如果活動只需要其中一種效果。

---

## 新特效怎麼調

在 `app.js` 開頭的常數可以調整手感：

```js
const THROW_MIN_SPEED = 0.42;      // 甩開多快才會丟出光球（px/ms，越小越容易丟）
const WAVE_SPEED_THRESHOLD = 0.85; // 揮手要多快才觸發宇宙模式
const UNIVERSE_DURATION = 3000;    // 宇宙模式維持多久（ms）
const UNIVERSE_COOLDOWN = 3500;    // 宇宙模式結束後多久才能再觸發
const GRAVITY = 0.0016;            // 光球拋物線重力，越大弧度越明顯
```

各手勢的顏色、能量球縮放、光環開關、粒子半徑、自轉速度集中在 `GESTURE_FX`，新增手勢效果只要在裡面加一筆設定即可。

全身動作 / 表情的門檻常數：

```js
const DANCE_ENERGY_ON = 9;     // 平均移動速度多快算「開始跳舞」
const DANCE_ENERGY_OFF = 3.5;  // 降到多慢算「停止跳舞」
const ARMS_RAISED_MARGIN = 20; // 手腕要高於鼻子多少 px 才算舉手
const SMILE_ON = 0.55;         // 笑的 blendshape 分數門檻（0-1）
const SURPRISE_JAW_ON = 0.45;  // 張嘴分數門檻
const SURPRISE_BROW_ON = 0.35; // 挑眉分數門檻
```

覺得跳舞太容易/太難觸發，調 `DANCE_ENERGY_ON`；覺得笑一下就觸發太敏感，調高 `SMILE_ON`。

## 下一版可以加什麼？

1. 兩手同時辨識：雙手拉開生成能量球。
2. 手掌旋轉控制真正的 `.glb` 3D 機器人。
3. 🤏 抓取 / 拖曳 3D 物件。
4. 手勢切換技能與粒子 Shader。
5. 錄影按鈕。
6. WebSocket 把手機座標送到電腦 TouchDesigner。
7. 多人同時偵測（現在姿勢/表情都只認第一個人，`numPoses`/`numFaces` 都設 1）。
