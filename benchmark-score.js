/*
 * benchmark-score.js — 把量測值換算成「可用性等級」與「效能指數」。
 *
 * 這一層刻意不碰 DOM、tfjs、檔案系統，所以能同時被 benchmark.html 與
 * test/benchmark-score.test.js 載入。要改量測方式請改 benchmark-probe.js。
 *
 * 為什麼是兩個數字？因為一個數字答不了兩個問題。第一版用加權平均算單一分數，
 * 實測把同一台機器降速後發現：慢 4 倍分數仍是 100、慢 10 倍仍是「A 級 順暢」，
 * 到 20 倍才崩掉。原因是加權平均會稀釋單項失敗，而且多數項目在能用的機器上都
 * 早已觸頂。所以拆成：
 *
 *   等級 A/B/C/D —「這台能不能上課」。絕對判準，取最弱的一環，不做平均。
 *   效能指數 0–100 —「這台比別台快多少」。對數尺度，用來排序整間電腦教室。
 *
 * 門檻集中在下面的 BANDS 與 INDEX 兩張表，校準時只改數字，邏輯不必動。門檻仍是
 * 工程推估，尚未在低階內顯機器上校準過。
 */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.BenchmarkScore = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // higherIsBetter 的欄位（stageFps）門檻是遞減的，其餘都是「越小越好」的毫秒數。
    const BANDS = {
        mobilenetMs: {
            label: 'ML2Scratch 影像辨識', unit: 'ms/次',
            smooth: 35, usable: 80, marginal: 160, higherIsBetter: false,
        },
        facemeshMs: {
            label: 'Facemesh 臉部網格', unit: 'ms/次',
            smooth: 50, usable: 110, marginal: 200, higherIsBetter: false,
        },
        // smooth 原為 70，2026-08-12 依十一份實地報告放寬到 100：630 世代內顯的
        // 找手路徑落在 50~95ms 且第一輪偏慢（冷 shader），70 正好切在抖動帶中間，
        // 同一台機器兩輪會 B/A 跨級；而這個區間的機器實際上課 handpose 都順。
        handposeMs: {
            label: 'Handpose 手部姿勢', unit: 'ms/次',
            smooth: 100, usable: 150, marginal: 280, higherIsBetter: false,
        },
        stageFps: {
            label: '辨識中的舞台流暢度', unit: 'fps',
            smooth: 50, usable: 35, marginal: 22, higherIsBetter: true,
        },
        // 固定運算量（6 千萬次整數迴圈）的耗時。Scratch 的介面、積木編輯、VM 全
        // 吃單執行緒：推論在內顯上跑得動、但單核很慢的低功耗機（實地案例：8 核
        // 1.1GHz 拿到 B 級卻頓到不能用）只有這一項抓得到。門檻錨點：本機高階桌機
        // 143ms；短時測到的是睿頻峰值、非持續時脈，門檻偏嚴一點，待真機校準。
        cpuSingleMs: {
            label: 'CPU 單核心速度', unit: 'ms',
            smooth: 320, usable: 550, marginal: 900, higherIsBetter: false,
        },
        inputLagMs: {
            label: '辨識中的輸入回應', unit: 'ms',
            smooth: 80, usable: 200, marginal: 500, higherIsBetter: false,
        },
        coldLoadMs: {
            label: '三個模型載入時間', unit: 'ms',
            smooth: 6000, usable: 15000, marginal: 30000, higherIsBetter: false,
        },
    };

    const DISPLAY_ORDER = [
        'mobilenetMs', 'facemeshMs', 'handposeMs',
        'stageFps', 'cpuSingleMs', 'inputLagMs', 'coldLoadMs',
    ];

    // 決定等級的項目：三個模組 + 舞台。載入時間不列入（第二次執行讀的是系統快取，
    // 量到的數字沒有意義），輸入回應只當作否決條件（見 VETO_KEYS）。
    const TIER_KEYS = ['mobilenetMs', 'facemeshMs', 'handposeMs', 'stageFps'];

    // 這兩項只要「不建議」就直接判 D：ML2Scratch 是所有課程的基礎，輸入回應爛掉
    // 等於學生根本不能操作。其他模組壞掉最多降到 C，因為課還是能改著上。
    const VETO_KEYS = ['mobilenetMs', 'inputLagMs'];

    // CPU 單核心是「上限」不是「最弱一環」：快不加分，慢到勉強以下就把等級壓到
    // 最高 C——模組本身還跑得動（推論在內顯上），但整個介面操作會頓，不能宣稱
    // 可用。不參與 VETO（再慢也不至於 D，課還能挑著上）。
    const CAP_KEY = 'cpuSingleMs';
    const CAP_TIER = 'C';

    const MODULE_KEYS = ['mobilenetMs', 'facemeshMs', 'handposeMs'];

    // 效能指數：三個模型單次推論時間的總和，取對數。用對數是因為機器之間的差距
    // 是倍數關係而不是加減關係——RTX4090 與舊內顯差一個數量級，線性尺度會把中間
    // 那一段全部擠在一起。referenceMs 是絕對參考值，不是「某台參考機器」，換機
    // 器不會讓歷史分數失效。
    // referenceMs = 高階獨立顯卡跑完三個模型各一次的量級（實測 RTX4090 約 24ms）。
    // decadeDrop = 每慢十倍扣幾分。實測降速對照：1x→100、4x→68、10x→37、20x→17。
    const INDEX = { referenceMs: 30, decadeDrop: 58 };

    // range＝該等級的效能指數區間。等級決定區間、指數在區間內表示同級機器的
    // 快慢，所以「A 級＝85 分以上」這種規格門檻永遠成立（競賽硬體規格需要
    // 等級與分數互相對應；2026-08-27 起的報告採此制，與更早的指數不可直接比）。
    const TIERS = {
        A: { label: '順暢', range: [85, 100], meaning: '三個 AI 模組都能正常上課，可以在同一個專案裡同時使用。' },
        B: { label: '可用', range: [70, 84], meaning: '三個模組都跑得動，其中有模組反應偏慢；建議一次只開一個模組。' },
        C: { label: '勉強', range: [50, 69], meaning: '有模組跑不順或跑不動；請依「建議說明」挑能用的模組上課。' },
        D: { label: '不建議', range: [0, 49], meaning: '不建議用這台上 AI 課。先確認顯示驅動有沒有裝，再判斷是否換機。' },
    };

    // 原始速度指數（0–100，對數尺度）換算到等級區間內的位置。
    const bandedIndex = function (tier, rawIndex) {
        if (rawIndex === null || rawIndex === undefined) return null;
        const range = TIERS[tier].range;
        return Math.round(range[0] + rawIndex * (range[1] - range[0]) / 100);
    };

    const ADVICE = {
        A: [
            '三個 AI 模組都可以正常上課，也可以在同一個專案裡同時使用。',
            '訓練樣本可以拉到每個類別 15～20 張，辨識反應仍然跟得上。',
        ],
        B: [
            '建議一次只開一個 AI 模組，換模組時按 Ctrl+R 重新整理再開。',
            '訓練樣本每個類別控制在 10 張左右。',
        ],
        C: [
            '以 ML2Scratch 為主；上方表格中評語為「不建議」的模組，請不要在課堂上使用。',
            '務必一次只開一個 AI 模組，並把舞台切到小視窗降低繪圖負擔。',
            '上課前先關掉瀏覽器與其他程式，讓出記憶體。',
        ],
        D: [
            '不建議用這台電腦上 AI 課程。',
            '第一件事是檢查顯示驅動：裝置管理員裡若顯示「Microsoft 基本顯示介面卡」，請安裝原廠內顯驅動後重測，通常會大幅改善。',
            '若驅動正常仍是這個結果，代表硬體確實不足，建議換機或改用教師機示範。',
        ],
    };

    const VERDICT_RANK = { '順暢': 0, '可用': 1, '勉強': 2, '不建議': 3 };
    const RANK_TIER = ['A', 'B', 'C', 'C'];

    // 這幾項不是模組，但會決定「課堂上怎麼操作」，所以量到勉強以下就給提醒。
    const CAUTIONS = [
        { key: 'inputLagMs', text: '辨識進行中打字或修改積木會明顯延遲，請先按紅色停止鍵再編輯程式。' },
        { key: 'stageFps', text: '辨識時舞台會掉格，建議把舞台切成小視窗以降低繪圖負擔。' },
        { key: 'coldLoadMs', text: '模型載入偏慢，上課前請先開好程式並按一次綠旗預熱，不要讓學生在課堂上等。' },
        { key: 'cpuSingleMs', text: 'CPU 單核心速度很慢，介面、積木編輯與畫面切換都會明顯頓；上課請關閉其他程式，並考慮調低螢幕解析度與縮放。' },
    ];

    // 評語看的是原始量測值，不是分數——37ms 只比 35ms 慢一點，說成「可用」比說成
    // 「99 分」誠實。
    const verdictOf = function (value, band) {
        if (typeof value !== 'number' || !isFinite(value)) return '未測';
        if (band.higherIsBetter) {
            if (value >= band.smooth) return '順暢';
            if (value >= band.usable) return '可用';
            if (value >= band.marginal) return '勉強';
            return '不建議';
        }
        if (value <= band.smooth) return '順暢';
        if (value <= band.usable) return '可用';
        if (value <= band.marginal) return '勉強';
        return '不建議';
    };

    const performanceIndex = function (totalMs) {
        if (typeof totalMs !== 'number' || !isFinite(totalMs) || totalMs <= 0) return null;
        const decades = Math.log10(totalMs / INDEX.referenceMs);
        return Math.max(0, Math.min(100, Math.round(100 - INDEX.decadeDrop * decades)));
    };

    const tierFor = function (parts, backend) {
        const byKey = {};
        parts.forEach(function (part) { byKey[part.key] = part; });

        if (backend !== 'webgl') {
            return { tier: 'D', reason: '沒有可用的 WebGL，TensorFlow 只能用 CPU 運算。' };
        }
        const vetoed = VETO_KEYS
            .map(key => byKey[key])
            .filter(part => part && part.verdict === '不建議');
        if (vetoed.length) {
            return {
                tier: 'D',
                reason: `「${vetoed.map(p => p.label).join('、')}」已經不堪使用，這是課程的基礎。`,
            };
        }
        const measured = TIER_KEYS.map(key => byKey[key]).filter(part => part && part.verdict !== '未測');
        if (!measured.length) return { tier: 'D', reason: '沒有量到任何數據。' };

        // 取最弱的一環，不做平均——一個模組跑不動，那堂課就是上不了，不會因為
        // 其他項目漂亮而變得能上。
        const worst = measured.reduce(function (a, b) {
            return VERDICT_RANK[b.verdict] > VERDICT_RANK[a.verdict] ? b : a;
        });
        const tier = RANK_TIER[VERDICT_RANK[worst.verdict]];
        const reason = tier === 'A'
            ? '每一項都落在順暢範圍內。'
            : `等級取決於最弱的一項：「${worst.label}」${worst.value}${worst.unit}（${worst.verdict}）。`;

        const cpu = byKey[CAP_KEY];
        if (cpu && VERDICT_RANK[cpu.verdict] >= VERDICT_RANK['勉強'] && tier < CAP_TIER) {
            return {
                tier: CAP_TIER,
                reason: `CPU 單核心速度太慢（${cpu.value}${cpu.unit}），模組雖然跑得動，` +
                    'Scratch 介面與積木操作會明顯頓，等級以此設上限。',
            };
        }
        return { tier: tier, reason: reason };
    };

    // 等級的罐頭建議說不出「這台機器到底能開哪些模組」——那要看每個模組自己的
    // 評語。這裡就是把逐項量測結果翻譯成一句老師看得懂的話。
    const teachingPlan = function (parts) {
        const byKey = {};
        parts.forEach(function (part) { byKey[part.key] = part; });

        const usable = [], limited = [], avoid = [], untested = [];
        MODULE_KEYS.forEach(function (key) {
            const part = byKey[key];
            if (!part) return;
            if (part.verdict === '未測') untested.push(part.label);
            else if (part.verdict === '不建議') avoid.push(part.label);
            else if (part.verdict === '勉強') limited.push(part.label);
            else usable.push(part.label);
        });

        const cautions = CAUTIONS.filter(function (rule) {
            const part = byKey[rule.key];
            return part && VERDICT_RANK[part.verdict] >= VERDICT_RANK['勉強'];
        }).map(function (rule) { return rule.text; });

        const clauses = [];
        if (usable.length === MODULE_KEYS.length) {
            clauses.push('這台電腦三個 AI 模組都可以正常上課。');
        } else {
            if (usable.length) clauses.push(`可以使用：${usable.join('、')}。`);
            if (limited.length) clauses.push(`勉強可用，建議單獨開啟並降低使用頻率：${limited.join('、')}。`);
            if (avoid.length) clauses.push(`不要使用：${avoid.join('、')}。`);
            if (untested.length) clauses.push(`未檢測：${untested.join('、')}。`);
        }
        const measured = usable.length + limited.length + avoid.length;
        return {
            usable: usable, limited: limited, avoid: avoid, untested: untested,
            cautions: cautions,
            summary: measured ? clauses.join('') : '沒有量到模組數據，無法給使用建議。',
        };
    };

    const redFlagsIn = function (measurements) {
        const flags = [];
        if (measurements.backend && measurements.backend !== 'webgl') {
            flags.push('TensorFlow 掉到 CPU 運算：沒有可用的 WebGL。多半是顯示驅動沒裝（裝置管理員顯示「Microsoft 基本顯示介面卡」），請先安裝原廠內顯驅動再重測。');
        }
        if (measurements.floatTextures === false) {
            flags.push('內顯不支援浮點材質，TensorFlow 只能走降級路徑，辨識會明顯變慢。');
        }
        // totalMemGb 是主程序實測的真實容量（瀏覽器端的 deviceMemory 最多只回報
        // 到 8）。競賽規格建議 16 GB；一般課堂 8 GB 尚可。
        if (typeof measurements.totalMemGb === 'number' && measurements.totalMemGb < 16) {
            flags.push(`記憶體實測約 ${measurements.totalMemGb} GB，低於競賽建議的 16 GB（一般課堂 8 GB 尚可）。`);
        } else if (typeof measurements.totalMemGb !== 'number' &&
            typeof measurements.deviceMemory === 'number' && measurements.deviceMemory < 8) {
            flags.push(`記憶體約 ${measurements.deviceMemory} GB，低於建議的 8 GB。上課前請關閉瀏覽器與其他程式。`);
        }
        if (typeof measurements.hardwareConcurrency === 'number' && measurements.hardwareConcurrency < 4) {
            flags.push(`CPU 只有 ${measurements.hardwareConcurrency} 個執行緒，模型載入與畫面繪製會互相搶資源。`);
        }
        // 實地案例：4K 面板開 300% 縮放配內顯，介面要畫的像素是一般 1080p 螢幕的
        // 好幾倍。這是建議不是評分——把 Windows 顯示縮放或解析度調低就會立刻改善。
        // 只在單核不順暢的機器上提醒，跑得動的機器不需要被唸。
        const cpuStrained = typeof measurements.cpuSingleMs === 'number' &&
            verdictOf(measurements.cpuSingleMs, BANDS.cpuSingleMs) !== '順暢';
        if (cpuStrained &&
            typeof measurements.devicePixelRatio === 'number' && measurements.devicePixelRatio >= 2) {
            flags.push(`螢幕縮放為 ${Math.round(measurements.devicePixelRatio * 100)}%，介面繪圖負擔是一般螢幕的數倍。` +
                '若操作會頓，請到 Windows 顯示設定把「縮放」調低（例如 125%）或降低解析度再試。');
        }
        return flags;
    };

    const gradeMachine = function (measurements) {
        const input = measurements || {};
        const parts = DISPLAY_ORDER.map(function (key) {
            const band = BANDS[key];
            const verdict = verdictOf(input[key], band);
            return {
                key: key,
                label: band.label,
                unit: band.unit,
                value: verdict === '未測' ? null : input[key],
                verdict: verdict,
                inTier: TIER_KEYS.indexOf(key) >= 0,
            };
        });

        const decided = tierFor(parts, input.backend);
        const inferenceTotal = MODULE_KEYS.reduce(function (sum, key) {
            return sum === null || typeof input[key] !== 'number' ? null : sum + input[key];
        }, 0);

        return {
            tier: decided.tier,
            tierLabel: TIERS[decided.tier].label,
            tierMeaning: TIERS[decided.tier].meaning,
            tierReason: decided.reason,
            index: input.backend === 'webgl'
                ? bandedIndex(decided.tier, performanceIndex(inferenceTotal)) : null,
            parts: parts,
            plan: teachingPlan(parts),
            advice: ADVICE[decided.tier].slice(),
            redFlags: redFlagsIn(input),
        };
    };

    return {
        gradeMachine: gradeMachine,
        verdictOf: verdictOf,
        performanceIndex: performanceIndex,
        bandedIndex: bandedIndex,
        tierFor: tierFor,
        teachingPlan: teachingPlan,
        BANDS: BANDS,
        TIERS: TIERS,
        INDEX: INDEX,
    };
}));
