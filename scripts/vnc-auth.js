'use strict';

const { spawn, execFileSync } = require('child_process');
const { launchBrowser, closeBrowser } = require('./browser-launcher');
const sessionStore = require('./session-store');
const { checkAuthSuccess } = require('./auth-check');
const { verifyHeadless } = require('./verify-headless');
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Find a free TCP port.
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Check if a command exists on PATH.
 */
function commandExists(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if VNC auth is available (Xvfb + websockify + x11vnc).
 */
function isVncAvailable() {
  return commandExists('Xvfb') && commandExists('websockify') && commandExists('x11vnc');
}

/**
 * Find noVNC web directory.
 */
function findNoVncDir() {
  const fs = require('fs');
  const candidates = ['/usr/share/novnc', '/usr/share/noVNC', '/opt/novnc', '/opt/noVNC'];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

/**
 * Get hostname for VNC URL. Always returns loopback by default.
 * Binding to a non-loopback address is a foot-gun: it exposes the unauthenticated
 * VNC stream to the local network. Callers can pass `bindRemote: true` to opt
 * in to the legacy behavior (and even then a password is required).
 */
function getHostname(bindRemote = false) {
  if (!bindRemote) return '127.0.0.1';
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
  } catch { /* ignore */ }
  return '127.0.0.1';
}

/**
 * Generate an 8-character alphanumeric VNC password token.
 *
 * WHY 8 CHARS: the RFB protocol (used by x11vnc's `-rfbauth`) truncates
 * passwords to 8 bytes via DES encryption. Generating anything longer is
 * actively misleading — users copy the full string but only the first 8
 * chars are verified. We restrict the alphabet to characters that survive
 * RFB framing cleanly (no `+/=` padding from base64). 8 chars from a
 * 62-char alphabet gives ~47.6 bits of entropy, which is the practical
 * ceiling for this protocol — not our choice to make it higher.
 */
function generateVncToken() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/**
 * Generate a random VNC password token and write it to a 0600 tempfile
 * using x11vnc's `-storepasswd` helper. Returns { token, passwdFile, passwdDir }.
 * Caller MUST call cleanupPasswdFile() on exit.
 *
 * TOCTOU: the passwd file is created inside a private 0700 directory via
 * `fs.mkdtempSync` so that even the brief window before x11vnc writes +
 * chmods the passwd file is not reachable by other local users. We also
 * remove the entire directory on cleanup.
 */
function createVncPasswd() {
  const token = generateVncToken();
  const passwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ctl-vnc-'));
  // mkdtempSync creates with 0700 on POSIX; belt-and-braces on platforms
  // that may honor umask instead.
  try { fs.chmodSync(passwdDir, 0o700); } catch { /* best-effort */ }
  const passwdFile = path.join(passwdDir, 'passwd');
  // x11vnc -storepasswd <pass> <file> writes an obfuscated passwd file.
  execFileSync('x11vnc', ['-storepasswd', token, passwdFile], { stdio: 'ignore' });
  try { fs.chmodSync(passwdFile, 0o600); } catch { /* best-effort */ }
  return { token, passwdFile, passwdDir };
}

function cleanupPasswdFile(passwdFile, passwdDir) {
  if (passwdFile) {
    try { fs.unlinkSync(passwdFile); } catch { /* already gone */ }
  }
  if (passwdDir) {
    try { fs.rmSync(passwdDir, { recursive: true, force: true }); } catch { /* already gone */ }
  }
}

/**
 * Clean up all spawned processes and session state.
 */
async function cleanup(sessionName, context, procs, { authenticated = false, passwdFile = null, passwdDir = null } = {}) {
  cleanupPasswdFile(passwdFile, passwdDir);
  if (context) {
    try { await closeBrowser(sessionName, context); } catch { /* ignore */ }
  }
  if (authenticated) {
    try { sessionStore.updateSession(sessionName, { status: 'authenticated' }); } catch { /* ignore */ }
  }
  try { sessionStore.unlockSession(sessionName); } catch { /* ignore */ }

  for (const proc of procs) {
    if (proc && proc.exitCode === null) {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* ignore */ }
    }
  }
}

/**
 * Run auth flow via Xvfb + x11vnc + noVNC.
 *
 * Launches Chrome inside a virtual framebuffer and exposes it via
 * websockify + noVNC so the user can authenticate through their local browser.
 */
