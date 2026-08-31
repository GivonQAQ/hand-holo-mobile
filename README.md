# Hand Holo Lab — 手機手勢科幻 HUD Demo

這是一個 **純前端** Demo：手機相機 → MediaPipe Gesture Recognizer → 手部 21 點 → Canvas HUD / 光軌 → Three.js 3D 能量球與粒子。

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

## 技術

- `@mediapipe/tasks-vision@1.0.1`
- MediaPipe Gesture Recognizer 官方模型
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

如果手機偏舊，可在 `app.js` 找到：

```js
if (now - lastInferenceAt < 52) return;
```

改成：

```js
if (now - lastInferenceAt < 80) return;
```

會降低 AI 推論頻率、比較省電。

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

## 下一版可以加什麼？

1. 兩手同時辨識：雙手拉開生成能量球。
2. 手掌旋轉控制真正的 `.glb` 3D 機器人。
3. 🤏 抓取 / 拖曳 3D 物件。
4. 手勢切換技能與粒子 Shader。
5. 錄影按鈕。
6. WebSocket 把手機座標送到電腦 TouchDesigner。
