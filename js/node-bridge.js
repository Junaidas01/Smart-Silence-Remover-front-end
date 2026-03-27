/**
 * Node.js Bridge for Adobe CEP
 * Safely exposes Node.js modules to the global window object.
 */
(function () {
    console.log('CEP Node.js Bridge: Execution started.');
    // alert('DEBUG: Bridge Script Executing'); // Enable if needed for deep debug

    window.CEP_NODE = {
        fs: null,
        cp: null,
        os: null,
        active: false
    };

    try {
        var req = (typeof require !== 'undefined') ? require : (window.require ? window.require : null);
        
        if (!req && window.cep && window.cep.node) {
            req = window.cep.node.require;
            console.log('Bridge: Found window.cep.node.require');
        }

        if (req) {
            window.CEP_NODE.fs = req('fs');
            window.CEP_NODE.cp = req('child_process');
            window.CEP_NODE.os = req('os');
            window.CEP_NODE.active = (!!window.CEP_NODE.fs && !!window.CEP_NODE.cp);
            console.log('CEP Node.js Bridge: SUCCESS. Active:', window.CEP_NODE.active);
        } else {
            console.warn('CEP Node.js Bridge: require not found.');
        }
    } catch (e) {
        console.error('CEP Node.js Bridge: Error:', e.message);
    }
})();
