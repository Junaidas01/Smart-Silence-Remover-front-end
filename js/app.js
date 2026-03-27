// ─── Constants & State ──────────────────────────────────────────────────
console.log('Smart Silence Remover: v1.0.5-FINAL-REPAIR (Loading...)');

// Helper to get Node.js modules at runtime (handles Bridge disconnects)
function getNodeModules() {
    try {
        var req = (typeof require !== 'undefined') ? require : (window.require ? window.require : null);
        if (!req && window.cep && window.cep.node) {
            req = window.cep.node.require;
        }
        if (req) {
            return { fs: req('fs'), cp: req('child_process') };
        }
    } catch (e) { console.error('Module discovery failed:', e); }
    return { fs: null, cp: null };
}

// ─── State ────────────────────────────────────────────────────────────────────
const App = {
    cs: null,
    sequenceInfo: null,
    silenceRanges: [],
    clips: [],
    isAnalyzing: false,
    isRemoving: false,
    ffmpegPath: null,   // resolved once
    placeholderAnimId: null,
    animOffset: 0
};

// ─── DOM References ───────────────────────────────────────────────────────────
const DOM = {};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    cacheDom();
    App.cs = new csInterface();

    // Initialize Licensing
    await initLicensing();

    bindEvents();
    loadSequenceInfo();
    renderWaveformPlaceholder();

    // Start background polling to keep info "dynamic"
    setInterval(() => loadSequenceInfo(true), 3000);

    window.addEventListener('resize', handleResize);
});

async function initLicensing() {
    // 1. Keep loader visible, keep form hidden (default)
    const result = await License.init();
    
    if (result.success) {
        showPanel(true);
    } else {
        // 2. Verification failed (no key found or server error)
        
        // If it's a Machine ID mismatch or the database record was deleted
        // Clear local storage so the user can re-activate fresh
        if (result.error && (result.error.includes('Machine ID mismatch') || result.error.includes('License not found'))) {
            console.warn('License or Machine mismatch. Resetting local state.');
            localStorage.removeItem('ssr_license_data');
            License.data = { key: '', token: '', expiresAt: null, lastCheck: null };
        }

        showPanel(false);
        DOM.licenseLoaderGroup.style.display = 'none';
        DOM.licenseSetupGroup.style.display = 'block';

        if (License.data.key) {
            // We have a key but it's invalid/expired (and not a mismatch we just cleared)
            DOM.licenseStatus.style.display = 'block';
            DOM.licenseStatus.textContent = '⚠ ' + (result.error || 'Verification failed');
            DOM.licenseStatus.className = 'status-msg error';
        }
    }

    // Start the 30-minute heartbeat
    setInterval(checkLicenseHeartbeat, 30 * 60 * 1000);
}

async function checkLicenseHeartbeat() {
    console.log('Running 30-minute license heartbeat...');
    const result = await License.validate();
    if (!result.success) {
        showPanel(false);
        setStatus('⚠ License session expired or connection lost.', 'error');
        DOM.licenseStatus.textContent = result.error || 'Session expired. Please re-activate.';
    }
}

function showPanel(visible) {
    if (visible) {
        DOM.licenseOverlay.classList.add('hidden');
        DOM.panel.classList.add('visible');
    } else {
        DOM.licenseOverlay.classList.remove('hidden');
        DOM.panel.classList.remove('visible');
    }
}

function handleResize() {
    if (App.silenceRanges && App.silenceRanges.length > 0) {
        // Redraw actual waveform
        renderWaveform(App.clips, App.silenceRanges);
    } else if (!App.isAnalyzing) {
        // Redraw placeholder if not currently analyzing (analysis has its own redraw loop)
        renderWaveformPlaceholder();
    }
}



