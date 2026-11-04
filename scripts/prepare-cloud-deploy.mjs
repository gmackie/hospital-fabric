import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';

// Release metadata must describe the checked-out source, not a caller's label.
const sourceSha = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {encoding:'utf8'}).trim();
execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'apps', 'scripts', 'package.json', 'package-lock.json']);
if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('Release requires a Git commit SHA');

const sourceConfig = resolve('apps/worker/wrangler.cloud.jsonc');
const outputDir = resolve('apps/worker/dist');
const config = JSON.parse((await readFile(sourceConfig, 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
config.main = relative(outputDir, resolve(dirname(sourceConfig), config.main));
for (const db of config.d1_databases) {
  db.migrations_dir = relative(outputDir, resolve(dirname(sourceConfig), db.migrations_dir));
}
const bundleSha256 = createHash('sha256').update(await readFile(resolve(outputDir, config.main))).digest('hex');
config.vars = {...config.vars, FG_APP:'hospital-fabric', FG_STAGE:'production', FG_COMMIT_HASH:sourceSha, FG_BUNDLE_SHA256:bundleSha256};
await writeFile(resolve(outputDir, 'wrangler.json'), JSON.stringify(config, null, 2)+'\n');
const manifest = {worker:config.name, sourceSha, bundleSha256};
await writeFile(resolve(outputDir, 'release.json'), JSON.stringify(manifest, null, 2)+'\n');
console.log(JSON.stringify(manifest));
