/*
 * benchmark-probe.js — 實際量測這台電腦。
 *
 * 輸入一律是固定內容的 640x480 canvas，不開攝影機，所以每台機器推論的是同一
 * 批像素，分數才可比。裝置探查與攝影機檢測在 benchmark-device.js。
 *
 * mediapipe 系（facemesh/handpose）的管線有兩條成本差 3~4 倍的路徑：畫面裡
 * 「找不到目標」時每一幀重跑偵測器（慢）；「追蹤到目標」之後只在裁切區跑第二
 * 階段（快）。課堂上兩種情況都會發生，所以 handpose 兩條都量，等級取較差的
 * 那條（實務上是找手），報表兩個數字都列。
 */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.BenchmarkProbe = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // 丟掉前幾次：避開 WebGL shader 首次編譯，也讓 handpose／facemesh 的追蹤狀態
    // 先建立起來。這兩件事都會讓第一次呼叫慢好幾倍，混進樣本就毀了中位數。
    const WARMUP_RUNS = 5;
    const SAMPLE_LIMIT = 20;
    const SAMPLE_BUDGET_MS = 6000;  // 慢機器不能讓它跑到天荒地老
    const MIN_SAMPLES = 3;
    const LOAD_TIMEOUT_MS = 90000;
    const CONCURRENCY_MS = 5000;
    const BASELINE_MS = 800;
    const LAG_PROBE_INTERVAL_MS = 100;
    const WARM_CACHE_MS = 2000;     // 載入快到這個程度，多半是檔案已在系統快取裡

    const idle = function (ms) {
        return new Promise(resolve => setTimeout(resolve, ms || 0));
    };

    const median = function (values) {
        const sorted = values.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    const percentile90 = function (values) {
        const sorted = values.slice().sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];
    };

    const round1 = function (value) { return Math.round(value * 10) / 10; };

    // 單執行緒 CPU 速度：固定運算量（60M 次整數迴圈）計時，取三次中最快的一次
    // （最接近硬體上限、受背景干擾最小）。Scratch 的介面、積木、VM 全吃單核，
    // 推論跑在內顯上量不到這件事——低功耗 CPU 配堪用內顯的機器只有這一項抓得到。
    const CPU_WORK_ITERATIONS = 60000000;
    const CPU_WORK_ROUNDS = 3;
    const timeCpuSingleCore = function () {
        const spin = function () {
            let a = 0x9e3779b9 >>> 0, acc = 0;
            for (let i = 0; i < CPU_WORK_ITERATIONS; i++) {
                a ^= a << 13; a >>>= 0; a ^= a >> 17; a ^= a << 5; a >>>= 0;
                acc = (acc + (a & 1023)) % 1000003;
            }
            return acc;
        };
        let best = Infinity;
        for (let round = 0; round < CPU_WORK_ROUNDS; round++) {
            const started = performance.now();
            spin();
            best = Math.min(best, performance.now() - started);
        }
        return round1(best);
    };

    // 三個工廠都吃 (callback)，且 callback 是 node 風格的 (err, result)。
    const loadWithCallback = function (create) {
        return new Promise(function (resolve, reject) {
            const timer = setTimeout(() => reject(new Error('模型載入超過 90 秒')), LOAD_TIMEOUT_MS);
            let instance = null;
            try {
                instance = create(function (error, result) {
                    clearTimeout(timer);
                    if (error) reject(error); else resolve(instance || result);
                });
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    };

    const timeLoad = function (create) {
        const started = performance.now();
        return loadWithCallback(create).then(function (instance) {
            return { instance: instance, ms: round1(performance.now() - started) };
        });
    };

    // 暖機後取樣，取中位數與 p90。有時間預算，慢機器不會拖垮整份檢測。
    const timeInference = async function (runOnce) {
        for (let run = 0; run < WARMUP_RUNS; run++) await runOnce();
        const samples = [];
        const deadline = performance.now() + SAMPLE_BUDGET_MS;
        let lastResult = null;
        while (samples.length < SAMPLE_LIMIT) {
            const started = performance.now();
            lastResult = await runOnce();
            samples.push(performance.now() - started);
            if (samples.length >= MIN_SAMPLES && performance.now() > deadline) break;
            await idle(0);
        }
        return {
            medianMs: round1(median(samples)),
            p90Ms: round1(percentile90(samples)),
            samples: samples.length,
            lastResult: lastResult,
        };
    };

    // 最貼近教室體感的一項：一邊重繪舞台、一邊持續辨識，看畫面掉不掉幀、主執
    // 行緒被卡多久（後者就是「偵測中打不了字」的量化版本）。
    //
    // inferOnce 傳 null 就只量空載幀率。rAF 的上限是螢幕更新率，所以單看負載
    // 下的 fps 沒辦法分辨「60Hz 面板本來就只有 60」與「144Hz 掉到 60」——一定
    // 要有空載基準線才讀得懂這個數字。
    const measureStage = async function (durationMs, inferOnce) {
        const stage = document.createElement('canvas');
        stage.width = 480; stage.height = 360;
        const ctx = stage.getContext('2d');
        let frames = 0, worstLagMs = 0, running = true;

        const drawFrame = function () {
            const phase = frames * 0.05;
            ctx.fillStyle = '#f0f4f8'; ctx.fillRect(0, 0, 480, 360);
            for (let sprite = 0; sprite < 24; sprite++) {
                const x = 240 + Math.cos(phase + sprite) * 180;
                const y = 180 + Math.sin(phase + sprite * 1.7) * 130;
                ctx.fillStyle = `hsl(${(sprite * 15) % 360},70%,60%)`;
                ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
            }
            ctx.fillStyle = '#333'; ctx.font = '16px sans-serif';
            ctx.fillText(`frame ${frames}`, 12, 24);
            frames++;
            if (running) requestAnimationFrame(drawFrame);
        };

        const lagTimer = setInterval(function () {
            const queuedAt = performance.now();
            setTimeout(function () {
                worstLagMs = Math.max(worstLagMs, performance.now() - queuedAt);
            }, 0);
        }, LAG_PROBE_INTERVAL_MS);

        const startedAt = performance.now();
        requestAnimationFrame(drawFrame);
        while (performance.now() - startedAt < durationMs) {
            if (inferOnce) await inferOnce();
            await idle(0);
        }
        running = false;
        clearInterval(lagTimer);
        const elapsedSeconds = (performance.now() - startedAt) / 1000;
        return { stageFps: round1(frames / elapsedSeconds), inputLagMs: Math.round(worstLagMs) };
    };

    const runBenchmark = async function (onProgress) {
        const report = function (step) { if (onProgress) onProgress(step); };
        const ml5Lib = window.ml5;
        if (!ml5Lib || !ml5Lib.tf) throw new Error('ml5 沒有載入成功，無法檢測。');
        if (!window.BenchmarkScene) throw new Error('benchmark-scene.js 沒有載入，無法產生測試畫面。');
        if (!window.BenchmarkDevice) throw new Error('benchmark-device.js 沒有載入，無法探查環境。');
        const tf = ml5Lib.tf;

        report('檢查繪圖環境');
        const environment = window.BenchmarkDevice.describeEnvironment();
        await tf.ready();
        const backend = tf.getBackend();
        const notes = [];

        const faceScene = window.BenchmarkScene.faceScene();
        const handScene = window.BenchmarkScene.handScene();
        const emptyScene = window.BenchmarkScene.emptyScene();
        const measurements = {
            backend: backend,
            deviceMemory: environment.deviceMemory,
            totalMemGb: environment.totalMemGb,
            hardwareConcurrency: environment.hardwareConcurrency,
            floatTextures: environment.floatTextures,
            devicePixelRatio: window.devicePixelRatio,
            mobilenetMs: null, facemeshMs: null, handposeMs: null,
            stageFps: null, inputLagMs: null, coldLoadMs: null,
            cpuSingleMs: null,
        };
        const detail = {
            environment: environment, notes: notes,
            p90: {}, samples: {}, loadMs: {}, detected: {},
        };

        // 放在 WebGL 重負載之前，掉到 cpu backend 的機器也量得到。
        report('量測 CPU 單核心速度');
        measurements.cpuSingleMs = timeCpuSingleCore();

        // 掉到 CPU 就不要再跑重負載了——一輪 handpose 可能要好幾分鐘，而結論
        // 已經確定：這台機器不該進教室。
        if (backend !== 'webgl') {
            notes.push(`TensorFlow 使用 ${backend} 運算，已跳過重負載測試以免長時間卡住。`);
            return { measurements: measurements, detail: detail };
        }

        report('載入 ML2Scratch 模型（MobileNet）');
        const mobilenet = await timeLoad(cb => ml5Lib.featureExtractor('MobileNet', cb));
        detail.loadMs.mobilenet = mobilenet.ms;

        report('量測 ML2Scratch 辨識速度');
        const inferMobilenet = async function () {
            const features = mobilenet.instance.infer(faceScene);
            await features.data();
            features.dispose();
            return true;
        };
        const mobilenetTiming = await timeInference(inferMobilenet);
        measurements.mobilenetMs = mobilenetTiming.medianMs;
        detail.p90.mobilenetMs = mobilenetTiming.p90Ms;
        detail.samples.mobilenetMs = mobilenetTiming.samples;

        // 空載基準線緊貼著並行測試量，不在開窗當下量——視窗剛開啟的前一兩秒有
        // 合成器與 GC 抖動，會把基準線壓到比負載時還低（HD 4400 那台量出空載
        // 32 fps、負載 60 fps 的倒掛就是這樣來的）。
        report('量測空載時的畫面流暢度');
        detail.baselineFps = (await measureStage(BASELINE_MS, null)).stageFps;

        report('辨識中同時重繪舞台（5 秒）');
        const concurrency = await measureStage(CONCURRENCY_MS, inferMobilenet);
        measurements.stageFps = concurrency.stageFps;
        measurements.inputLagMs = concurrency.inputLagMs;

        report('載入 Facemesh 臉部網格模型');
        try {
            const facemesh = await timeLoad(cb => ml5Lib.facemesh(cb));
            detail.loadMs.facemeshMs = facemesh.ms;
            report('量測 Facemesh 臉部網格速度');
            const timing = await timeInference(
                () => facemesh.instance.model.estimateFaces(faceScene, false));
            measurements.facemeshMs = timing.medianMs;
            detail.p90.facemeshMs = timing.p90Ms;
            detail.samples.facemeshMs = timing.samples;
            const found = Array.isArray(timing.lastResult) && timing.lastResult.length > 0;
            detail.detected.facemeshMs = found;
            if (!found) {
                notes.push('Facemesh 臉部網格：合成畫面沒有被判定為臉，管線因此每一幀都重跑偵測器。這條路徑比課堂上「追蹤到目標」的情況更慢，所以這個數字偏保守。');
            }
        } catch (error) {
            notes.push(`Facemesh 臉部網格 檢測失敗：${(error && error.message) || error}`);
        }

        report('載入 Handpose 手部姿勢模型');
        try {
            const handpose = await timeLoad(cb => ml5Lib.handpose(cb));
            detail.loadMs.handposeMs = handpose.ms;
            const estimateOn = scene => handpose.instance.model.estimateHands(scene, false);

            // 兩條路徑各自暖機、各自取樣。先量「找手」：畫面裡沒有手，每一幀重跑
            // 手掌偵測器——手離開鏡頭時走的就是這條，也是較慢的一條（1.4.2-b 之前
            // 收回的報告量到的都是它）。再量「追蹤」：手在畫面裡，只跑骨架。
            report('量測 Handpose：畫面中沒有手（找手）');
            const searching = await timeInference(() => estimateOn(emptyScene));
            report('量測 Handpose：追蹤到手之後');
            const tracking = await timeInference(() => estimateOn(handScene));

            const worse = searching.medianMs >= tracking.medianMs ? searching : tracking;
            measurements.handposeMs = worse.medianMs;
            detail.p90.handposeMs = worse.p90Ms;
            detail.samples.handposeMs = worse.samples;
            detail.handposePaths = { searchMs: searching.medianMs, trackedMs: tracking.medianMs };
            const found = Array.isArray(tracking.lastResult) && tracking.lastResult.length > 0;
            detail.detected.handposeMs = found;
            notes.push('Handpose 量了兩條路徑：畫面中沒有手時，每一幀都要重新找手（較慢，等級以這條為準）；追蹤到手之後只算骨架，快很多。兩個數字都列在表格裡。');
            if (!found) {
                notes.push('Handpose 手部姿勢：合成的手沒有被這台機器判定為手，「追蹤到手之後」那條量到的其實也是找手路徑。');
            }
        } catch (error) {
            notes.push(`Handpose 手部姿勢 檢測失敗：${(error && error.message) || error}`);
        }

        const loadTotal = [detail.loadMs.mobilenet, detail.loadMs.facemeshMs, detail.loadMs.handposeMs]
            .filter(ms => typeof ms === 'number');
        if (loadTotal.length === 3) {
            measurements.coldLoadMs = Math.round(loadTotal.reduce((a, b) => a + b, 0));
            if (measurements.coldLoadMs < WARM_CACHE_MS) {
                notes.push('模型載入非常快，代表檔案已在系統快取中。開機後第一次執行會比這個數字慢，屬正常現象。');
            }
        }
        report('完成');
        return { measurements: measurements, detail: detail };
    };

    return { runBenchmark: runBenchmark };
}));