async function runVncAuth(sessionName, url, options = {}) {
  const timeout = (options.timeout || 300) * 1000;
  const pollInterval = 2000;
  const displayNum = 99 + Math.floor(Math.random() * 100);
  const display = `:${displayNum}`;
  const rfbPort = 5900 + displayNum;

  let xvfbProc = null;
  let x11vncProc = null;
  let websockifyProc = null;
  let context = null;
  let passwdFile = null;
  let passwdDir = null;
  const bindRemote = !!options.bindRemote;
  // Safety net: remove the passwd dir if the process exits unexpectedly
  // (SIGINT, uncaught throw, etc.) without walking the normal cleanup path.
  const exitHandler = () => {
    if (passwdFile || passwdDir) {
      try { cleanupPasswdFile(passwdFile, passwdDir); } catch { /* ignore */ }
    }
  };
  process.once('exit', exitHandler);

  try {
    sessionStore.lockSession(sessionName);

    // 1. Start Xvfb
    xvfbProc = spawn('Xvfb', [display, '-screen', '0', '1280x800x24', '-ac'], {
      stdio: 'ignore', detached: true
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (xvfbProc.exitCode !== null) throw new Error(`Xvfb failed to start on display ${display}`);

    // 2. Generate a random password token. Required unconditionally — we never
    // launch an unauthenticated VNC server, even on loopback, because anyone
    // with a local account could otherwise attach to the session.
    const { token, passwdFile: pf, passwdDir: pd } = createVncPasswd();
    passwdFile = pf;
    passwdDir = pd;

    // 3. Start x11vnc with password + loopback binding (unless --bind-remote).
    const x11vncArgs = [
      '-display', display,
      '-rfbauth', passwdFile,
      '-forever', '-shared',
      '-rfbport', String(rfbPort)
    ];
    if (!bindRemote) x11vncArgs.push('-localhost');
    x11vncProc = spawn('x11vnc', x11vncArgs, { stdio: 'ignore', detached: true });
    await new Promise(resolve => setTimeout(resolve, 500));

    // 4. Start websockify + noVNC bound to loopback by default.
    const noVncDir = findNoVncDir();
    const vncPort = options.port || await findFreePort();
    const listenHost = bindRemote ? '0.0.0.0' : '127.0.0.1';
    // websockify accepts either `host:port` as the source, or `--listen-host` +
    // positional port. Using the `host:port` form is supported across all
    // versions we target.
    const websockifyArgs = noVncDir
      ? ['--web', noVncDir, `${listenHost}:${vncPort}`, `127.0.0.1:${rfbPort}`]
      : [`${listenHost}:${vncPort}`, `127.0.0.1:${rfbPort}`];

    websockifyProc = spawn('websockify', websockifyArgs, {
      stdio: 'ignore', detached: true
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    // 4. Launch Chrome inside Xvfb
    const origDisplay = process.env.DISPLAY;
    process.env.DISPLAY = display;
    const browser = await launchBrowser(sessionName, { headless: false });
    context = browser.context;
    const page = browser.page;
    process.env.DISPLAY = origDisplay || '';

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const minWaitMs = (options.minWait || 5) * 1000;
    await new Promise(resolve => setTimeout(resolve, minWaitMs));

    // 5. Build VNC URL and notify
    const hostname = getHostname(bindRemote);
    const displayHost = hostname;
    const vncUrl = noVncDir
      ? `http://${displayHost}:${vncPort}/vnc.html?autoconnect=true`
      : null;

    const tunnelHint = !bindRemote
      ? `  If remote, forward first: ssh -L ${vncPort}:127.0.0.1:${vncPort} <server>`
      : '  WARNING: --bind-remote exposes VNC on all interfaces. Firewall appropriately.';
    const info = {
      vncUrl, vncPort, display,
      message: vncUrl
        ? `Authenticate via browser: ${vncUrl}`
        : `VNC server on ${displayHost}:${rfbPort}. Connect with a VNC client.`
    };

    process.stderr.write(
      `\n[web-ctl] ${info.message}\n` +
      `[web-ctl] VNC password (8 chars, RFB protocol limit): ${token}\n` +
      `[web-ctl] ${tunnelHint}\n\n`
    );

    // 6. Poll for auth success
    const startTime = Date.now();
    const procs = [websockifyProc, x11vncProc, xvfbProc];

    while (Date.now() - startTime < timeout) {
      const result = await checkAuthSuccess(page, context, url, {
        successUrl: options.successUrl,
        successSelector: options.successSelector,
        successCookie: options.successCookie,
        loginUrl: url
      });

      if (result.success) {
        try { await closeBrowser(sessionName, context); } catch { /* ignore */ }
        context = null;
        try { sessionStore.updateSession(sessionName, { status: 'authenticated' }); } catch { /* ignore */ }
        const headlessVerification = await verifyHeadless(sessionName, {
          verifyUrl: options.verifyUrl,
          verifySelector: options.verifySelector
        });
        try { sessionStore.unlockSession(sessionName); } catch { /* ignore */ }
        for (const proc of procs) {
          if (proc && proc.exitCode === null) {
            try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* ignore */ }
          }
        }
        cleanupPasswdFile(passwdFile, passwdDir);
        process.removeListener('exit', exitHandler);
        const authResult = { ok: true, session: sessionName, url: result.currentUrl, ...info };
        if (headlessVerification) authResult.headlessVerification = headlessVerification;
        return authResult;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    await cleanup(sessionName, context, procs, { passwdFile, passwdDir });
    process.removeListener('exit', exitHandler);
    return { ok: false, session: sessionName, error: 'auth_timeout', message: `VNC auth timed out after ${options.timeout || 300}s`, ...info };
  } catch (err) {
    await cleanup(sessionName, context, [websockifyProc, x11vncProc, xvfbProc], { passwdFile, passwdDir });
    process.removeListener('exit', exitHandler);
    return { ok: false, session: sessionName, error: 'vnc_auth_error', message: err.message };
  }
}

module.exports = { runVncAuth, isVncAvailable, generateVncToken, createVncPasswd, cleanupPasswdFile };
