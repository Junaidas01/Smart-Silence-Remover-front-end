/**
 * Security Utils - Machine ID Fingerprinting
 */
const Security = {
    _cachedId: null,
    _MACHINE_ID_KEY: 'ssr_machine_id',

    async getMachineId() {
        if (this._cachedId) return this._cachedId;
        try {
            const persisted = localStorage.getItem(this._MACHINE_ID_KEY);
            if (persisted && persisted.length >= 8) {
                this._cachedId = persisted;
                return this._cachedId;
            }
        } catch (e) { /* ignore */ }

        return new Promise((resolve) => {
            const isWin = navigator.platform.toUpperCase().indexOf('WIN') > -1;
            // Use window.CEP_NODE (from bridge) or getNodeModules() (from app.js)
            let node = window.CEP_NODE || {};
            if (!node.cp && typeof getNodeModules === 'function') {
                const m = getNodeModules();
                node = { cp: m.cp, os: m.os || null, fs: m.fs || null };
            }
            if (!node.os) {
                try {
                    const req = (typeof require !== 'undefined') ? require : (window.cep && window.cep.node && window.cep.node.require);
                    if (req) node.os = req('os');
                } catch (e) { /* ignore */ }
            }
            
            try {
                // 1. WINDOWS: Try Registry (Best)
                if (node.cp && isWin) {
                    node.cp.exec('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { timeout: 2000 }, (err, stdout) => {
                        if (!err && stdout) {
                            const match = stdout.toString().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
                            if (match) return this._processResult(match[0], resolve);
                        }
                        // Never use a random GUID here — it would change every launch and break licensing.
                        this._tryOsLevelFingerprint(node.os, resolve);
                    });
                } else if (node.cp) {
                    // MAC: ioreg
                    node.cp.exec('ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID', { timeout: 3000 }, (err, stdout) => {
                        if (err || !stdout) return this._tryOsLevelFingerprint(node.os, resolve);
                        this._processResult(stdout, resolve);
                    });
                } else {
                    this._tryOsLevelFingerprint(node.os, resolve);
                }
            } catch (e) {
                this._tryOsLevelFingerprint(node.os, resolve);
            }
        });
    },

    _tryOsLevelFingerprint(os, resolve) {
        if (!os) return resolve(this._finishWithFallback('Node context missing'));

        try {
            const interfaces = os.networkInterfaces();
            const macs = [];
            for (let name in interfaces) {
                for (let iface of interfaces[name]) {
                    if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
                        macs.push(iface.mac);
                    }
                }
            }
            
            // Combine MACs + CPU + Hostname for a "Soft Hardware ID"
            const rawId = [
                os.hostname(),
                os.arch(),
                os.cpus().length,
                macs.sort().join('|')
            ].join('-');

            if (rawId.length > 10) {
                this._processResult(rawId, resolve);
            } else {
                resolve(this._finishWithFallback('OS Data Insufficient'));
            }
        } catch (e) {
            resolve(this._finishWithFallback('OS Error: ' + e.message));
        }
    },

    _processResult(stdout, resolve) {
        let id = stdout.toString()
            .replace(/UUID/g, '')
            .replace(/IOPlatformUUID/g, '')
            .replace(/[={}"\r\n\t]/g, '')
            .trim();

        if (!id || id.length < 5) {
            resolve(this._finishWithFallback('Empty or Invalid ID Cleaned'));
        } else {
            console.log('Secure Machine ID Generated:', id);
            this._cachedId = id;
            try { localStorage.setItem(this._MACHINE_ID_KEY, id); } catch (e) { /* ignore */ }
            resolve(id);
        }
    },

    _finishWithFallback(reason) {
        // Try to get or create a persistent "Installation ID" to avoid collisions
        let installId = localStorage.getItem('ssr_permanent_id');
        if (!installId) {
            // Generate a unique-ish ID based on time and random bits
            installId = 'PX-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);
            localStorage.setItem('ssr_permanent_id', installId);
        }

        const fallback = `F-${installId}-${navigator.hardwareConcurrency}-${screen.width}x${screen.height}`;
        console.warn(`Machine ID Fallback (${reason}): Using ${fallback}`);
        this._cachedId = fallback;
        try { localStorage.setItem(this._MACHINE_ID_KEY, fallback); } catch (e) { /* ignore */ }
        return fallback;
    }
};

window.Security = Security;

// ─── Runtime Self-Defense ──────────────────────────────────────────────────
// In Adobe CEP, outer/inner width heuristics and debugger traps falsely wipe valid licenses.
(function selfDefense() {
    var inCep = typeof window !== 'undefined' && !!(window.__adobe_cep__ || window.cep);
    if (inCep) return;

    setInterval(function() {
        var threshold = 160;
        if (
            (window.outerWidth - window.innerWidth > threshold) ||
            (window.outerHeight - window.innerHeight > threshold)
        ) {
            localStorage.removeItem('ssr_license_data');
            localStorage.removeItem('ssr_machine_id');
            location.reload();
        }
    }, 1000);

    (function antiDebug() {
        var t = Date.now();
        debugger;
        if (Date.now() - t > 100) {
            localStorage.removeItem('ssr_license_data');
            localStorage.removeItem('ssr_machine_id');
            location.reload();
        }
        setTimeout(antiDebug, 3000);
    })();
})();
