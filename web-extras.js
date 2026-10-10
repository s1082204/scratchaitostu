// Web-version extras (replaces the F1 / F2 handlers that lived in the Electron
// main process). Loaded as an external file so a page CSP cannot block it.
(function () {
    document.title = 'Scratch3 + AI 教育版';
    var open = function (p) { window.open(p, '_blank', 'noopener'); };
    window.addEventListener('keydown', function (e) {
        if (e.key === 'F1') { e.preventDefault(); open('credits.html'); }
        else if (e.key === 'F2') { e.preventDefault(); open('benchmark.html?v=1.5.2-beta-web'); }
    });
    // Small attribution link (CC BY-SA assets / AGPL extensions require in-app credits).
    var bar = document.createElement('div');
    bar.id = 'ai-edu-credits';
    bar.style.cssText = 'position:fixed;right:8px;bottom:4px;z-index:9999;font:11px/1.4 "PingFang TC","Microsoft JhengHei",sans-serif;' +
        'color:#575e75;background:rgba(255,255,255,.85);padding:2px 8px;border-radius:10px;pointer-events:auto;user-select:none';
    bar.innerHTML = 'Scratch3 + AI 教育版 1.5.2-beta · ' +
        '<a href="credits.html" target="_blank" rel="noopener" style="color:#4c97ff;text-decoration:none">授權與致謝</a> · ' +
        '<a href="benchmark.html?v=1.5.2-beta-web" target="_blank" rel="noopener" style="color:#4c97ff;text-decoration:none">效能檢測</a>';
    document.body.appendChild(bar);
})();
