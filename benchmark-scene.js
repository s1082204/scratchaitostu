/*
 * benchmark-scene.js — 產生檢測用的固定測試畫面。
 *
 * 每台機器都推論同一批像素，分數才可比，所以這裡不用亂數、不用時間、也不開
 * 攝影機。畫面畫得像臉／像手，是為了讓 blazeface 與 handdetector 有機會進到
 * 第二階段（網格與骨架）——但不保證會被偵測到，所以呼叫端一定要看回傳的
 * detected 旗標，不能假設量到的是完整管線。
 */
(function (root, factory) {
    'use strict';
    root.BenchmarkScene = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const WIDTH = 640;
    const HEIGHT = 480;

    const drawFace = function (ctx, width, height) {
        ctx.fillStyle = '#8fa3bf'; ctx.fillRect(0, 0, width, height);
        const cx = width / 2, cy = height / 2, rx = width * 0.19, ry = height * 0.30;
        ctx.fillStyle = '#e8c39e';
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3b2b20';
        ctx.beginPath(); ctx.ellipse(cx - rx * 0.42, cy - ry * 0.22, rx * 0.16, ry * 0.09, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + rx * 0.42, cy - ry * 0.22, rx * 0.16, ry * 0.09, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(cx - rx * 0.62, cy - ry * 0.44, rx * 0.42, ry * 0.05);
        ctx.fillRect(cx + rx * 0.20, cy - ry * 0.44, rx * 0.42, ry * 0.05);
        ctx.strokeStyle = '#c49a76'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(cx, cy - ry * 0.10); ctx.lineTo(cx - rx * 0.10, cy + ry * 0.16); ctx.stroke();
        ctx.strokeStyle = '#8d4b45'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(cx, cy + ry * 0.28, rx * 0.38, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    };

    // 這組參數（粗手指 + 前臂 + 徑向漸層）是實測挑出來的：對 handdetector 連續
    // 10 次全部命中，而前一版細手指、無前臂的畫法是 0/10。這件事很要緊——
    // mediapipe 的 handpose 追蹤到手之後就會跳過手掌偵測器、只在裁切區域跑骨架，
    // 所以「有被偵測到」與「沒被偵測到」量到的是完全不同的兩條路徑（此機實測
    // 6.7ms vs 18.9ms）。課堂上手一定在鏡頭裡，所以要量的是被追蹤到的那條。
    const drawHand = function (ctx, width, height) {
        const cx = width / 2, cy = height * 0.542, palm = 85;
        ctx.fillStyle = '#6f7f95'; ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = '#d9ab8f'; ctx.lineWidth = palm * 1.5; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(cx, cy + palm); ctx.lineTo(cx, height); ctx.stroke();

        const skin = ctx.createRadialGradient(
            cx - palm * 0.3, cy - palm * 0.3, palm * 0.2, cx, cy, palm * 1.4);
        skin.addColorStop(0, '#f0d0b4');
        skin.addColorStop(1, '#d9ab8f');

        ctx.fillStyle = skin;
        ctx.beginPath(); ctx.ellipse(cx, cy, palm, palm * 1.1, 0, 0, Math.PI * 2); ctx.fill();

        ctx.strokeStyle = skin; ctx.lineCap = 'round';
        for (let finger = 0; finger < 4; finger++) {
            const angle = -Math.PI / 2 + (finger - 1.5) * 0.30;
            const length = palm * (finger === 1 ? 1.9 : finger === 2 ? 1.8 : 1.5);
            ctx.lineWidth = palm * 0.46;
            ctx.beginPath(); ctx.moveTo(cx, cy - palm * 0.4);
            ctx.lineTo(cx + Math.cos(angle) * length, cy - palm * 0.4 + Math.sin(angle) * length);
            ctx.stroke();
        }
        ctx.lineWidth = palm * 0.51;
        ctx.beginPath(); ctx.moveTo(cx - palm * 0.5, cy + palm * 0.2);
        ctx.lineTo(cx - palm * 1.6, cy - palm * 0.35); ctx.stroke();
    };

    // 沒有手的畫面：量「找手」路徑用。背景與 handScene 相同，差別只在沒有手，
    // 這樣兩條路徑的量測輸入除了主角以外完全一致。實驗時純背景是 0/10 偵測。
    const drawEmpty = function (ctx, width, height) {
        ctx.fillStyle = '#6f7f95'; ctx.fillRect(0, 0, width, height);
    };

    const paint = function (draw) {
        const canvas = document.createElement('canvas');
        canvas.width = WIDTH; canvas.height = HEIGHT;
        draw(canvas.getContext('2d'), WIDTH, HEIGHT);
        return canvas;
    };

    return {
        faceScene: function () { return paint(drawFace); },
        handScene: function () { return paint(drawHand); },
        emptyScene: function () { return paint(drawEmpty); },
    };
}));
