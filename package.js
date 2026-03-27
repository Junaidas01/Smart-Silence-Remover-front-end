const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const EXTENSION_FOLDER = 'com.smartsilenceremover.panel';
const STRICT_MODE = process.argv.includes('--strict');

const RELEASE_DIR = path.join(ROOT, 'release');
const STAGE_DIR = path.join(RELEASE_DIR, EXTENSION_FOLDER);
const SUPPORT_DIR = path.join(RELEASE_DIR, 'support');
const ZIP_PATH = path.join(RELEASE_DIR, `${EXTENSION_FOLDER}.zip`);

function log(msg) {
  console.log(`[package] ${msg}`);
}

function warn(msg) {
  console.warn(`[package][warn] ${msg}`);
}

function fail(msg) {
  console.error(`[package][error] ${msg}`);
  process.exit(1);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  ensureDir(path.dirname(to));
  fs.cpSync(from, to, { recursive: true });
}

function mustExist(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    fail(`Missing required file: ${relPath}`);
  }
  return abs;
}

function maybeCopyDir(relPath, stageRelPath) {
  const src = path.join(ROOT, relPath);
  if (!fs.existsSync(src)) {
    warn(`Optional directory missing: ${relPath}`);
    return false;
  }
  copyDir(src, path.join(STAGE_DIR, stageRelPath));
  return true;
}

function findSystemFfmpegOnWindows() {
  if (process.platform !== 'win32') return null;
  try {
    const output = execSync('where ffmpeg', {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    const first = output
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.toLowerCase().endsWith('ffmpeg.exe') && fs.existsSync(s));
    return first || null;
  } catch (_) {
    return null;
  }
}

function writeRegFiles() {
  ensureDir(SUPPORT_DIR);

  const versions = ['7', '8', '9', '10', '11', '12'];

  const enable = [
    'Windows Registry Editor Version 5.00',
    '',
    ...versions.flatMap((v) => [
      `[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.${v}]`,
      '"PlayerDebugMode"="1"',
      '',
    ]),
  ].join('\r\n');

  const disable = [
    'Windows Registry Editor Version 5.00',
    '',
    ...versions.flatMap((v) => [
      `[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.${v}]`,
      '"PlayerDebugMode"="0"',
      '',
    ]),
  ].join('\r\n');

  fs.writeFileSync(path.join(SUPPORT_DIR, 'enable-cep-debug.reg'), enable, 'utf8');
  fs.writeFileSync(path.join(SUPPORT_DIR, 'disable-cep-debug.reg'), disable, 'utf8');
}

function writeInstallReadme() {
  const content = [
    '# Smart Silence Remover - Client Install Notes',
    '',
    '## Install (unsigned CEP folder)',
    '1. Close Premiere Pro.',
    '2. Copy this extension folder to:',
    '   C:\\Users\\<USER>\\AppData\\Roaming\\Adobe\\CEP\\extensions\\com.smartsilenceremover.panel',
    '3. If extension does not show up, run support\\enable-cep-debug.reg and restart Premiere Pro.',
    '4. Open Premiere Pro -> Window -> Extensions -> Smart Silence Remover.',
    '',
    '## Runtime requirements',
    '- Internet access is required for licensing activation/verification.',
    '- ffmpeg is required for analysis.',
    '- If bundled ffmpeg is not included, ffmpeg must be installed and available in system PATH.',
    '',
    '## Troubleshooting',
    '- Restart Premiere Pro after installation.',
    '- Confirm extension path and folder name are exact.',
    '- Confirm firewall/proxy allows license API.',
  ].join('\r\n');

  fs.writeFileSync(path.join(RELEASE_DIR, 'readme.md'), content, 'utf8');
}

function makeZipFromStage() {
  if (process.platform !== 'win32') {
    warn('ZIP step skipped (PowerShell zip is only configured for Windows).');
    return;
  }

  const ps = [
    `$zip = '${ZIP_PATH.replace(/\\/g, '\\\\')}'`,
    `$src = '${(STAGE_DIR + '\\*').replace(/\\/g, '\\\\')}'`,
    'if (Test-Path $zip) { Remove-Item $zip -Force }',
    'Compress-Archive -Path $src -DestinationPath $zip -Force',
  ].join('; ');

  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`, {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

function run() {
  log(`Mode: ${STRICT_MODE ? 'strict' : 'normal'}`);
  log('Running build...');
  execSync('node build.js', { cwd: ROOT, stdio: 'inherit' });

  log('Preparing release directories...');
  cleanDir(RELEASE_DIR);
  ensureDir(STAGE_DIR);

  // Required files
  const required = [
    'CSXS/manifest.xml',
    'index.html',
    'css/style.css',
    'dist/js/x7f2a.js',
    'dist/js/k9d3e.js',
    'dist/js/m4b8c.js',
    'dist/js/p1e6f.js',
    'dist/js/v3c5a.js',
  ];
  required.forEach(mustExist);

  const jsxSrc = fs.existsSync(path.join(ROOT, 'dist/jsx/silence-remover.jsx'))
    ? path.join(ROOT, 'dist/jsx/silence-remover.jsx')
    : mustExist('jsx/silence-remover.jsx');

  log('Staging runtime files...');
  copyFile(path.join(ROOT, 'CSXS/manifest.xml'), path.join(STAGE_DIR, 'CSXS/manifest.xml'));
  copyFile(path.join(ROOT, 'index.html'), path.join(STAGE_DIR, 'index.html'));
  copyFile(path.join(ROOT, 'css/style.css'), path.join(STAGE_DIR, 'css/style.css'));
  copyDir(path.join(ROOT, 'dist/js'), path.join(STAGE_DIR, 'js'));
  copyFile(jsxSrc, path.join(STAGE_DIR, 'jsx/silence-remover.jsx'));

  // Optional but strongly recommended runtime assets
  const hasIcons = maybeCopyDir('icons', 'icons');
  const hasBin = maybeCopyDir('bin', 'bin');

  if (!hasIcons) {
    log('No icons directory found. Packaging continues without panel icons.');
  }

  const rootBundledFfmpegPath = path.join(ROOT, 'bin', 'win', 'ffmpeg.exe');
  const stagedBundledFfmpegPath = path.join(STAGE_DIR, 'bin', 'win', 'ffmpeg.exe');
  let hasBundledFfmpeg = fs.existsSync(rootBundledFfmpegPath);
  let systemFfmpegPath = null;

  if (!hasBin) {
    warn('Bundled ffmpeg not found in /bin. Client must have ffmpeg in PATH.');
  }

  if (!hasBundledFfmpeg) {
    systemFfmpegPath = findSystemFfmpegOnWindows();
    if (systemFfmpegPath) {
      copyFile(systemFfmpegPath, stagedBundledFfmpegPath);
      hasBundledFfmpeg = true;
      log(`Bundled ffmpeg from system PATH: ${systemFfmpegPath}`);
    }
  }

  if (!hasBundledFfmpeg && STRICT_MODE) {
    fail('Strict mode: ffmpeg missing. Add bin/win/ffmpeg.exe or install ffmpeg so it is discoverable via PATH.');
  } else if (!hasBundledFfmpeg) {
    warn('No bundled ffmpeg found and system ffmpeg was not discoverable.');
  }

  log('Writing support files...');
  writeRegFiles();
  writeInstallReadme();

  log('Creating ZIP...');
  makeZipFromStage();

  log('Done.');
  log(`Staged extension folder: ${STAGE_DIR}`);
  log(`ZIP package: ${ZIP_PATH}`);
  log(`Support files: ${SUPPORT_DIR}`);
}

run();