function cacheDom() {
    DOM.seqName = document.getElementById('seq-name');
    DOM.seqDuration = document.getElementById('seq-duration');
    DOM.seqStatus = document.getElementById('seq-status');
    DOM.thresholdVal = document.getElementById('threshold-val');
    DOM.thresholdSlider = document.getElementById('threshold-slider');
    DOM.minSilenceVal = document.getElementById('min-silence-val');
    DOM.minSilenceSlider = document.getElementById('min-silence-slider');
    DOM.paddingVal = document.getElementById('padding-val');
    DOM.paddingSlider = document.getElementById('padding-slider');
    DOM.btnAnalyze = document.getElementById('btn-analyze');
    DOM.btnRemove = document.getElementById('btn-remove');
    DOM.btnUndo = document.getElementById('btn-undo');
    DOM.btnRefresh = document.getElementById('btn-refresh');
    DOM.canvas = document.getElementById('waveform-canvas');
    DOM.ctx = DOM.canvas ? DOM.canvas.getContext('2d') : null;
    DOM.silenceList = document.getElementById('silence-list');
    DOM.silenceCount = document.getElementById('silence-count');
    DOM.timeSaved = document.getElementById('time-saved');
    DOM.progressBar = document.getElementById('progress-bar');
    DOM.progressWrap = document.getElementById('progress-wrap');
    DOM.statusMsg = document.getElementById('status-msg');
    DOM.emptyState = document.getElementById('empty-state');

    DOM.seqStatus = document.getElementById('seq-status');
    DOM.panel = document.querySelector('.panel');

    // Licensing UI
    DOM.licenseOverlay = document.getElementById('license-overlay');
    DOM.licenseInput = document.getElementById('license-input');
    DOM.btnActivate = document.getElementById('btn-activate');
    DOM.licenseStatus = document.getElementById('license-status');
    DOM.licenseSetupGroup = document.getElementById('license-setup-group');
    DOM.licenseLoaderGroup = document.getElementById('license-loader-group');
}






// ─── Bind Events ─────────────────────────────────────────────────────────────
function bindEvents() {
    DOM.thresholdSlider.addEventListener('input', () => {
        DOM.thresholdVal.textContent = DOM.thresholdSlider.value + ' dB';
    });
    DOM.minSilenceSlider.addEventListener('input', () => {
        DOM.minSilenceVal.textContent = DOM.minSilenceSlider.value + ' ms';
    });
    DOM.paddingSlider.addEventListener('input', () => {
        DOM.paddingVal.textContent = DOM.paddingSlider.value + ' ms';
    });
    DOM.btnAnalyze.addEventListener('click', runAnalysis);
    DOM.btnRemove.addEventListener('click', applyDeletions);
    DOM.btnUndo.addEventListener('click', undoRipples);
    DOM.btnRefresh.addEventListener('click', loadSequenceInfo);
    DOM.btnActivate.addEventListener('click', handleActivation);

    // Generic handler for any other external links

    document.addEventListener('click', (e) => {
        if (e.target.tagName === 'A' && e.target.getAttribute('target') === '_blank') {
            e.preventDefault();
            App.cs.openURLInDefaultBrowser(e.target.getAttribute('href'));
        }
    });
}


// ─── Load Sequence Info (Dynamic Polling) ────────────────────────────────────
function loadSequenceInfo(isSilent = false) {
    // Don't poll while we are already busy
    if (App.isAnalyzing || App.isRemoving) return;

    if (!isSilent) {
        DOM.btnAnalyze.disabled = true;
        setStatus('Connecting to Premiere Pro…', 'loading');
    }

    App.cs.evalScript('getSequenceInfo()', (result) => {
        if (!result || result === 'EvalScript Err.' || result.trim() === '') {
            if (!isSilent) {
                setStatus('⚠ No sequence open. Please open a project.', 'error');
                setSequenceDisplay(null);
            }
            return;
        }

        let info;
        try {
            info = JSON.parse(result);
        } catch (e) {
            if (!isSilent) setStatus('⚠ Could not read info.', 'error');
            return;
        }

        if (info.error) {
            if (!isSilent) {
                setStatus('⚠ ' + info.error, 'error');
                setSequenceDisplay(null);
            }
            return;
        }

        // Only update if something actually changed to avoid UI flickering
        const hasChanged = !App.sequenceInfo ||
            App.sequenceInfo.name !== info.name ||
            App.sequenceInfo.duration !== info.duration;

        App.sequenceInfo = info;
        setSequenceDisplay(info);

        if (!isSilent || hasChanged) {
            setStatus('Ready to analyze.', 'ready');
            DOM.btnAnalyze.disabled = false;
        }
    });
}

