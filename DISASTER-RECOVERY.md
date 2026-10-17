# Local backup and standby

## Current implementation

This is **encrypted periodic backup and a local read-only standby**, not automatic
public failover or synchronous database replication. Do not put the standby into a
write-serving load balancer pool. Its `/readyz` intentionally returns 503.

An administrator-only HTTPS API exports a consistent application state snapshot,
the reminder scheduler state, and a checksum manifest of the transaction photo
directory. Both `/api/warehouse/disaster-recovery/*` and
`/warehouse/api/warehouse/disaster-recovery/*` require admin authentication and
return `Cache-Control: no-store`. Seller credentials, including a seller login
combined with an old admin cookie, cannot export backups.

The Windows agent polls every 30 seconds **after a completed attempt**, downloads
missing photos at a throttled rate, and stores AES-256-GCM encrypted snapshots and
photo blobs on the computer. A complete manifest becomes `latest.json` only after
all files pass checksum verification and are written. A failed download leaves
the previous complete backup available. Network failures back off to five minutes.
This is an asynchronous backup: writes after the latest `capturedAt` can be absent
after a primary-server loss. Initial photo copying can take longer than 30 seconds.

Included business data: customers, staff accounts/permissions/access links, admin
credentials, orders, transaction history, stock, prices, other application state
fields, reminder scheduler state and local transaction photos. This is not a full
VDS image: OS configuration, PostgreSQL's internal event/history tables, server
environment secrets, external Telegram-hosted files and logs are not exported.
Keep an independent PostgreSQL backup and infrastructure configuration backup too.

## First Windows start

The portable Windows package includes Node and production dependencies. Extract
it to a permanent folder and double-click `START-AKBEL.cmd`. Its launcher runs in
the owner's normal Windows session, starts the private setup page in the default
browser, and registers only `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
value `AKBELBackup` for the current user's next sign-in (hidden VBScript launcher).
This does not run while Windows is signed out. Keep the extracted folder in place.
Data/settings are stored separately under `%LOCALAPPDATA%\AKBEL-Backup`.
`startup-status.json` records whether startup registration succeeded. If Windows
policy blocks the launcher, run `START-AKBEL.cmd` manually after signing in.

The setup URL's nonce is persisted in the private backup directory, so the local
URL remains valid after a restart. A loopback OS lock serializes agents and permits
safe cleanup of crash-left lock files only when the recorded process is gone.

For a local browser form instead of a Windows credential prompt, run:

```powershell
node scripts/local-backup-setup.mjs
```

Open the random `SETUP_URL` printed by that process. It binds only to
`127.0.0.1:8794`, rejects other Host/Origin headers and oversized input, and accepts
the administrator credentials only once per setup. It validates them against the
fixed HTTPS source `https://akbelim.com`, protects the folder DACL with `icacls`,
and saves credentials plus the backup key in Windows DPAPI-protected
`settings.dpapi`. Credentials never appear in URLs, logs or process arguments.
The setup page and supervisor must stay running. It starts the backup agent and
shows its latest result; it does not install a service or startup task. On a later
run, the saved settings automatically restart the agent. Use the same data folder
and preserve its key. If you previously used `credentials.clixml`, continue using
the PowerShell launcher below instead of creating a different encryption key.

The default browser-setup data directory is `C:\workspace\AKBEL-Backup`; set
`AKBEL_BACKUP_DIRECTORY` before startup to choose a different directory. The page
is a local setup UI, not a public internet endpoint, and never changes Cloudflare
or enables failover. Its status page reports failures without exposing credentials.

Install the repository's dependencies with `npm ci`, then run in PowerShell:

```powershell
& .\scripts\start-local-backup.ps1
```

Enter the **website administrator** username/password in the Windows credential
prompt. Do not put passwords into a shell command, GitHub, screenshots or chat.
By default the data folder is `%LOCALAPPDATA%\AKBEL-Backup`. Use `-DataDirectory`
to choose another local NTFS disk before the first run.

The script restricts that folder to the current Windows account, stores the
credentials and encryption key with Windows DPAPI (`credentials.clixml`), and
launches the agent. Keep this window running. No startup task, system service,
sleep settings, firewall rule, public tunnel or DNS change is installed by this
script. It is a foreground process until a persistent Windows service is installed.
DPAPI recovery requires this Windows account/machine: preserve the encryption key
in a separately secured recovery process before replacing/reinstalling Windows.
Never delete or overwrite `credentials.clixml` when changing a password.
Use `-UpdateCredentials` to enter a new admin password while preserving the key.

After the first successful copy, the agent starts:

`http://127.0.0.1:8793/warehouse/admin`

The standby binds only to loopback, uses the restored local file (never the remote
database), disables automatic Telegram reports/reminders, and refuses business
writes and webhooks. Use the copied admin credentials to log in. The process is
restarted when a newer revision is restored; sessions on this local preview can
therefore expire. During an internet outage it keeps the latest complete revision.
On an agent restart during an outage, it attempts to start that last revision.

`agent-status.json` reports the most recent attempt; `latest.json` identifies the
most recent **complete** backup and its capture time. A process crash may leave
`agent.lock`: verify the recorded PID is no longer running before removing it.
Snapshots/photo blobs are retained without automatic deletion. Monitor free disk
space. Restores are plaintext within the restricted folder; use BitLocker for disk
theft protection. Do not share this directory with other users or web servers.

## Restore test

Choose a NEW, nonexistent target directory:

```powershell
& .\scripts\start-local-backup.ps1 -RestoreTo "$env:LOCALAPPDATA\AKBEL-Backup\restore-test"
```

The target must be inside the protected backup folder and is never overwritten.
`backup-manifest.json` is written last, after all
photo/state checks succeed. A failed restore has no completion manifest. Restoring
does not upload data to production or enable writes. For one copy without running
a standby: `start-local-backup.ps1 -Once`.

## Remaining work for all sellers / automatic public failover

1. Access the Cloudflare account for `akbelim.com` and inspect its existing DNS,
   tunnel, plan and load balancing configuration. Use a dedicated authenticated
   tunnel from the Windows computer; do not expose a router port or use a temporary
   public testing tunnel for business data. Do not purchase a service automatically.
2. Inspect the VDS and PostgreSQL deployment. Select a single-writer architecture
   with a genuinely independent quorum/witness and fencing. A timeout alone must
   never promote a disconnected copy. The original server must be prevented from
   accepting writes before the standby can do so; failback needs resynchronization.
3. If zero loss of acknowledged writes is required, implement and test synchronous
   database replication (and replicated uploaded files). With only a VDS and a PC,
   a network partition cannot provide both unrestricted writes and guaranteed
   consistency. Waiting for the PC can stop primary writes when the PC is offline.
4. Install a supervised Windows service under a dedicated account, appropriate
   credential storage/recovery, power/sleep/UPS settings, and a stable internet
   connection. Verify the app and dependencies in that service account.
5. Configure Cloudflare health-based active/standby routing against **writer
   readiness**, not mere process liveness. Do not bypass the current standby 503.
6. Test VDS loss, PC loss, link partition, primary restart, photo completeness,
   duplicate/retried sales, session re-login, fencing, restore and failback. Record
   measured recovery time and possible data loss before calling it production HA.

No public failover is enabled by this change. The primary continues to be the only
writer. The local agent has no authority to change DNS or promote itself.
