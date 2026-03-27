/**
 * Smart Licensing Client
 * Handles communication with the Express/MongoDB backend.
 */
const License = {
    API_BASE: 'https://smart-silence-remover-production.up.railway.app/api/license',
    /** After a successful online verify, allow this long without blocking if verify is temporarily unreachable. */
    GRACE_MS: 3 * 24 * 60 * 60 * 1000,

    data: {
        key: '',
        token: '',
        expiresAt: null,
        lastCheck: null
    },

    _parseLastCheck(raw) {
        if (!raw) return null;
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
    },

    _isWithinGrace() {
        const last = this._parseLastCheck(this.data.lastCheck);
        if (!last) return false;
        return (Date.now() - last.getTime()) < this.GRACE_MS;
    },

    _isDefinitiveFailure(message, status) {
        const m = (message || '').toLowerCase();
        if (m.includes('machine id mismatch') || m.includes('machine mismatch')) return true;
        if (m.includes('license not found')) return true;
        if (m.includes('expired')) return true;
        if (m.includes('already activated') || m.includes('activation limit') || m.includes('seat')) return true;
        if (m.includes('revoked')) return true;
        if (m.includes('invalid token') || m.includes('invalid license') || m.includes('unauthorized')) return true;
        if (status === 401) return true;
        if (status === 403 && m.length > 0) return true;
        return false;
    },

    async init() {
        this.loadLocal();
        return this.validate();
    },

    loadLocal() {
        try {
            const stored = localStorage.getItem('ssr_license_data');
            if (stored) {
                this.data = JSON.parse(stored);
            }
        } catch (e) {
            console.error('Failed to load local license');
        }
    },

    saveLocal() {
        localStorage.setItem('ssr_license_data', JSON.stringify(this.data));
    },

    async activate(licenseKey) {
        const machineId = await Security.getMachineId();

        try {
            const response = await fetch(`${this.API_BASE}/activate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    licenseKey,
                    machineId,
                    machineName: 'Premiere Pro Machine'
                })
            });

            const text = await response.text();
            let result;
            try {
                result = text ? JSON.parse(text) : {};
            } catch (e) {
                return { success: false, error: 'Invalid response from licensing server.' };
            }

            if (result.success) {
                this.data.key = licenseKey;
                this.data.token = result.token;
                this.data.expiresAt = result.expiresAt;
                this.data.lastCheck = new Date().toISOString();
                this.saveLocal();
                return { success: true };
            }
            return { success: false, error: result.error || 'Activation failed' };
        } catch (e) {
            return { success: false, error: 'Could not connect to licensing server.' };
        }
    },

    async validate() {
        if (!this.data.token || !this.data.key) {
            return { success: false, code: 'no_session' };
        }

        if (this.data.expiresAt) {
            const exp = new Date(this.data.expiresAt);
            if (!isNaN(exp.getTime()) && Date.now() > exp.getTime()) {
                return {
                    success: false,
                    error: 'Your license is expired. Pay again and your license will be continued.',
                    code: 'expired_local'
                };
            }
        }

        const machineId = await Security.getMachineId();

        try {
            const response = await fetch(`${this.API_BASE}/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.data.token}`
                },
                body: JSON.stringify({ machineId })
            });

            const text = await response.text();
            let result = null;
            try {
                result = text ? JSON.parse(text) : null;
            } catch (e) {
                result = null;
            }

            if (result && result.success) {
                if (result.expiresAt) this.data.expiresAt = result.expiresAt;
                this.data.lastCheck = new Date().toISOString();
                this.saveLocal();
                return { success: true };
            }

            const msg = result && result.error ? String(result.error) : '';
            if (this._isDefinitiveFailure(msg, response.status)) {
                return {
                    success: false,
                    error: msg || 'License invalid or expired.',
                    code: 'server_reject'
                };
            }

            if (this._isWithinGrace()) {
                return { success: true, offline: true };
            }

            return {
                success: false,
                error: msg || 'Verification failed. Please try again.',
                code: 'verify_failed'
            };
        } catch (e) {
            if (this._isWithinGrace()) {
                return { success: true, offline: true };
            }
            return {
                success: false,
                error: 'Mandatory online check failed. Please check your internet.',
                code: 'network'
            };
        }
    }
};

window.License = License;
