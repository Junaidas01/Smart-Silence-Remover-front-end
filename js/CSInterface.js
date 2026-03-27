/**
 * CSInterface.js — Adobe CEP JavaScript Library v11.1.0
 * Provides communication between the HTML panel and the host application (Premiere Pro).
 * Simplified version for Smart Silence Remover.
 */

'use strict';

var csInterface = (function () {

    // ─── Constants ────────────────────────────────────────────────────────────
    var THEME_COLOR_CHANGED_EVENT  = "com.adobe.csxs.events.ThemeColorChanged";
    var OS_WIN = "WIN";
    var OS_MAC = "MAC";
 
    /**
     * SystemPath Enum
     */
    window.SystemPath = {
        USER_DATA: "userData",
        COMMON_FILES: "commonFiles",
        MY_DOCUMENTS: "myDocuments",
        APPLICATION: "application",
        EXTENSION: "extension",
        HOST_APPLICATION: "hostApplication"
    };

    // ─── CSInterface Constructor ──────────────────────────────────────────────
    function CSInterface() {
        this.hostEnvironment = window.__adobe_cep__ ?
            JSON.parse(window.__adobe_cep__.getHostEnvironment()) : null;
    }

    // ─── evalScript ──────────────────────────────────────────────────────────
    // Evaluate ExtendScript in the host application
    CSInterface.prototype.evalScript = function (script, callback) {
        if (!window.__adobe_cep__) {
            // Running in browser (dev mode) — stub response
            if (callback) {
                callback('{"error":"Running outside Premiere Pro"}');
            }
            return;
        }
        if (callback === null || callback === undefined) {
            callback = function (result) {};
        }
        window.__adobe_cep__.evalScript(script, callback);
    };

    // ─── getSystemPath ────────────────────────────────────────────────────────
    CSInterface.prototype.getSystemPath = function (pathType) {
        if (!window.__adobe_cep__) return "";
        var path = window.__adobe_cep__.getSystemPath(pathType);
        return path;
    };

    // ─── addEventListener ─────────────────────────────────────────────────────
    CSInterface.prototype.addEventListener = function (type, listener, obj) {
        if (!window.__adobe_cep__) return;
        window.__adobe_cep__.addEventListener(type, listener, obj);
    };

    // ─── dispatchEvent ────────────────────────────────────────────────────────
    CSInterface.prototype.dispatchEvent = function (event) {
        if (!window.__adobe_cep__) return;
        if (typeof event.data === "object") {
            event.data = JSON.stringify(event.data);
        }
        window.__adobe_cep__.dispatchEvent(event);
    };

    // ─── getHostEnvironment ───────────────────────────────────────────────────
    CSInterface.prototype.getHostEnvironment = function () {
        if (!window.__adobe_cep__) return {};
        return JSON.parse(window.__adobe_cep__.getHostEnvironment());
    };

    // ─── getOSInformation ─────────────────────────────────────────────────────
    CSInterface.prototype.getOSInformation = function () {
        var hostEnv = this.getHostEnvironment();
        return hostEnv.os || navigator.platform;
    };

    // ─── openURLInDefaultBrowser ──────────────────────────────────────────────
    CSInterface.prototype.openURLInDefaultBrowser = function (url) {
        if (window.__adobe_cep__) {
            window.__adobe_cep__.openURLInDefaultBrowser(url);
        } else {
            window.open(url, "_blank");
        }
    };

    // ─── Theme Helper ─────────────────────────────────────────────────────────
    CSInterface.prototype.getApplicationThemeColor = function () {
        if (!window.__adobe_cep__) return null;
        var hostEnv = this.getHostEnvironment();
        return hostEnv.appSkinInfo || null;
    };

    return CSInterface;
})();

// Export for use as module or global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = csInterface;
}
