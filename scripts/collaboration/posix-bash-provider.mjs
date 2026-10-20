import { existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** Resolve a real POSIX test shell without selecting a Windows WSL launcher. */
export function resolvePosixBash({
  platform = process.platform,
  env = process.env,
  exists = existsSync,
  realpath = realpathSync,
  probe = spawnSync,
} = {}) {
  const windows = platform === 'win32';
  const candidates = [];
  if (windows) {
    const roots = new Set();
    for (const item of (env.PATH ?? '').split(';').slice(0, 64)) {
      const directory = item.trim().replace(/^"(.*)"$/, '$1');
      if (!path.win32.isAbsolute(directory)) continue;
      if (!exists(path.win32.join(directory, 'git.exe'))) continue;
      const name = path.win32.basename(directory).toLowerCase();
      if (name === 'cmd') roots.add(path.win32.dirname(directory));
      else if (name === 'bin') {
        const parent = path.win32.dirname(directory);
        const parentName = path.win32.basename(parent).toLowerCase();
        roots.add(/^mingw(?:32|64)$/.test(parentName) ? path.win32.dirname(parent) : parent);
      }
      if (roots.size >= 6) break;
    }
    for (const directory of [env.ProgramFiles, env['ProgramFiles(x86)']]) {
      if (directory && path.win32.isAbsolute(directory))
        roots.add(path.win32.join(directory, 'Git'));
    }
    if (env.LOCALAPPDATA && path.win32.isAbsolute(env.LOCALAPPDATA)) {
      roots.add(path.win32.join(env.LOCALAPPDATA, 'Programs', 'Git'));
    }
    for (const root of [...roots].slice(0, 8)) {
      const gitFiles = ['cmd/git.exe', 'bin/git.exe', 'mingw64/bin/git.exe', 'mingw32/bin/git.exe'];
      if (!gitFiles.some((file) => exists(path.win32.join(root, file)))) continue;
      if (!exists(path.win32.join(root, 'usr/bin/msys-2.0.dll'))) continue;
      candidates.push(
        path.win32.join(root, 'bin/bash.exe'),
        path.win32.join(root, 'usr/bin/bash.exe')
      );
    }
  } else candidates.push('/bin/bash');

  for (const candidate of [...new Set(candidates)]) {
    if (!exists(candidate)) continue;
    try {
      const executable = realpath(candidate);
      if (!(windows ? path.win32 : path.posix).isAbsolute(executable)) continue;
      const result = probe(executable, ['--version'], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 65536,
      });
      const version = typeof result.stdout === 'string' ? result.stdout : '';
      if (result.status !== 0 || result.signal || result.error) continue;
      if (!/^GNU bash, version /m.test(version)) continue;
      if (windows && !/\b(?:x86_64|i[3-6]86|aarch64)-pc-msys\b/.test(version)) continue;
      return { path: windows ? executable : candidate, reason: null };
    } catch {
      // An unavailable candidate must not suppress a later valid installation.
    }
  }
  return {
    path: null,
    reason: windows
      ? 'This POSIX test requires a usable Git Bash installation.'
      : 'This POSIX test requires /bin/bash.',
  };
}

/** Convert owned Windows fixture paths with the selected Git installation. */
export function toPosixBashPath(
  value,
  bashPath,
  { platform = process.platform, exists = existsSync, convert = spawnSync } = {}
) {
  if (platform !== 'win32') return value;
  if (!path.win32.isAbsolute(value) || !path.win32.isAbsolute(bashPath)) {
    throw new Error('Windows fixture paths and the Bash executable must be absolute.');
  }
  const directory = path.win32.dirname(bashPath);
  const candidates = [
    path.win32.join(directory, 'cygpath.exe'),
    path.win32.join(directory, '../usr/bin/cygpath.exe'),
  ];
  const cygpath = candidates.find((file) => exists(file));
  if (!cygpath) throw new Error('The selected Git Bash installation requires cygpath.');
  const result = convert(cygpath, ['-u', '--', value], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 2000,
    maxBuffer: 65536,
  });
  const converted = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  if (
    result.status !== 0 ||
    result.signal ||
    result.error ||
    !converted.startsWith('/') ||
    /[\r\n\0]/.test(converted)
  ) {
    throw new Error('Git Bash could not convert the Windows fixture path.');
  }
  return converted;
}

/** Quote one POSIX shell argument without expanding its contents. */
export function quotePosixShellArgument(value) {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new TypeError('A shell argument must be a string without NUL.');
  }
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

/** Fix the physical directory and command bindings before a fixture runs. */
export function createPosixFixtureIsolation({ directory, bin, bashPath }) {
  const cwd = toPosixBashPath(realpathSync(directory), bashPath);
  const fixtureBin = toPosixBashPath(realpathSync(bin), bashPath);
  const lines = [
    'set -euo pipefail',
    'unset BASH_ENV ENV',
    'export PATH=' + quotePosixShellArgument(fixtureBin + ':/usr/bin:/bin'),
    'builtin cd -- ' + quotePosixShellArgument(cwd),
    'if [ "$(builtin pwd -P)" != ' +
      quotePosixShellArgument(cwd) +
      ' ]; then builtin printf "Fixture directory mismatch\\n" >&2; exit 97; fi',
  ];
  for (const name of ['node', 'git', 'gh']) {
    const expected = fixtureBin + '/' + name;
    lines.push(
      'if [ "$(builtin command -v ' +
        name +
        ' || true)" != ' +
        quotePosixShellArgument(expected) +
        ' ]; then builtin printf "Fixture command mismatch: ' +
        name +
        '\\n" >&2; exit 97; fi'
    );
  }
  return { cwd, bin: fixtureBin, script: lines.join('\n') + '\n' };
}
