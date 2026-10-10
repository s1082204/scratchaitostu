# Scratch3 + AI 教育版 1.5.2-beta — 網頁版部署到 Cloudflare Pages

網頁版是一個純靜態網站（`Scratch3-AI-Edu-1.5.2-beta-web.zip` 解開後的資料夾），
不需要任何後端。放到 Cloudflare Pages 之後，學生用 Chrome / Safari / Edge 打開網址即可，
Windows、Mac、Chromebook、iPad 都能用，不用安裝、不會有 macOS 封鎖問題。

- 3,275 個檔案、約 255 MB，最大單檔 22 MB
  （Cloudflare Pages 限制：20,000 個檔案、單檔 25 MiB — 都在範圍內）
- 一定要用 **HTTPS**（Cloudflare Pages 預設就是），否則瀏覽器不會開放攝影機。
- 需要網路才能開啟；AI 模型與 Scratch 素材全部在站內，不依賴任何外部 CDN。


## 方法 A：連結 GitHub（推薦；之後更新只要 push）

1. 在 GitHub 建一個新的 repository（可以是 Private）。
2. 把網站資料夾的內容放進 repo 的根目錄（或是請 Claude 直接推上去），推到 `main`。
3. Cloudflare 儀表板 → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
   → 選這個 repo。
4. Build 設定：
   - Framework preset：**None**
   - Build command：（留空）
   - Build output directory：`/`（若網站放在子資料夾，例如 `site`，就填 `site`）
5. 按 **Save and Deploy**。一兩分鐘後會得到 `https://<專案名>.pages.dev` 的網址。
6. 之後要更新版本：改檔案 → push → Cloudflare 自動重新部署。

## 方法 B：直接上傳（不用 GitHub）

1. 解壓縮 `Scratch3-AI-Edu-1.5.2-beta-web.zip`，得到一個資料夾。
2. Cloudflare 儀表板 → **Workers & Pages** → **Create** → **Pages** → **Upload assets**。
3. 輸入專案名稱 → 把整個資料夾拖進上傳區（或選擇資料夾）→ **Deploy site**。
   上傳 255 MB 需要幾分鐘，請不要關閉頁面。
4. 之後要更新：同一個專案 → **Create new deployment** → 再拖一次資料夾。

（也可以在 Mac 終端機用 Wrangler：`npx wrangler pages deploy <資料夾> --project-name=<專案名>`，
需要先裝 Node.js 並 `npx wrangler login`。）


## 部署完成後的檢查

打開網址後：
1. 左下角「添加擴展」→ 應看到 ML2Scratch、Handpose2Scratch、Facemesh2Scratch、音樂、畫筆。
2. 加入 Handpose2Scratch → 瀏覽器詢問攝影機 → 允許 → 舞台應出現鏡頭畫面。
3. 「選擇角色」→ 角色庫圖片應正常顯示（代表 Scratch 素材走站內路徑）。
4. 右下角有「授權與致謝 · 效能檢測」連結（原本 Electron 版的 F1 / F2，鍵盤 F1 / F2 也仍可用）。

## 自訂 Teachable Machine 模型

- 線上版最簡單的做法：學生直接把 teachablemachine.withgoogle.com 匯出的網址貼進積木。
- 若要放在站內：把模型資料夾（model.json / metadata.json / weights.bin）放到
  `user-models/<名稱>/`，重新部署，積木裡輸入 `/user-models/<名稱>/`。
  站內已附 `sample-image`、`sample-pose`、`sample-sound` 三個範例。

## 自訂網域（選用）

Pages 專案 → **Custom domains** → 加入學校網域（例如 `scratch-ai.xxx.edu.tw`），
依指示加一筆 CNAME 即可，HTTPS 憑證 Cloudflare 自動處理。


## 技術備註（給維護者）

與 Windows / Mac 桌面版使用同一份 `app/` 內容，差異只有：
- Electron 主程序原本用 `webRequest` 把 tfhub / kaggle / googleapis / jsdelivr / stretch3.github.io /
  teachablemachine 範例 / Scratch 素材 CDN 轉向站內副本；網頁版沒有這一層，所以直接把
  `lib.min.js`、`cdn/stretch3/ml5-library/ml5.min.js`、`cdn/tm-pose/0.8/teachablemachine-pose.min.js`
  內的網址改成站內相對路徑（共 51 處；對照表見 `tools/patch-web.py`）。
- ml5 以「網址含 tfhub.dev」判斷要不要自動補 `/model.json?tfjs-format=file`，已改成
  「站內 `/cdn/` 路徑也視為 TF Hub 格式」，否則 ML2Scratch 載入 MobileNet 0.5 會失敗。
- scratch-storage 的素材網址 `<assetHost>/internalapi/asset/<md5>/get/` 改成 `/static/assets/<md5>`；
  `_redirects` 另保留舊格式的 rewrite 當保險。
- `web-extras.js`：頁面標題、F1 / F2 快速鍵、右下角授權連結。
- `_headers`：模型與素材長快取（immutable），`index.html` / `lib.min.js` 不快取以便更新。
- 沒有鏡射的功能（sketchRNN、sentiment、universal-sentence-encoder、darknet / doodlenet）
  在桌面版離線時同樣不能用，網頁版維持一致。
- 本版擴展庫只註冊了 ML2Scratch / Handpose2Scratch / Facemesh2Scratch（TM2Scratch、TMPose2Scratch
  的程式碼仍在 bundle 裡但未註冊，與 Windows 版相同）。
- 已用 headless Chromium 實測：三個 AI 擴展的模型全部從站內載入、角色庫 339 張圖示從
  `/static/assets/` 載入，整個過程沒有任何對外請求、沒有 4xx/5xx。