function setSequenceDisplay(info) {
    if (!info) {
        DOM.seqName.textContent = 'No sequence open';
        DOM.seqDuration.textContent = '—';
        DOM.seqStatus.className = 'seq-status error';
        DOM.seqStatus.textContent = 'Not connected';
        return;
    }
    DOM.seqName.textContent = info.name || 'Untitled';
    DOM.seqDuration.textContent = formatTime(info.duration);
    DOM.seqStatus.className = 'seq-status ok';
    DOM.seqStatus.textContent = 'Connected';
}


// ─── Run Analysis ─────────────────────────────────────────────────────────────

async function runAnalysis() {
    if (App.isAnalyzing) return;

    // Strict License Check
    const isOk = await License.validate();
    if (!isOk.success) {
        showPanel(false);
        return;
    }
    
    // Stop idle animation
    if (App.placeholderAnimId) {
        cancelAnimationFrame(App.placeholderAnimId);
        App.placeholderAnimId = null;
    }


    if (!App.sequenceInfo) {
        setStatus('⚠ No sequence open. Open a sequence in Premiere Pro, then click ↻', 'error');
        return;
    }

    App.isAnalyzing = true;
    App.silenceRanges = [];
    DOM.btnAnalyze.disabled = true;
    DOM.btnRemove.disabled = true;
    showProgress(true);

    try {
        // Step 1: Locate ffmpeg
        setStatus('Looking for ffmpeg on your system…', 'loading');
        updateProgress(5);
        const ffmpeg = await findFfmpeg();

        if (!ffmpeg) {
            setStatus('⚠ ffmpeg not found. Install ffmpeg and add it to your PATH, then try again.', 'error');
            resetAnalysis();
            return;
        }
        App.ffmpegPath = ffmpeg;

        // Step 2: Get source clip paths from Premiere
        setStatus('Reading clip list from Premiere…', 'loading');
        updateProgress(15);
        const clipData = await evalScriptAsync('getSourceClipPaths()');
        const parsed = JSON.parse(clipData);

        if (parsed.error) {
            setStatus('⚠ ' + parsed.error, 'error');
            resetAnalysis();
            return;
        }

        const clips = parsed.clips;
        const settings = getSettings();
        const allRanges = [];

        // Step 3: Run ffmpeg silencedetect per unique source file
        const uniquePaths = [...new Set(clips.map(c => c.path))];
        const progressPer = 70 / uniquePaths.length;

        for (let i = 0; i < uniquePaths.length; i++) {
            const srcPath = uniquePaths[i];
            setStatus(`Analyzing audio: ${srcPath.split(/[\\/]/).pop()}…`, 'loading');
            updateProgress(20 + i * progressPer);

            // Run ffmpeg silencedetect on this source file
            const rawSilences = await runFfmpegSilenceDetect(
                ffmpeg, srcPath,
                settings.thresholdDb,
                settings.minSilenceMs / 1000
            );

            // Map source-relative silences to sequence time for every clip using this file
            const clipsForFile = clips.filter(c => c.path === srcPath);
            for (const clip of clipsForFile) {
                for (const silence of rawSilences) {
                    // silence.start / silence.end are source-file timestamps
                    // Clip contributes sequence time [seqStartSec..seqEndSec]
                    // from source [srcInSec..srcOutSec]
                    const seqSilStart = clip.seqStartSec + (silence.start - clip.srcInSec);
                    const seqSilEnd = clip.seqStartSec + (silence.end - clip.srcInSec);

                    // Clamp to the clip's visible range in the sequence
                    const clampedStart = Math.max(seqSilStart, clip.seqStartSec);
                    const clampedEnd = Math.min(seqSilEnd, clip.seqEndSec);

                    if (clampedEnd - clampedStart >= settings.minSilenceMs / 1000) {
                        // Apply padding
                        const padded = applyPadding(clampedStart, clampedEnd, settings.paddingMs / 1000);
                        allRanges.push(padded);
                    }
                }
            }
        }

        // Step 4: Merge overlapping ranges, sort by start
        const merged = mergeRanges(allRanges);
        merged.forEach((r, i) => { r.id = 'sr_' + i; r.keep = false; });

        updateProgress(95);
        App.silenceRanges = merged;
        App.clips = clips; // PERSIST CLIPS FOR RESIZING
        await delay(200);
        updateProgress(100);

        renderWaveform(clips, merged);
        renderSilenceList(merged);

        const totalSaved = merged.reduce((s, r) => s + r.duration, 0);
        if (DOM.silenceCount) {
            DOM.silenceCount.textContent = merged.length + ' silence zone' + (merged.length !== 1 ? 's' : '') + ' found';
        }
        if (DOM.timeSaved) {
            DOM.timeSaved.textContent = 'Est. ' + formatTime(totalSaved) + ' saved';
        }

        if (merged.length > 0) {
            setStatus('Analysis complete! Review zones below, then click Remove Silences.', 'ready');
            DOM.btnRemove.disabled = false;
        } else {
            setStatus('No silences detected. Try increasing the threshold (e.g. -30 dB).', 'warn');
        }

    } catch (err) {
        setStatus('⚠ Analysis error: ' + err.message, 'error');
    } finally {
        await delay(400);
        showProgress(false);
        DOM.btnAnalyze.disabled = false;
        App.isAnalyzing = false;
    }
}

