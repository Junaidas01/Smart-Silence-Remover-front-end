const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

// ─── Configurations ──────────────────────────────────────────────────────────

// High-security for modern Chromium JS (in /js folder)
const JS_CONFIG = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 1,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: true,
  debugProtectionInterval: 4000,
  disableConsoleOutput: true,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  stringArray: true,
  stringArrayEncoding: ['rc4'],
  stringArrayThreshold: 1,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
};

// ─── Pipeline ────────────────────────────────────────────────────────────────

// Maps source file → obfuscated output name
const JS_FILES = [
  { src: 'js/node-bridge.js',  out: 'dist/js/k9d3e.js' },
  { src: 'js/security.js',     out: 'dist/js/m4b8c.js' },
  { src: 'js/license.js',      out: 'dist/js/p1e6f.js' },
  { src: 'js/app.js',          out: 'dist/js/v3c5a.js' },
];

console.log("Starting Obfuscation Pipeline...");

// Process JS Files
JS_FILES.forEach(({ src, out }) => {
  processFile(src, out, JS_CONFIG);
});

function processFile(src, out, config) {
  const fullSrc = path.join(__dirname, src);
  const fullOut = path.join(__dirname, out);

  if (fs.existsSync(fullSrc)) {
    const code = fs.readFileSync(fullSrc, 'utf8');
    try {
      const result = JavaScriptObfuscator.obfuscate(code, config);
      fs.mkdirSync(path.dirname(fullOut), { recursive: true });
      fs.writeFileSync(fullOut, result.getObfuscatedCode());
      console.log(`[SUCCESS] ${src} → ${out}`);
    } catch (err) {
      console.error(`[ERROR] Failed to obfuscate ${src}:`, err);
    }
  } else {
    console.warn(`[SKIP] File not found: ${src}`);
  }
}

// Special case for CSInterface (copy manually, no obfuscation)
fs.copyFileSync(
  path.join(__dirname, 'js/CSInterface.js'), 
  path.join(__dirname, 'dist/js/x7f2a.js')
);
console.log(`[SUCCESS] Copied Adobe API: js/CSInterface.js → dist/js/x7f2a.js`);

// Copy original JSX (Direct, un-obfuscated as requested for revert)
fs.mkdirSync(path.join(__dirname, 'dist/jsx'), { recursive: true });
fs.copyFileSync(
  path.join(__dirname, 'jsx/silence-remover.jsx'), 
  path.join(__dirname, 'dist/jsx/silence-remover.jsx')
);
console.log(`[SUCCESS] Copied original JSX: jsx/silence-remover.jsx → dist/jsx/silence-remover.jsx`);

console.log("Obfuscation complete (JS only). Protected files are in /dist/");
