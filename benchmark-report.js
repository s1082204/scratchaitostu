/*
 * benchmark-report.js — 把評分結果變成畫面上的成績單，以及可以回傳的純文字。
 * 只碰 DOM 與剪貼簿，不做任何量測，也不判分。
 */
(function (root, factory) {
    'use strict';
    root.BenchmarkReport = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const VERDICT_CLASS = {
        '順暢': 'good', '可用': 'ok', '勉強': 'warn', '不建議': 'bad', '未測': 'skip',
    };

    const TIER_ORDER = ['A', 'B', 'C', 'D'];

    // 哪些列決定等級、哪些只是參考，要寫在表格上，否則老師會以為每一列都算分。
    const ROLE_NOTE = {
        cpuSingleMs: '很慢時等級最高 C',
        inputLagMs: '僅在「不建議」時影響等級',
        coldLoadMs: '僅供參考，不影響等級',
    };

    const escapeHtml = function (value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };

    const pad2 = function (value) { return String(value).padStart(2, '0'); };

    const stamp = function () {
        const now = new Date();
        return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ` +
            `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    };

    const fileStamp = function () {
        const now = new Date();
        return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
            `-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
    };

    const formatValue = function (part) {
        if (part.value === null) return '—';
        if (part.key === 'coldLoadMs') return `${(part.value / 1000).toFixed(1)} 秒`;
        return `${part.value} ${part.unit}`;
    };

    // rAF 的上限是螢幕更新率，所以負載下的 fps 一定要跟空載基準線一起看。
    // handpose 量了找手與追蹤兩條路徑，兩個數字都要見人，量測值欄位放的是較差的那條。
    const partDetailText = function (part, detail) {
        const role = ROLE_NOTE[part.key];
        let text;
        if (part.key === 'stageFps' && detail.baselineFps) {
            text = `空載時 ${detail.baselineFps} fps`;
        } else if (part.key === 'handposeMs' && detail.handposePaths) {
            const paths = detail.handposePaths;
            const p90 = detail.p90[part.key];
            text = `找手 ${paths.searchMs}・追蹤到手後 ${paths.trackedMs} ms` +
                (p90 ? `・p90 ${p90}` : '');
        } else {
            const p90 = detail.p90[part.key];
            text = p90 ? `p90 ${p90}・${detail.samples[part.key]} 次` : '';
        }
        return role ? (text ? `${text}・${role}` : role) : text;
    };

    // 有主程序實測值就顯示真實容量；否則退回瀏覽器的量化值（上限 8——
    // 32GB 的機器也只會回報 8）。
    const memoryText = function (environment) {
        if (typeof environment.totalMemGb === 'number') return `${environment.totalMemGb} GB（實測）`;
        if (!environment.deviceMemory) return '—';
        return environment.deviceMemory >= 8
            ? '8 GB 以上（瀏覽器只回報到 8）' : `約 ${environment.deviceMemory} GB`;
    };

    const environmentRows = function (environment) {
        return [
            ['繪圖晶片', environment.renderer || '(讀不到，可能是驅動未安裝)'],
            ['繪圖介面', environment.webglVersion || '無可用的 WebGL'],
            ['浮點材質', environment.floatTextures === null ? '—' : (environment.floatTextures ? '支援' : '不支援')],
            ['CPU 執行緒', environment.hardwareConcurrency || '—'],
            ['記憶體', memoryText(environment)],
            ['JS 記憶體上限', environment.jsHeapLimitMb ? `${environment.jsHeapLimitMb} MB` : '—'],
            ['螢幕', environment.screen],
        ];
    };

    const indexText = function (index) {
        return index === null || index === undefined ? '—' : String(index);
    };

    const renderLegend = function (container, tiers, currentTier) {
        const rows = TIER_ORDER.map(function (key) {
            const active = key === currentTier ? ' class="active"' : '';
            const range = tiers[key].range;
            return `<tr${active}>
                <td class="tier-cell tier-${key}">${key}</td>
                <td class="num">${range[0]}–${range[1]} 分</td>
                <td>${escapeHtml(tiers[key].label)}</td>
                <td>${escapeHtml(tiers[key].meaning)}</td>
            </tr>`;
        }).join('');
        container.innerHTML = `<table class="legend"><thead><tr>
                <th>等級</th><th>效能指數</th><th>評語</th><th>代表什麼</th>
            </tr></thead><tbody>${rows}</tbody></table>
            <p class="dim"><b>等級</b>取「最弱的一環」，不做平均——一個模組跑不動，那堂課就是上不了，
            不會因為其他項目漂亮而變得能上。ML2Scratch 或「辨識中的輸入回應」被判「不建議」，
            或是沒有可用的 WebGL（多半是顯示驅動未安裝），一律直接判 D；
            CPU 單核心速度太慢時，模組雖跑得動但介面會頓，等級最高 C。<br>
            <b>效能指數</b>一律落在該等級的分數區間內：等級決定區間，
            區間內的高低代表同等級機器之間的快慢，所以「A 級＝85 分以上」恆成立，
            可直接當硬體規格門檻使用。</p>`;
    };

    const tierCardHtml = function (grade) {
        return `<div class="card tier-${grade.tier}">
            <div class="card-block">
                <div class="tier-letter">${grade.tier}</div>
                <div class="card-caption">可用性・${escapeHtml(grade.tierLabel)}</div>
            </div>
            <div class="card-block">
                <div class="index-value">${indexText(grade.index)}</div>
                <div class="card-caption">效能指數</div>
            </div>
            <div class="card-meaning">${escapeHtml(grade.tierMeaning)}</div>
        </div>
        <p class="tier-reason">${escapeHtml(grade.tierReason)}</p>`;
    };

    const planHtml = function (plan) {
        const cautions = plan.cautions.length
            ? `<ul class="notes">${plan.cautions.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`
            : '';
        return `<h2>建議說明</h2><p class="plan-summary">${escapeHtml(plan.summary)}</p>${cautions}`;
    };

    const partsTableHtml = function (grade, detail) {
        const rows = grade.parts.map(function (part) {
            return `<tr>
                <td>${escapeHtml(part.label)}</td>
                <td class="num">${escapeHtml(formatValue(part))}</td>
                <td><span class="pill ${VERDICT_CLASS[part.verdict]}">${escapeHtml(part.verdict)}</span></td>
                <td class="dim">${escapeHtml(partDetailText(part, detail))}</td>
            </tr>`;
        }).join('');
        return `<table><thead><tr>
            <th>項目</th><th>量測值</th><th>評語</th><th>細節</th>
        </tr></thead><tbody>${rows}</tbody></table>`;
    };

    const listHtml = function (title, items, className) {
        if (!items || !items.length) return '';
        const body = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
        return `<h2>${escapeHtml(title)}</h2><ul class="${className || ''}">${body}</ul>`;
    };

    const environmentHtml = function (environment) {
        const rows = environmentRows(environment).map(function (row) {
            return `<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td></tr>`;
        }).join('');
        return `<h2>硬體環境</h2><table class="env"><tbody>${rows}</tbody></table>`;
    };

    // 開鏡頭要好幾秒的機器（實測過 18.5 秒的），老師若不知情會以為程式當掉。
    const CAMERA_SLOW_MS = 5000;

    const cameraSlowText = function (camera) {
        if (!camera || !camera.ok || !(camera.firstFrameMs > CAMERA_SLOW_MS)) return '';
        return `這台攝影機從開啟到出現畫面要 ${(camera.firstFrameMs / 1000).toFixed(1)} 秒：` +
            '上課前請先開好鏡頭，按綠旗後畫面黑一段時間屬正常現象，請學生耐心等。';
    };

    const cameraHtml = function (camera) {
        if (!camera) return '';
        const slow = cameraSlowText(camera);
        const body = camera.ok
            ? `可用：${escapeHtml(camera.width)}x${escapeHtml(camera.height)} @${escapeHtml(camera.frameRate || '?')}fps，
               首張影格 ${escapeHtml(camera.firstFrameMs)} ms<br><span class="dim">${escapeHtml(camera.label)}</span>` +
              (slow ? `<br><span class="pill warn">開啟很慢</span> ${escapeHtml(slow)}` : '')
            : `<span class="pill bad">無法使用</span> ${escapeHtml(camera.error)}`;
        return `<h2>攝影機</h2><p>${body}</p>`;
    };

    const render = function (container, grade, detail, meta) {
        container.innerHTML = [
            tierCardHtml(grade),
            planHtml(grade.plan),
            '<h2>量測結果</h2>',
            partsTableHtml(grade, detail),
            listHtml('需要注意', grade.redFlags, 'flags'),
            listHtml('量測說明', detail.notes, 'notes'),
            listHtml('上課建議', grade.advice),
            environmentHtml(detail.environment),
            cameraHtml(meta.camera),
        ].join('');
    };

    const asPlainText = function (grade, detail, meta) {
        const lines = [];
        lines.push('Scratch3 + AI 教育版　效能檢測報告');
        lines.push(`版本：${meta.version}　　時間：${stamp()}`);
        lines.push('='.repeat(46));
        lines.push(`可用性：${grade.tier} 級（${grade.tierLabel}）`);
        lines.push(`效能指數：${indexText(grade.index)} / 100`);
        lines.push(`　${grade.tierReason}`);
        lines.push('');
        lines.push('【建議說明】');
        lines.push(`  ${grade.plan.summary}`);
        grade.plan.cautions.forEach(text => lines.push(`  - ${text}`));
        if (meta.tiers) {
            lines.push('');
            lines.push('【等級說明】等級取最弱的一環，不做平均；效能指數固定落在等級的分數區間內');
            TIER_ORDER.forEach(function (key) {
                const range = meta.tiers[key].range;
                const mark = key === grade.tier ? '　←這台' : '';
                lines.push(`  ${key}  ${range[0]}–${range[1]} 分　${meta.tiers[key].label}：${meta.tiers[key].meaning}${mark}`);
            });
        }
        lines.push('');
        lines.push('【量測結果】');
        grade.parts.forEach(function (part) {
            const extra = partDetailText(part, detail);
            lines.push(`  ${part.label}：${formatValue(part)}　${part.verdict}` +
                (extra ? `　（${extra}）` : ''));
        });
        if (grade.redFlags.length) {
            lines.push('');
            lines.push('【需要注意】');
            grade.redFlags.forEach(flag => lines.push(`  ! ${flag}`));
        }
        if (detail.notes.length) {
            lines.push('');
            lines.push('【量測說明】');
            detail.notes.forEach(note => lines.push(`  - ${note}`));
        }
        lines.push('');
        lines.push('【上課建議】');
        grade.advice.forEach(item => lines.push(`  - ${item}`));
        lines.push('');
        lines.push('【硬體環境】');
        environmentRows(detail.environment).forEach(function (row) {
            lines.push(`  ${row[0]}：${row[1]}`);
        });
        if (meta.camera) {
            lines.push('');
            lines.push('【攝影機】');
            lines.push(meta.camera.ok
                ? `  可用：${meta.camera.width}x${meta.camera.height} @${meta.camera.frameRate || '?'}fps　` +
                  `首張影格 ${meta.camera.firstFrameMs} ms　${meta.camera.label}`
                : `  無法使用：${meta.camera.error}`);
            const slow = cameraSlowText(meta.camera);
            if (slow) lines.push(`  ! ${slow}`);
        }
        lines.push('');
        lines.push(`裝置識別：${detail.environment.userAgent}`);
        return lines.join('\n');
    };

    const copyToClipboard = function (text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve) {
            const area = document.createElement('textarea');
            area.value = text;
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            document.body.removeChild(area);
            resolve();
        });
    };

    const downloadText = function (text) {
        const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `AI效能檢測_${fileStamp()}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    };

    return {
        render: render,
        renderLegend: renderLegend,
        asPlainText: asPlainText,
        copyToClipboard: copyToClipboard,
        downloadText: downloadText,
    };
}));