// ─── Find ffmpeg ──────────────────────────────────────────────────────────────────────
function findFfmpeg() {
    return new Promise(resolve => {
        console.log('[DEBUG] findFfmpeg: Starting discovery...');
        
        const modules = getNodeModules();
        const _fs = modules.fs;
        const _cp = modules.cp;

        if (!_cp || !_fs) { 
            const msg = `CRITICAL ERROR: Node.js environment is still disabled in Premiere Pro. (fs:${!!_fs}, cp:${!!_cp}). Try restarting Premiere Pro fully.`;
            console.error('[DEBUG] findFfmpeg:', msg);
            alert(msg);
            resolve(null); 
            return; 
        }

        // 1. Resolve Extension Path
        let extPath = '';
        try {
            extPath = App.cs.getSystemPath(SystemPath.EXTENSION);
        } catch (err) {
            console.error('[DEBUG] findFfmpeg: Failed to get extension path.');
            resolve(null);
            return;
        }
        
        // Normalize
        if (extPath.indexOf('file://') === 0) extPath = extPath.replace('file://', '');
        if (extPath.charAt(0) === '/' && extPath.charAt(2) === ':') extPath = extPath.substring(1);
        extPath = extPath.replace(/\\/g, '/');

        const isWin = navigator.platform.toLowerCase().indexOf('win') > -1;
        
        // Candiates for bundled binary
        const bundledCandidates = isWin ? [
            extPath + '/bin/win/ffmpeg.exe',
            extPath + '/bin/ffmpeg.exe',
            extPath.replace('SmartSilenceRemover', 'com.smartsilenceremover.panel') + '/bin/win/ffmpeg.exe'
        ] : [
            extPath + '/bin/mac/ffmpeg',
            extPath + '/bin/ffmpeg'
        ];

        for (const bundledPath of bundledCandidates) {
            const osPath = isWin ? bundledPath.replace(/\//g, '\\') : bundledPath;
            try {
                if (_fs.existsSync(osPath)) {
                    _cp.execSync(`"${osPath}" -version`, { stdio: 'pipe', timeout: 2000 });
                    console.log('[DEBUG] Bundled FFmpeg found:', osPath);
                    resolve(osPath);
                    return;
                }
            } catch (e) {}
        }

        // 2. System Fallback
        const systemCandidates = isWin ? [
            'ffmpeg', 'C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'
        ] : [
            'ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'
        ];

        for (const candidate of systemCandidates) {
            try {
                _cp.execSync(`"${candidate}" -version`, { stdio: 'pipe', timeout: 2000 });
                console.log('[DEBUG] System FFmpeg found:', candidate);
                resolve(candidate);
                return;
            } catch (e) {}
        }

        alert('FFmpeg binary could not be located. Please ensure the extension folder contains the "bin" directory.');
        resolve(null);
    });
}

// ─── Apply Deletions (Async Non-Blocking) ──────────────────────────────────
async function applyDeletions() {
    if (App.isRemoving) return;

    // Strict License Check
    const isOk = await License.validate();
    if (!isOk.success) {
        showPanel(false);
        return;
    }


    const toDelete = App.silenceRanges.filter(r => !r.keep);

    if (toDelete.length === 0) {
        setStatus('No zones selected for deletion.', 'warn');
        return;
    }

    const confirmed = confirm(
        `Remove ${toDelete.length} silence zone(s) from your timeline?\n\n` +
        `This will ripple-delete ${formatTime(toDelete.reduce((s, r) => s + r.duration, 0))} of audio.\n\n` +
        `Premiere will remain responsive during this process.`
    );
    if (!confirmed) return;

    App.isRemoving = true;
    DOM.btnRemove.disabled = true;
    DOM.btnAnalyze.disabled = true;
    showProgress(true);

    try {
        setStatus('Preparing timeline…', 'loading');
        const prepResult = await evalScriptAsync('prepareForDeletion()');
        const prep = JSON.parse(prepResult);
        if (prep.error) throw new Error(prep.error);

        // Sort in reverse order (End -> Start) so deletions don't shift upcoming timecodes
        const sorted = [...toDelete].sort((a, b) => b.start - a.start);

        for (let i = 0; i < sorted.length; i++) {
            const range = sorted[i];
            const pct = Math.round(((i + 1) / sorted.length) * 100);

            setStatus(`Removing zone ${i + 1} of ${sorted.length}…`, 'loading');
            updateProgress(pct);

            const delResult = await evalScriptAsync(`deleteSingleRange(${range.start}, ${range.end})`);
            const del = JSON.parse(delResult);
            if (del.error) {
                console.error(`Zone ${i} failed:`, del.error);
            }

            // Small delay to allow Premiere UI to breathe and update progress bar
            await delay(10);
        }

        await evalScriptAsync('finalizeDeletion()');

        setStatus(`✅ Done! Successfully processed ${sorted.length} silence zones.`, 'ready');

        // Clear the list after successful removal
        App.silenceRanges = [];
        renderSilenceList([]);
        renderWaveformPlaceholder();
        DOM.silenceCount.textContent = 'Run analysis again to reload';
        DOM.timeSaved.textContent = '';
        DOM.btnUndo.disabled = false;

    } catch (e) {
        setStatus('Unexpected error: ' + e.message, 'error');
    } finally {
        setTimeout(() => showProgress(false), 600);
        DOM.btnAnalyze.disabled = false;
        App.isRemoving = false;
    }
}

// ─── Undo ─────────────────────────────────────────────────────────────────────
function undoRipples() {
    App.cs.evalScript('undoLastOperation()', () => {
        setStatus('Undo sent to Premiere. Use Ctrl+Z in Premiere for more.', 'ready');
    });
}

// ─── Silence List UI ─────────────────────────────────────────────────────────
function renderSilenceList(ranges) {
    DOM.silenceList.innerHTML = '';

    if (!ranges || ranges.length === 0) {
        DOM.emptyState.style.display = 'flex';
        return;
    }
    DOM.emptyState.style.display = 'none';

    ranges.forEach((range, idx) => {
        const item = document.createElement('div');
        item.className = 'silence-item' + (range.keep ? ' kept' : '');
        item.dataset.id = range.id;

        item.innerHTML = `
          <div class="si-left">
            <div class="si-index">${idx + 1}</div>
            <div class="si-times">
              <span class="si-start">${formatTime(range.start)}</span>
              <span class="si-arrow">→</span>
              <span class="si-end">${formatTime(range.end)}</span>
            </div>
            <div class="si-duration">${formatTime(range.duration)}</div>
          </div>
          <div class="si-right">
            <label class="toggle-wrap" title="${range.keep ? 'Click to delete' : 'Click to keep'}">
              <input type="checkbox" class="si-keep-chk" ${range.keep ? 'checked' : ''} data-idx="${idx}" />
              <span class="toggle-slider"></span>
              <span class="toggle-label">${range.keep ? 'Keep' : 'Delete'}</span>
            </label>
          </div>
        `;

        item.querySelector('.si-keep-chk').addEventListener('change', (e) => {
            App.silenceRanges[idx].keep = e.target.checked;
            item.classList.toggle('kept', e.target.checked);
            item.querySelector('.toggle-label').textContent = e.target.checked ? 'Keep' : 'Delete';
            updateTotals();
        });

        DOM.silenceList.appendChild(item);
    });

    updateTotals();
}

function updateTotals() {
    const toDelete = App.silenceRanges.filter(r => !r.keep);
    const totalSaved = toDelete.reduce((s, r) => s + r.duration, 0);
    DOM.silenceCount.textContent = toDelete.length + ' zone' + (toDelete.length !== 1 ? 's' : '') + ' selected for removal';
    DOM.timeSaved.textContent = 'Will save ' + formatTime(totalSaved);
    DOM.btnRemove.disabled = toDelete.length === 0;
}

// ─── Waveform Canvas ─────────────────────────────────────────────────────────
function renderWaveformPlaceholder() {
    if (!DOM.ctx) return;
    const c = DOM.canvas;
    const ctx = DOM.ctx;
    
    // Ensure canvas dimensions match client size
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
    }

    ctx.clearRect(0, 0, W, H);

    // Dark background
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, W, H);

    // Draw wavy placeholder (animated)
    App.animOffset += 0.05;
    ctx.strokeStyle = '#1a4d2e'; // Dark green
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    
    for (let x = 0; x < W; x++) {
        const amp = Math.sin(x * 0.02 + App.animOffset) * 12 + Math.sin(x * 0.05 - App.animOffset * 0.5) * 4;
        ctx.lineTo(x, H / 2 + amp);
    }
    ctx.stroke();

    // Center line
    ctx.strokeStyle = 'rgba(99, 235, 140, 0.1)'; // Success green with alpha
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();

    // Placeholder text
    ctx.fillStyle = '#4a5068';
    ctx.font = '600 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SCANNING TIMELINE...', W / 2, H / 2);

    if (!App.isAnalyzing && App.silenceRanges.length === 0) {
        if (App.placeholderAnimId) cancelAnimationFrame(App.placeholderAnimId);
        App.placeholderAnimId = requestAnimationFrame(renderWaveformPlaceholder);
    }
}

