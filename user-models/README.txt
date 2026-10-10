使用上的小提醒
================

切換攝影機擴展時請按 Ctrl + R（或 F5）整頁重新載入
---------------------------------------------------
ML2Scratch / TM2Scratch / TMPose2Scratch / Handpose2Scratch / Facemesh2Scratch
這五個擴展都會獨立向攝影機要影像，並且不會在停用時主動釋放。
所以在「同一個專案」內中途換成另一個擴展，第二個擴展可能拿不到
攝影機（看到黑畫面或一直 loading）。

最簡單的處理方式：按 Ctrl + R（或 F5）整頁重新載入。Scratch 會回到
空白起始狀態（請先記得存檔），所有 WebGL context 與攝影機 stream
都會被瀏覽器釋放，新的擴展就能正常啟動攝影機。

DevTools（F12）
----------------
按 F12 可以打開開發者工具看詳細錯誤訊息，方便老師除錯。


附帶的內建範例模型
===================
- TM2Scratch（圖像分類）的預設範例：石頭 / 剪刀 / 布
- TMPose2Scratch（姿勢分類）的預設範例：一般 / 舉右手 / 舉左手

兩個範例都是 Google Teachable Machine 官方提供，僅作示範用途。
範例模型在特定環境（拍攝者的光線、角度、距離）下訓練，學生實際
使用時建議自己重新訓練模型，準確度會明顯提升。


user-models/  —  Teachable Machine 模型放置處
================================================

每個子資料夾代表一個 TM 模型。資料夾名稱可以自取（建議用英文/數字，
避免空格與中文字元）。每個資料夾內必須包含三個檔案：

    your-model-name/
        model.json
        metadata.json
        weights.bin

這三個檔案是從 https://teachablemachine.withgoogle.com 訓練後，
按 "Export Model → TensorFlow.js → Download my model" 拿到的 zip
解壓縮出來的內容。

如何在 Scratch TM 區塊裡載入：
-------------------------------
在 TM2Scratch 或 TMPose2Scratch 的「Use Model from URL」區塊裡輸入：

    /user-models/your-model-name/

(注意：開頭與結尾的 "/" 都要加)

範例：要載入 sample-image/ 模型，輸入：

    /user-models/sample-image/

為什麼用相對路徑而不是完整 URL？
---------------------------------
Electron portable EXE 內部跑的本機 HTTP server 用的是動態 port
(每次啟動可能不同)，所以不能寫死 http://127.0.0.1:PORT/。
用相對路徑 "/user-models/.../"，瀏覽器會自動拼成正確的本機 URL。

附帶的三個範例模型 (在 EXE 內部，唯讀)
---------------------------------------
  sample-image/  — TM 官方範例：一般圖片分類模型
  sample-pose/   — TM 官方範例：人體姿勢分類模型
  sample-sound/  — TM 官方範例：聲音分類模型

可以直接用 /user-models/sample-image/ 這類路徑來測試擴展是否運作正常。

要新增自己訓練的模型 (用於 portable EXE)
-----------------------------------------
Portable EXE 的內部檔案是唯讀打包的 (asar)，學生無法把自己的模型
資料夾塞進這個 EXE 裡。所以新增模型的做法是：

1. 在 portable EXE 旁邊 (同一個資料夾) 建立一個叫做 user-models/ 的子資料夾。
2. 把你的 TM 模型資料夾 (含 model.json / model.weights.bin / metadata.json
   三個檔案) 放進這個 user-models/ 裡。
3. 啟動 EXE 後，在 Scratch TM 區塊輸入路徑 /user-models/你的資料夾名稱/

範例資料夾配置：
    某個資料夾/
        Scratch3-AI-Edu-1.0.0-portable.exe
        user-models/
            student-cats-vs-dogs/
                model.json
                model.weights.bin
                metadata.json

EXE 啟動時會自動偵測外部 user-models/ 並覆蓋同名範例。也就是說，
外部的 student-cats-vs-dogs/ 會獨立存在，而 sample-image/ 等內建範例
也都還能使用。


macOS 版本的補充說明
=====================

macOS 版沒有 portable EXE，程式會依序在下列位置尋找外部 user-models/ 資料夾
（找到第一個存在的就使用）：

1. 與「Scratch3 + AI 教育版.app」放在同一個資料夾內的 user-models/
       某個資料夾/
           Scratch3 + AI 教育版.app
           user-models/
               student-cats-vs-dogs/
                   model.json
                   metadata.json
                   weights.bin

2. ~/Documents/Scratch3-AI-Edu/user-models/
   （「文件」資料夾 → Scratch3-AI-Edu → user-models）
   如果 .app 已被拖進「應用程式」資料夾，或 macOS 以唯讀方式執行剛下載的 App，
   請改用這個位置。選單「模型 → 開啟 user-models 模型資料夾」會自動建立並開啟它。

快速鍵對照（Mac 鍵盤的 F1 / F2 / F12 預設需要同時按 fn）：
    重新載入（釋放攝影機）   ⌘ R         （Windows：Ctrl+R / F5）
    開發者工具               ⌥ ⌘ I       （Windows：F12）
    授權與致謝               說明選單     （Windows：F1）
    效能檢測                 說明選單     （Windows：F2）
