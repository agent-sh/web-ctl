'use strict';

const { spawn, execFileSync } = require('child_process');
const { launchBrowser, closeBrowser } = require('./browser-launcher');
const sessionStore = require('./session-store');
const net = require('net');

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
 * Get hostname for VNC URL. Prefer non-loopback IPv4.
 */
function getHostname() {
  try {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
  } catch { /* ignore */ }
  return 'localhost';
}

/**
 * Clean up all spawned processes and session state.
 */
async function cleanup(sessionName, context, procs) {
  if (context) {
    try { await closeBrowser(sessionName, context); } catch { /* ignore */ }
  }
  try { sessionStore.updateSession(sessionName, { status: 'authenticated' }); } catch { /* ignore */ }
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

  try {
    sessionStore.lockSession(sessionName);

    // 1. Start Xvfb
    xvfbProc = spawn('Xvfb', [display, '-screen', '0', '1280x800x24', '-ac'], {
      stdio: 'ignore', detached: true
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (xvfbProc.exitCode !== null) throw new Error(`Xvfb failed to start on display ${display}`);

    // 2. Start x11vnc
    x11vncProc = spawn('x11vnc', [
      '-display', display, '-nopw', '-forever', '-shared', '-rfbport', String(rfbPort)
    ], { stdio: 'ignore', detached: true });
    await new Promise(resolve => setTimeout(resolve, 500));

    // 3. Start websockify + noVNC
    const noVncDir = findNoVncDir();
    const vncPort = options.port || await findFreePort();
    const websockifyArgs = noVncDir
      ? ['--web', noVncDir, String(vncPort), `localhost:${rfbPort}`]
      : [String(vncPort), `localhost:${rfbPort}`];

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

    // 5. Build VNC URL and notify
    const hostname = getHostname();
    const isPrivateIp = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname);
    const displayHost = isPrivateIp ? 'localhost' : hostname;
    const vncUrl = noVncDir
      ? `http://${displayHost}:${vncPort}/vnc.html?autoconnect=true`
      : null;

    const tunnelHint = isPrivateIp
      ? `  If remote, forward first: ssh -L ${vncPort}:localhost:${vncPort} <server>`
      : '';
    const info = {
      vncUrl, vncPort, display,
      message: vncUrl
        ? `Authenticate via browser: ${vncUrl}`
        : `VNC server on port ${rfbPort}. Connect with a VNC client.`
    };

    process.stderr.write(`\n[web-ctl] ${info.message}\n${tunnelHint ? '[web-ctl] ' + tunnelHint + '\n' : ''}\n`);

    // 6. Poll for auth success
    const startTime = Date.now();
    const procs = [websockifyProc, x11vncProc, xvfbProc];

    while (Date.now() - startTime < timeout) {
      if (options.successUrl) {
        const currentUrl = page.url();
        if (currentUrl.startsWith(options.successUrl)) {
          await cleanup(sessionName, context, procs);
          return { ok: true, session: sessionName, url: currentUrl, ...info };
        }
      }

      if (options.successSelector) {
        const el = await page.$(options.successSelector);
        if (el) {
          const isValid = await el.evaluate(node => {
            if (node.tagName === 'META' && node.hasAttribute('content')) {
              return node.getAttribute('content').trim().length > 0;
            }
            return true;
          }).catch(() => false);
          if (isValid) {
            const currentUrl = page.url();
            await cleanup(sessionName, context, procs);
            return { ok: true, session: sessionName, url: currentUrl, ...info };
          }
        }
      }

      if (!options.successUrl && !options.successSelector) {
        const currentUrl = page.url();
        if (currentUrl !== url && !currentUrl.includes('login') && !currentUrl.includes('signin')) {
          const cookies = await context.cookies('https://github.com');
          const loggedIn = cookies.find(c => c.name === 'logged_in' && c.value === 'yes');
          if (loggedIn || !currentUrl.includes('github.com')) {
            await cleanup(sessionName, context, procs);
            return { ok: true, session: sessionName, url: currentUrl, ...info };
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    await cleanup(sessionName, context, procs);
    return { ok: false, session: sessionName, error: 'auth_timeout', message: `VNC auth timed out after ${options.timeout || 300}s`, ...info };
  } catch (err) {
    await cleanup(sessionName, context, [websockifyProc, x11vncProc, xvfbProc]);
    return { ok: false, session: sessionName, error: 'vnc_auth_error', message: err.message };
  }
}

module.exports = { runVncAuth, isVncAvailable };