function renderWaveform(clips, silences) {
    if (!DOM.ctx || !App.sequenceInfo) return;
    const c = DOM.canvas;
    const ctx = DOM.ctx;
    const dur = App.sequenceInfo.duration || 100;

    // Stop idle animation if running
    if (App.placeholderAnimId) {
        cancelAnimationFrame(App.placeholderAnimId);
        App.placeholderAnimId = null;
    }

    const W = c.clientWidth;
    const H = c.clientHeight;
    c.width = W;
    c.height = H;

    ctx.clearRect(0, 0, W, H);

    // 1. Draw solid background colors (Dark Forest Green / Vibrant Red)
    ctx.fillStyle = '#0a2912'; // Deep forest green
    ctx.fillRect(0, 0, W, H);

    if (silences && silences.length > 0) {
        silences.forEach(s => {
            if (s.keep) return;
            const rx = (s.start / dur) * W;
            const rw = Math.max(((s.end - s.start) / dur) * W, 1);
            if (!Number.isFinite(rx) || !Number.isFinite(rw) || rw <= 0) return;

            ctx.fillStyle = '#9b0a13'; // Vibrant dark red
            ctx.fillRect(rx, 0, rw, H);
        });
    }

    // 2. Draw Top Ruler (Tick marks with horizontal baseline)
    const tickCount = 20;
    const tickStep = W / tickCount;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;

    // Baseline for ruler
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.lineTo(W, 1);
    ctx.stroke();

    for (let i = 0; i <= tickCount; i++) {
        const tx = i * tickStep;
        const th = i % 5 === 0 ? 8 : 4;
        ctx.beginPath();
        ctx.moveTo(tx, 1);
        ctx.lineTo(tx, 1 + th);
        ctx.stroke();
    }

    if (!clips || clips.length === 0) return;

    // 3. Draw premium rounded waveform bars
    const barWidth = 3;
    const gap = 1;
    const step = barWidth + gap;
    
    // Gradient for the bars (Premium Green)
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#63eb8c');
    grad.addColorStop(1, '#34d399');

    for (let x = 0; x < W; x += step) {
        const currentSec = (x / W) * dur;

        let inClip = false;
        for (const clip of clips) {
            if (currentSec >= clip.seqStartSec && currentSec <= clip.seqEndSec) {
                inClip = true; break;
            }
        }
        if (!inClip) continue;

        let isRemoved = false;
        if (silences) {
            for (const s of silences) {
                if (!s.keep && currentSec >= s.start && currentSec <= s.end) {
                    isRemoved = true; break;
                }
            }
        }

        const noise = Math.abs(Math.sin(currentSec * 25) * Math.cos(currentSec * 7) + Math.sin(currentSec * 41) * 0.5);
        const jitter = Math.random() * 0.2;
        let amplitude = ((noise * 0.75) + 0.1 + jitter) * (H * 0.8);

        const h = 5 + (Math.abs(Math.sin(x * 0.1)) * (H * 0.7));
        const y = (H - h) / 2;
        
        if (isRemoved) {
            ctx.fillStyle = '#ff5f5f'; // Danger red
            drawRoundedRect(ctx, x, y, barWidth, 3, 1.5); // Draw a small line for removed sections
        } else {
            ctx.fillStyle = grad;
            drawRoundedRect(ctx, x, y, barWidth, h, 2);
        }
    }
}

