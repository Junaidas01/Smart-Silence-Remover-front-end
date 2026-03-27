/**
 * Smart Licensing Client
 * Handles communication with the Express/MongoDB backend.
 */
const License = {
    // API CONFIG - Change to your production URL later
    API_BASE: 'https://smart-silence-remover-production.up.railway.app/api/license',
    
    data: {
        key: '',
        token: '',
        expiresAt: null,
        lastCheck: null
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

            const result = await response.json();
            
            if (result.success) {
                this.data.key = licenseKey;
                this.data.token = result.token;
                this.data.expiresAt = result.expiresAt;
                this.data.lastCheck = new Date();
                this.saveLocal();
                return { success: true };
            } else {
                return { success: false, error: result.error || 'Activation failed' };
            }
        } catch (e) {
            return { success: false, error: 'Could not connect to licensing server.' };
        }
    },

    async validate() {
        if (!this.data.token || !this.data.key) return { success: false };

        // Client-side strict date check
        if (this.data.expiresAt && new Date() > new Date(this.data.expiresAt)) {
            return { success: false, error: 'Your license is expired. Pay again and your license will be continued.' };
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

            const result = await response.json();
            if (result.success) {
                if (result.expiresAt) this.data.expiresAt = result.expiresAt;
                this.data.lastCheck = new Date();
                this.saveLocal();
                return { success: true };
            } else {
                // If token is invalid or license expired
                return { success: false, error: result.error };
            }
        } catch (e) {
            // If server is down, we follow "Direct connection required" rule
            return { success: false, error: 'Mandatory online check failed. Please check your internet.' };
        }
    }
};

window.License = License;
