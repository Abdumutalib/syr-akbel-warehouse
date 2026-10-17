import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new Error('Windows is required');
const directory = path.join(process.env.LOCALAPPDATA, 'AKBEL-Backup');
fs.mkdirSync(directory, { recursive: true });
const noncePath = path.join(directory, 'setup-nonce');
const setupUrl = () => {
  try {
    const nonce = fs.readFileSync(noncePath, 'utf8').trim();
    return /^[a-f0-9]{48}$/.test(nonce) ? `http://127.0.0.1:8794/${nonce}` : null;
  } catch { return null; }
};
async function ready() {
  const url = setupUrl();
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000), redirect: 'error' });
    return response.ok && (await response.text()).includes('AKBEL') ? url : null;
  } catch { return null; }
}
let url = await ready();
if (!url) {
  const stdout = fs.openSync(path.join(directory, 'supervisor.log'), 'w');
  const stderr = fs.openSync(path.join(directory, 'supervisor-error.log'), 'w');
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'local-backup-setup.mjs')], {
    cwd: root, detached: true, windowsHide: true,
    env: { ...process.env, AKBEL_BACKUP_DIRECTORY: directory },
    stdio: ['ignore', stdout, stderr],
  });
  child.on('error', () => console.error('AKBEL backup could not start.'));
  child.unref(); fs.closeSync(stdout); fs.closeSync(stderr);
  for (let attempt = 0; attempt < 60 && !url; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    url = await ready();
  }
}
if (!url) {
  console.error('AKBEL could not start. Check ' + path.join(directory, 'supervisor-error.log'));
  process.exitCode = 1;
} else {
  // Register only this program's current-user startup entry. No administrator
  // password, firewall change, public port or Cloudflare subscription is needed.
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const vbs = path.join(root, 'scripts', 'backup-background.vbs');
  const command = `wscript.exe //B //Nologo "${vbs}"`;
  try {
    await run('reg.exe', ['add', key, '/v', 'AKBELBackup', '/t', 'REG_SZ', '/d', command, '/f'], { windowsHide: true });
    fs.writeFileSync(path.join(directory, 'startup-status.json'), JSON.stringify({ enabled: true, scope: 'current-user-logon' }));
  } catch {
    fs.writeFileSync(path.join(directory, 'startup-status.json'), JSON.stringify({ enabled: false }));
    console.error('Automatic startup could not be installed. Run START-AKBEL.cmd after signing in.');
  }
  if (!process.argv.includes('--background')) {
    await run('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true });
  }
  console.log('AKBEL local setup: ' + url);
}
