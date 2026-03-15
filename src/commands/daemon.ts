import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';

function assertMacOS(): void {
  if (process.platform !== 'darwin') {
    console.error('daemon コマンドは macOS 専用です。Linux では systemd user service を使ってください。');
    process.exit(1);
  }
}

const LABEL = 'com.ladder.fetch';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG_PATH = path.join(os.homedir(), '.config', 'ladder', 'fetch.log');

function resolveLadderBin(): string {
  try {
    return execSync('which ladder', { encoding: 'utf8' }).trim();
  } catch {
    // fallback: use current script path (dev mode via tsx)
    return process.argv[1];
  }
}

function resolveTsxBin(): string {
  try {
    return execSync('which tsx', { encoding: 'utf8' }).trim();
  } catch {
    // fallback to npx tsx
    return 'npx';
  }
}

function resolveNodeBin(): string {
  try {
    return execSync('which node', { encoding: 'utf8' }).trim();
  } catch {
    return 'node';
  }
}

function buildPlist(intervalSec: number): string {
  const ladderBin = resolveLadderBin();
  // Use tsx + script path when running via tsx in dev
  const isTsx = process.argv[1].endsWith('.ts');
  let programArgs: string[];
  if (isTsx) {
    const tsxBin = resolveTsxBin();
    // tsx is a Node.js script — launchd needs the absolute node path to exec it
    const nodeBin = resolveNodeBin();
    programArgs = tsxBin === 'npx'
      ? [nodeBin, '--import', 'tsx', process.argv[1], 'fetch']
      : [nodeBin, tsxBin, process.argv[1], 'fetch'];
  } else {
    programArgs = [ladderBin, 'fetch'];
  }

  const args = programArgs
    .map((a) => `    <string>${a}</string>`)
    .join('\n');

  // Pass the current PATH so launchd can resolve any remaining binaries
  const envPath = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${envPath}</string>
  </dict>
  <key>StartInterval</key>
  <integer>${intervalSec}</integer>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}

export function cmdDaemonInstall(options: { interval: string }): void {
  assertMacOS();
  const minutes = parseInt(options.interval, 10);
  if (isNaN(minutes) || minutes < 1) {
    console.error('Invalid --interval value');
    process.exit(1);
  }
  const intervalSec = minutes * 60;

  // ensure log dir exists
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

  // unload existing if any
  if (fs.existsSync(PLIST_PATH)) {
    spawnSync('launchctl', ['unload', PLIST_PATH]);
    console.log('Unloaded existing daemon.');
  }

  const plist = buildPlist(intervalSec);
  fs.writeFileSync(PLIST_PATH, plist, 'utf8');
  console.log(`Wrote plist: ${PLIST_PATH}`);

  const result = spawnSync('launchctl', ['load', PLIST_PATH], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error('launchctl load failed:', result.stderr || result.stdout);
    process.exit(1);
  }

  console.log(`Daemon installed. ladder fetch will run every ${minutes} minute(s).`);
  console.log(`Log: ${LOG_PATH}`);
}

export function cmdDaemonUninstall(): void {
  assertMacOS();
  if (!fs.existsSync(PLIST_PATH)) {
    console.log('Daemon is not installed.');
    return;
  }
  const result = spawnSync('launchctl', ['unload', PLIST_PATH], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error('launchctl unload failed:', result.stderr || result.stdout);
    process.exit(1);
  }
  fs.unlinkSync(PLIST_PATH);
  console.log('Daemon uninstalled.');
}

export function cmdDaemonStatus(): void {
  assertMacOS();
  if (!fs.existsSync(PLIST_PATH)) {
    console.log('Daemon is not installed.');
    return;
  }

  const result = spawnSync('launchctl', ['list', LABEL], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.log('Daemon plist exists but is not loaded.');
    return;
  }

  const out = result.stdout.trim();
  // parse PID and LastExitStatus from output like:
  // {
  //   "LimitLoadToSessionType" = "Aqua";
  //   "Label" = "com.ladder.fetch";
  //   "PID" = 12345;
  //   "LastExitStatus" = 0;
  // }
  const pidMatch = out.match(/"PID"\s*=\s*(\d+)/);
  const exitMatch = out.match(/"LastExitStatus"\s*=\s*(\d+)/);

  const pid = pidMatch ? pidMatch[1] : null;
  const lastExit = exitMatch ? exitMatch[1] : 'unknown';

  if (pid) {
    console.log(`Daemon running (PID ${pid})`);
  } else {
    console.log(`Daemon loaded, not currently running (last exit status: ${lastExit})`);
  }
  console.log(`Plist: ${PLIST_PATH}`);
  console.log(`Log:   ${LOG_PATH}`);
}
