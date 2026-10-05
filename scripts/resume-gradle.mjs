import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';

// Resume the pinned Gradle distribution using the same official source and checksum.
// Generated archives and transfer parts stay inside the project's ignored cache.
const runFile = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = join(root, '.gradle-cache', 'wrapper', 'dists', 'gradle-8.14.3-all', '10utluxaxniiv4wxiphsi49nj');
const archive = join(folder, 'gradle-8.14.3-all.zip');
const partial = `${archive}.part`;
const expectedHash = 'ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c';
const url = 'https://services.gradle.org/distributions/gradle-8.14.3-all.zip';
const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
await mkdir(folder, { recursive: true });
const { stdout: headers } = await runFile(curl, ['--fail', '--location', '--head', '--silent', '--show-error', '--max-time', '45', url], { windowsHide: true });
const lengths = [...headers.matchAll(/^content-length:\s*(\d+)/gim)];
const total = Number(lengths.at(-1)?.[1]);
if (!Number.isSafeInteger(total) || total <= 0) throw new Error('The official server did not provide a usable archive size.');
const prefix = Math.min((await stat(partial).catch(() => ({ size: 0 }))).size, total);
console.log(`Resuming ${(prefix / 1048576).toFixed(1)} MB of ${(total / 1048576).toFixed(1)} MB from Gradle's official server.`);
const count = Math.min(6, total - prefix);
const chunkSize = count ? Math.ceil((total - prefix) / count) : 0;
const transfers = [];
for (let index = 0; index < count; index++) {
  const start = prefix + index * chunkSize;
  if (start >= total) break;
  const end = Math.min(start + chunkSize - 1, total - 1);
  transfers.push({ path: join(folder, `gradle-transfer-${prefix}-${index}.part`), start, end });
}
await Promise.all(transfers.map(async transfer => {
  await runFile(curl, ['--fail', '--location', '--retry', '3', '--silent', '--show-error', '--range', `${transfer.start}-${transfer.end}`, '--output', transfer.path, url], { windowsHide: true });
  const size = (await stat(transfer.path)).size;
  if (size !== transfer.end - transfer.start + 1) throw new Error('The server returned an incomplete archive range.');
  console.log(`Downloaded archive part ${transfers.indexOf(transfer) + 1}/${transfers.length}.`);
}));
const assembled = `${archive}.assembling`;
const hash = createHash('sha256');
const sources = [...(prefix ? [{ path: partial, end: prefix - 1 }] : []), ...transfers];
await pipeline(async function* () {
  for (const source of sources) {
    const input = createReadStream(source.path, source.path === partial ? { start: 0, end: source.end } : {});
    for await (const chunk of input) {
      hash.update(chunk);
      yield chunk;
    }
  }
}, createWriteStream(assembled));
if (hash.digest('hex') !== expectedHash) throw new Error('Gradle archive checksum did not match; the downloaded archive will not be used.');
await rename(assembled, archive);
console.log(`Verified Gradle archive: ${archive}`);