// Helper to draw rounded rectangles on canvas
function drawRoundedRect(ctx, x, y, width, height, radius) {
    if (height < radius * 2) radius = height / 2;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height); // No rounding at bottom baseline
    ctx.lineTo(x, y + height);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getSettings() {
    return {
        thresholdDb: parseInt(DOM.thresholdSlider.value, 10),
        minSilenceMs: parseInt(DOM.minSilenceSlider.value, 10),
        paddingMs: parseInt(DOM.paddingSlider.value, 10),
    };
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds === null) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
}

function setStatus(msg, type) {
    DOM.statusMsg.textContent = msg;
    DOM.statusMsg.className = 'status-msg ' + (type || '');
}

function showProgress(show) {
    DOM.progressWrap.style.display = show ? 'block' : 'none';
    if (!show) updateProgress(0);
}

function updateProgress(pct) {
    DOM.progressBar.style.width = pct + '%';
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function resetAnalysis() {
    showProgress(false);
    DOM.btnAnalyze.disabled = false;
    App.isAnalyzing = false;
}

// ─── Run ffmpeg Silence Detection ─────────────────────────────────────────────────────
function runFfmpegSilenceDetect(ffmpegPath, filePath, thresholdDb, minSilenceSec) {
    return new Promise((resolve, reject) => {
        const { cp } = getNodeModules();
        if (!cp) { resolve([]); return; }

        // ffmpeg silencedetect writes to stderr
        const cmd = `"${ffmpegPath}" -i "${filePath}" -af "silencedetect=noise=${thresholdDb}dB:d=${minSilenceSec}" -vn -f null -`;
        cp.exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
            // ffmpeg returns non-zero on null output, check stderr for actual data
            const output = (stderr || '') + (stdout || '');
            resolve(parseFfmpegSilenceOutput(output));
        });
    });
}

