import { mkdtemp, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { spawn } from 'node:child_process';

const archive = resolve(process.argv[2] ?? '.artifacts/jevvy-0.1.0.tgz');
const workspace = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'jevvy-production-'));
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, JEVVY_EXTENSION: 'node_modules/jevvy/dist/extension.js', PI_TELEMETRY: '0' };
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: temporary, env, stdio: 'inherit' });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`Command exited ${code}`)));
  });
}
try {
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await cp(join(workspace, 'fixtures'), join(temporary, 'fixtures'), { recursive: true });
  await cp(join(workspace, 'scripts/pi-check.mjs'), join(temporary, 'pi-check.mjs'));
  const npmCli = resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
  await run([npmCli, 'install', '--omit=dev', '--no-audit', '--no-fund', '--cache', join(temporary, 'npm-cache'), archive]);
  await run(['pi-check.mjs']);
  console.log(JSON.stringify({ cleanProductionInstall: true, architecture: process.arch, platform: process.platform, node: process.version, archive }));
} finally { await rm(temporary, { recursive: true, force: true }); }
