import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLocalBackupSetup } from '../lib/local-backup-setup.mjs';
import { atomicWrite, validateSnapshot } from '../lib/disaster-recovery.mjs';

if (process.platform !== 'win32') throw new Error('Windows DPAPI is required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.resolve(process.env.AKBEL_BACKUP_DIRECTORY || 'C:/workspace/AKBEL-Backup');
const settingsPath = path.join(directory, 'settings.dpapi');
let agent;
function powershell(code, input = '') {
  return new Promise((resolve, reject) => {
    const loadSecurity = "[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; ";
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', loadSecurity + code], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = []; let size = 0;
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 100000) child.kill(); else output.push(chunk); });
    child.stderr.resume();
    child.on('error', () => reject(new Error('Windows credential protection unavailable')));
    child.on('close', code => code === 0 ? resolve(Buffer.concat(output).toString('utf8').trim()) : reject(new Error('Windows credential protection failed')));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
await fs.mkdir(directory, { recursive: true });
// The script text and argument are separate; neither credential is a command argument.
await powershell(`$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd(); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; & icacls.exe $p '/inheritance:r' '/grant:r' ('*'+$sid.Value+':(OI)(CI)F') | Out-Null; if($LASTEXITCODE -ne 0){throw 'Directory protection failed'}; $allowed=@($sid.Value,'S-1-5-18','S-1-5-32-544'); foreach($r in (Get-Acl -LiteralPath $p).Access){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $allowed){throw 'Directory has another user access rule'}}`, directory);
const encode = input => powershell(`$ErrorActionPreference='Stop'; $s=ConvertTo-SecureString ([Console]::In.ReadToEnd()) -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString $s))`, JSON.stringify(input));
const decode = input => powershell(`$ErrorActionPreference='Stop'; $s=ConvertTo-SecureString ([Console]::In.ReadToEnd()); [Console]::Out.Write(([pscredential]::new('backup',$s)).GetNetworkCredential().Password)`, input).then(JSON.parse);
async function launch(settings) {
  if (agent && agent.exitCode === null && agent.signalCode === null) throw new Error('Agent already running');
  agent = spawn(process.execPath, ['scripts/backup-agent.mjs', '--standby'], { cwd: root, windowsHide: true,
    env: { ...process.env, AKBEL_BACKUP_DIRECTORY: directory, AKBEL_BACKUP_SOURCE: 'https://akbelim.com', AKBEL_BACKUP_USERNAME: settings.username, AKBEL_BACKUP_PASSWORD: settings.password, AKBEL_BACKUP_KEY: settings.key },
    stdio: ['ignore', 'pipe', 'pipe'] });
  // The existing agent logs only non-sensitive status.
  agent.stdout.on('data', chunk => process.stdout.write(chunk));
  agent.stderr.on('data', chunk => process.stderr.write(chunk));
  agent.on('error', () => console.error('Backup process could not start'));
}
const noncePath = path.join(directory, 'setup-nonce');
let nonce;
try { nonce = (await fs.readFile(noncePath, 'utf8')).trim(); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  nonce = crypto.randomBytes(24).toString('hex');
  await atomicWrite(noncePath, nonce);
}
if (!/^[a-f0-9]{48}$/.test(nonce)) throw new Error('Invalid private setup URL');
const ui = createLocalBackupSetup({
  nonce,
  async configure({ username, password }) {
    const response = await fetch('https://akbelim.com/warehouse/api/warehouse/disaster-recovery/snapshot', {
      headers: { Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') }, redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Authentication failed'); }
    const content = []; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 128 * 1024 * 1024) throw new Error('Snapshot too large'); content.push(chunk); }
    validateSnapshot(JSON.parse(Buffer.concat(content)));
    let key;
    try { key = (await decode(await fs.readFile(settingsPath, 'utf8'))).key; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Do not strand backups encrypted by an existing installation's key.
      for (const file of ['latest.json', 'credentials.clixml']) {
        try { await fs.access(path.join(directory, file)); throw new Error('Existing backup settings must be preserved'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      key = crypto.randomBytes(32).toString('base64');
    }
    const settings = { username, password, key };
    await atomicWrite(settingsPath, await encode(settings));
    await launch(settings);
  },
  async getStatus() {
    const status = JSON.parse(await fs.readFile(path.join(directory, 'agent-status.json'), 'utf8'));
    const age = Date.now() - Date.parse(status.checkedAt);
    if (!agent || agent.exitCode !== null || agent.signalCode !== null || !Number.isFinite(age) || age > 6 * 60 * 1000) return { ok: false };
    return status;
  },
});
try { const settings = await decode(await fs.readFile(settingsPath, 'utf8')); await launch(settings); ui.markConfigured(); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
ui.server.listen(8794, '127.0.0.1', () => console.log(`SETUP_URL=${ui.url}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { agent?.kill(); ui.server.close(); });
