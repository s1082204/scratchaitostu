/*
 * benchmark-device.js — 探查這台機器本身：繪圖環境與攝影機。
 * 只讀裝置資訊，不做效能量測（那是 benchmark-probe.js 的事），也不判分。
 */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.BenchmarkDevice = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const idle = function (ms) {
        return new Promise(resolve => setTimeout(resolve, ms || 0));
    };

    const describeEnvironment = function () {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        const info = {
            hardwareConcurrency: navigator.hardwareConcurrency || null,
            deviceMemory: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null,
            totalMemGb: typeof window.__totalMemGb === 'number' ? window.__totalMemGb : null,
            screen: `${screen.width}x${screen.height} @${window.devicePixelRatio}x`,
            userAgent: navigator.userAgent,
            webglVersion: null, renderer: null, vendor: null,
            maxTextureSize: null, floatTextures: null,
            jsHeapLimitMb: null,
        };
        if (gl) {
            info.webglVersion = (typeof WebGL2RenderingContext !== 'undefined' &&
                gl instanceof WebGL2RenderingContext) ? 'WebGL 2' : 'WebGL 1';
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                info.renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                info.vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
            }
            info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            info.floatTextures = !!(gl.getExtension('EXT_color_buffer_float') ||
                gl.getExtension('OES_texture_float'));
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
        }
        if (window.performance && performance.memory) {
            info.jsHeapLimitMb = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
        }
        return info;
    };

    const probeCamera = async function () {
        const started = performance.now();
        let stream = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            const video = document.createElement('video');
            video.muted = true; video.playsInline = true; video.srcObject = stream;
            await video.play();
            const deadline = performance.now() + 8000;
            while (!(video.videoWidth > 0) && performance.now() < deadline) await idle(80);
            const settings = stream.getVideoTracks()[0].getSettings();
            return {
                ok: video.videoWidth > 0,
                width: settings.width || video.videoWidth,
                height: settings.height || video.videoHeight,
                frameRate: settings.frameRate ? Math.round(settings.frameRate) : null,
                firstFrameMs: Math.round(performance.now() - started),
                label: stream.getVideoTracks()[0].label || '(未提供名稱)',
                error: null,
            };
        } catch (error) {
            return { ok: false, error: (error && error.name) || String(error) };
        } finally {
            if (stream) stream.getTracks().forEach(track => track.stop());
        }
    };

    return { describeEnvironment: describeEnvironment, probeCamera: probeCamera };
}));
