import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';

// The OS releases this loopback listener after a crash. It serializes stale-file
// cleanup so two restarted agents cannot both take over the same backup folder.
export async function acquireBackupProcessLock(directory, port = 8795) {
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve);
  });
  const lockPath = path.join(directory, 'agent.lock');
  try {
    let previous = '';
    try { previous = await fs.readFile(lockPath, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) {
      const pid = Number(previous.trim());
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid agent.lock; check the previous process');
      try { process.kill(pid, 0); throw new Error('A previous backup process is still running'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await fs.rm(lockPath, { force: true });
    const lock = await fs.open(lockPath, 'wx', 0o600);
    await lock.writeFile(String(process.pid));
    return async () => {
      try { await lock.close(); await fs.rm(lockPath, { force: true }); }
      finally { await new Promise(resolve => server.close(resolve)); }
    };
  } catch (error) { server.close(); throw error; }
}