// ─── Parse ffmpeg Silence Output ───────────────────────────────────────────────────────
function parseFfmpegSilenceOutput(output) {
    const silences = [];
    const lines = output.split('\n');
    let pendingStart = null;

    for (const line of lines) {
        const startM = line.match(/silence_start:\s*([\d.]+)/);
        const endM = line.match(/silence_end:\s*([\d.]+)/);

        if (startM) {
            pendingStart = parseFloat(startM[1]);
        }
        if (endM && pendingStart !== null) {
            const end = parseFloat(endM[1]);
            silences.push({ start: pendingStart, end });
            pendingStart = null;
        }
    }
    // If file ends in silence (no silence_end line for the last silence_start)
    if (pendingStart !== null) {
        silences.push({ start: pendingStart, end: pendingStart + 9999 }); // clamp later
    }
    return silences;
}

// ─── Apply Padding to a silence range ───────────────────────────────────────────────────
function applyPadding(start, end, paddingSec) {
    const s = parseFloat((start + paddingSec).toFixed(3));
    const e = parseFloat((end - paddingSec).toFixed(3));
    const dur = parseFloat((e - s).toFixed(3));
    return { start: s, end: e, duration: dur };
}

// ─── Merge Overlapping Silence Ranges ───────────────────────────────────────────────────
function mergeRanges(ranges) {
    if (!ranges.length) return [];
    ranges.sort((a, b) => a.start - b.start);
    const merged = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
        const prev = merged[merged.length - 1];
        const curr = ranges[i];
        if (curr.start <= prev.end) {
            prev.end = Math.max(prev.end, curr.end);
            prev.duration = parseFloat((prev.end - prev.start).toFixed(3));
        } else {
            merged.push(curr);
        }
    }
    return merged.filter(r => r.duration > 0);
}

function evalScriptAsync(script) {
    return new Promise((resolve, reject) => {
        App.cs.evalScript(script, result => {
            if (!result || result === 'EvalScript Err.') {
                reject(new Error('ExtendScript error for: ' + script));
            } else {
                resolve(result);
            }
        });
    });
}

async function handleActivation() {
    const key = DOM.licenseInput.value.trim();
    if (!key) return;

    DOM.btnActivate.disabled = true;
    setStatus('Activating...', 'loading');
    DOM.licenseStatus.style.display = 'block';
    DOM.licenseStatus.textContent = 'Contacting server...';
    DOM.licenseStatus.className = 'status-msg loading';

    const result = await License.activate(key);
    if (result.success) {
        DOM.licenseStatus.textContent = 'Success! Machine activated.';
        DOM.licenseStatus.className = 'status-msg ready';
        setStatus('Ready', 'ready');
        
        setTimeout(() => {
            showPanel(true);
        }, 1000);
    } else {
        DOM.licenseStatus.textContent = 'Error: ' + result.error;
        DOM.licenseStatus.className = 'status-msg error';
        setStatus('Activation failed', 'error');
        DOM.btnActivate.disabled = false;
    }
}
