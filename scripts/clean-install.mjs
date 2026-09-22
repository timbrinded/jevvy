import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { spawn } from 'node:child_process';

const sourceOnly = process.argv.includes('--source');
const archive = sourceOnly ? undefined : resolve(process.argv[2] ?? '.artifacts/jevvy-0.1.0.tgz');
const workspace = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'jevvy-production-'));
const host = join(temporary, 'host'),
  installation = join(temporary, 'package'),
  agentDir = join(temporary, 'agent');
const packageRoot = sourceOnly ? installation : join(installation, 'node_modules/jevvy');
const env = {
  ...process.env,
  PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
  JEVVY_PACKAGE: packageRoot,
  JEVVY_CHECK_AGENT_DIR: agentDir,
  PI_CODING_AGENT_DIR: agentDir,
  PI_TELEMETRY: '0',
  PI_OFFLINE: '1',
};
function run(command, args, cwd = host) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', code => (code === 0 ? resolve() : reject(new Error(`Command exited ${code}`))));
  });
}
try {
  for (const root of [host, installation]) {
    await mkdir(root);
    await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  }
  await cp(join(workspace, 'fixtures'), join(host, 'fixtures'), { recursive: true });
  await cp(join(workspace, 'examples'), join(host, 'examples'), { recursive: true });
  await cp(join(workspace, 'scripts/pi-check.mjs'), join(host, 'pi-check.mjs'));
  await cp(join(workspace, 'scripts/pi-packs-check.mjs'), join(host, 'pi-packs-check.mjs'));
  const pnpmOptions = [
    '--prod',
    '--store-dir',
    join(temporary, 'pnpm-store'),
    `--config.cache-dir=${join(temporary, 'pnpm-cache')}`,
  ];
  const manifest = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8'));
  for (const root of [host, installation]) {
    await cp(join(workspace, 'pnpm-workspace.yaml'), join(root, 'pnpm-workspace.yaml'));
  }
  await run('pnpm', [
    'add',
    ...pnpmOptions,
    `@earendil-works/pi-coding-agent@${manifest.devDependencies['@earendil-works/pi-coding-agent']}`,
  ]);
  if (sourceOnly) {
    // Reproduce a Git package's layout and Pi's production dependency install,
    // without dist/, a build step, or development tools in the package.
    for (const path of ['package.json', 'pnpm-lock.yaml', 'src', 'native'])
      await cp(join(workspace, path), join(installation, path), { recursive: true });
    await run(
      'pnpm',
      ['install', ...pnpmOptions, '--no-frozen-lockfile', '--config.auto-install-peers=false'],
      installation,
    );
    assert.equal(existsSync(join(packageRoot, 'dist')), false);
    assert.equal(existsSync(join(packageRoot, 'node_modules/typescript')), false);
  } else {
    // Like Pi's managed npm installs, leave host peers to Pi's loader.
    await run('pnpm', ['add', ...pnpmOptions, '--config.auto-install-peers=false', archive], installation);
    for (const peer of Object.keys(manifest.peerDependencies))
      assert.equal(existsSync(join(installation, 'node_modules', peer)), false, `${peer} should come from the Pi host`);
  }
  const piCli = join(host, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
  await run(process.execPath, [piCli, 'install', packageRoot]);
  const settingsPath = join(agentDir, 'settings.json');
  assert.ok(
    JSON.parse(await readFile(settingsPath, 'utf8')).packages.some(source => resolve(agentDir, source) === packageRoot),
  );
  await run(process.execPath, ['pi-check.mjs']);
  await run(process.execPath, ['pi-packs-check.mjs']);
  await run(process.execPath, [piCli, 'remove', packageRoot]);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')).packages, []);
  console.log(
    JSON.stringify({
      cleanProductionInstall: true,
      sourceOnly,
      manifestDiscovery: true,
      packageInstallAndRemove: true,
      architecture: process.arch,
      platform: process.platform,
      node: process.version,
      archive,
    }),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
