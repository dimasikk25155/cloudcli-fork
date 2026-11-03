import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

/** The CLI and every reader must use the same home, including custom installs. */
export function codexHome(home = os.homedir()): string {
  return process.env.CODEX_HOME?.trim() || path.join(home, '.codex');
}

/** Resolve the same pinned native dependency as the SDK, never an unrelated PATH CLI. */
export function resolveBundledCodex() {
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : null;
  const targets: Partial<Record<NodeJS.Platform, string>> = { darwin: 'apple-darwin', linux: 'unknown-linux-musl', android: 'unknown-linux-musl', win32: 'pc-windows-msvc' };
  const target = targets[process.platform];
  if (!arch || !target) throw new Error(`Unsupported Codex platform: ${process.platform}/${process.arch}`);
  const sdkRequire = createRequire(import.meta.resolve('@openai/codex-sdk'));
  const codexRequire = createRequire(sdkRequire.resolve('@openai/codex/package.json'));
  const platform = process.platform === 'android' ? 'linux' : process.platform;
  const packagePath = codexRequire.resolve(`@openai/codex-${platform}-${process.arch}/package.json`);
  const root = path.join(path.dirname(packagePath), 'vendor', `${arch}-${target}`);
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex';
  for (const [bin, extra] of [['bin', 'codex-path'], ['codex', 'path']]) {
    const executablePath = path.join(root, bin, executable);
    if (fs.existsSync(executablePath)) {
      const extraPath = path.join(root, extra);
      return { executablePath, pathDirs: fs.existsSync(extraPath) ? [extraPath] : [] };
    }
  }
  throw new Error('Codex SDK native binary is missing. Install optional dependencies.');
}
