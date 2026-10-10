import { spawnSync as spawnBashQuoteFixture } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {
  resolvePosixBash,
  toPosixBashPath,
  quotePosixShellArgument,
  createPosixFixtureIsolation,
} from './posix-bash-provider.mjs';

const root = 'C:\\Program Files\\Git';
const win = (file) => path.win32.join(root, file);
const msysVersion = 'GNU bash, version 5.2.26(1)-release (x86_64-pc-msys)\n';

function fixture(files, responses = new Map()) {
  const calls = [];
  return {
    calls,
    options: {
      platform: 'win32',
      env: {
        PATH: 'C:\\Windows\\system32;C:\\Program Files\\Git\\cmd',
        ProgramFiles: 'C:\\Program Files',
      },
      exists: (file) => files.has(file),
      realpath: (file) => file,
      probe: (file, args, options) => {
        calls.push({ file, args, options });
        return responses.get(file) ?? { status: 0, signal: null, stdout: msysVersion };
      },
    },
  };
}

test('selects verified Git Bash despite an earlier Windows WSL launcher', () => {
  const source = fixture(
    new Set([
      'C:\\Windows\\system32\\bash.exe',
      win('cmd/git.exe'),
      win('usr/bin/msys-2.0.dll'),
      win('bin/bash.exe'),
    ])
  );
  assert.deepEqual(resolvePosixBash(source.options), { path: win('bin/bash.exe'), reason: null });
  assert.equal(source.calls.length, 1);
  assert.deepEqual(source.calls[0].args, ['--version']);
  assert.equal(source.calls[0].options.windowsHide, true);
  assert.equal(source.calls[0].options.timeout, 2000);
  assert.equal(source.calls[0].options.maxBuffer, 65536);
});

test('reports absence instead of launching the Windows system Bash command', () => {
  const source = fixture(new Set(['C:\\Windows\\system32\\bash.exe']));
  assert.equal(resolvePosixBash(source.options).path, null);
  assert.match(resolvePosixBash(source.options).reason, /requires a usable Git Bash/);
  assert.deepEqual(source.calls, []);
});

test('does not treat a same-name executable outside a Git installation as Git Bash', () => {
  const source = fixture(new Set([win('bin/bash.exe')]));
  assert.equal(resolvePosixBash(source.options).path, null);
  assert.deepEqual(source.calls, []);
});

test('rejects Linux WSL Bash output inside a misleading candidate path', () => {
  const source = fixture(
    new Set([win('cmd/git.exe'), win('usr/bin/msys-2.0.dll'), win('bin/bash.exe')]),
    new Map([
      [win('bin/bash.exe'), { status: 0, stdout: 'GNU bash, version 5.2 (x86_64-pc-linux-gnu)\n' }],
    ])
  );
  assert.equal(resolvePosixBash(source.options).path, null);
});

test('tries the real usr/bin shell after an unusable bin wrapper', () => {
  const source = fixture(
    new Set([
      win('cmd/git.exe'),
      win('usr/bin/msys-2.0.dll'),
      win('bin/bash.exe'),
      win('usr/bin/bash.exe'),
    ]),
    new Map([[win('bin/bash.exe'), { status: 1, stdout: msysVersion }]])
  );
  assert.equal(resolvePosixBash(source.options).path, win('usr/bin/bash.exe'));
  assert.equal(source.calls.length, 2);
});

test('handles a relocated Git installation from the actual Git PATH entry', () => {
  const portable = 'D:\\Portable Git';
  const files = new Set(
    ['cmd/git.exe', 'usr/bin/msys-2.0.dll', 'bin/bash.exe'].map((file) =>
      path.win32.join(portable, file)
    )
  );
  const source = fixture(files);
  source.options.env = { PATH: `"${path.win32.join(portable, 'cmd')}";C:\\Windows\\system32` };
  assert.equal(resolvePosixBash(source.options).path, path.win32.join(portable, 'bin/bash.exe'));
});

test('preserves the existing non-Windows /bin/bash path', () => {
  const source = fixture(new Set(['/bin/bash']));
  source.options.platform = 'linux';
  source.options.env = { PATH: '/usr/local/bin:/usr/bin' };
  source.options.probe = () => ({
    status: 0,
    signal: null,
    stdout: 'GNU bash, version 5.2 (x86_64-pc-linux-gnu)\n',
  });
  assert.deepEqual(resolvePosixBash(source.options), { path: '/bin/bash', reason: null });
});

test('keeps /bin/bash as the non-Windows entry point when it is a symlink', () => {
  const source = fixture(new Set(['/bin/bash']));
  source.options.platform = 'linux';
  source.options.env = {};
  source.options.realpath = () => '/usr/bin/bash';
  source.options.probe = (file) => {
    assert.equal(file, '/usr/bin/bash');
    return { status: 0, stdout: 'GNU bash, version 5.2 (x86_64-pc-linux-gnu)\n' };
  };
  assert.equal(resolvePosixBash(source.options).path, '/bin/bash');
});

test('does not hide a failed or timed-out version probe as shell availability', () => {
  for (const response of [
    { status: null, signal: 'SIGTERM', stdout: msysVersion },
    { status: 0, error: new Error('probe failed'), stdout: msysVersion },
  ]) {
    const source = fixture(
      new Set([win('cmd/git.exe'), win('usr/bin/msys-2.0.dll'), win('bin/bash.exe')]),
      new Map([[win('bin/bash.exe'), response]])
    );
    assert.equal(resolvePosixBash(source.options).path, null);
  }
});

test('converts Windows paths with the selected Git cygpath and preserves spaces', () => {
  const native = 'C:\\Fixtures\\Space Here\\pr.md';
  const calls = [];
  const converted = toPosixBashPath(native, win('bin/bash.exe'), {
    platform: 'win32',
    exists: (file) => file === win('usr/bin/cygpath.exe'),
    convert: (file, args, options) => {
      calls.push({ file, args, options });
      return { status: 0, signal: null, stdout: '/c/Fixtures/Space Here/pr.md\n' };
    },
  });
  assert.equal(converted, '/c/Fixtures/Space Here/pr.md');
  assert.equal(calls[0].file, win('usr/bin/cygpath.exe'));
  assert.deepEqual(calls[0].args, ['-u', '--', native]);
  assert.equal(calls[0].options.windowsHide, true);
});

test('does not guess a drive mapping when cygpath fails', () => {
  assert.throws(
    () =>
      toPosixBashPath('C:\\Fixtures\\pr.md', win('bin/bash.exe'), {
        platform: 'win32',
        exists: (file) => file === win('usr/bin/cygpath.exe'),
        convert: () => ({ status: 1, stdout: '' }),
      }),
    /could not convert/
  );
  assert.equal(toPosixBashPath('/tmp/pr.md', '/bin/bash', { platform: 'linux' }), '/tmp/pr.md');
});

test('quoted fixture paths retain spaces, apostrophes, and shell metacharacters', (context) => {
  const host = resolvePosixBash();
  if (host.path === null) {
    context.skip(host.reason);
    return;
  }
  const value = '/c/Temporary User/O\'Brien/$(printf INJECTED); * " #';
  const result = spawnBashQuoteFixture(
    host.path,
    ['-c', 'printf "%s" ' + quotePosixShellArgument(value)],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000,
      maxBuffer: 65536,
    }
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, value);
});

test('shell argument quoting refuses an embedded NUL', () => {
  assert.throws(() => quotePosixShellArgument('body\0file'), TypeError);
});

async function withIsolatedBashFixture(context, action) {
  const host = resolvePosixBash();
  if (host.path === null) {
    context.skip(host.reason);
    return;
  }
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "posix-fixture O'Brien "))
  );
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  try {
    for (const name of ['node', 'git', 'gh']) {
      fs.writeFileSync(path.join(bin, name), '#!/bin/bash\nexit 99\n');
      fs.chmodSync(path.join(bin, name), 0o755);
    }
    await action({ fs, path, directory, bin, host });
  } finally {
    if (
      fs.realpathSync(directory) !== directory ||
      !path.basename(directory).startsWith("posix-fixture O'Brien ")
    ) {
      throw new Error('Refusing cleanup outside the owned fixture.');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('fixture guards override launcher PATH and move to the physical owned directory', async (context) => {
  await withIsolatedBashFixture(context, ({ directory, bin, host }) => {
    const isolation = createPosixFixtureIsolation({ directory, bin, bashPath: host.path });
    const result = spawnBashQuoteFixture(
      host.path,
      ['-c', isolation.script + 'builtin printf "ISOLATED:%s" "$(builtin pwd -P)"'],
      {
        cwd: process.cwd(),
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !['bash_env', 'env'].includes(key.toLowerCase())
          )
        ),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 2000,
        maxBuffer: 65536,
      }
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'ISOLATED:' + isolation.cwd);
  });
});

test('a missing fake git stops before any fixture body can execute', async (context) => {
  await withIsolatedBashFixture(context, ({ fs, path, directory, bin, host }) => {
    const isolation = createPosixFixtureIsolation({ directory, bin, bashPath: host.path });
    fs.rmSync(path.join(bin, 'git'));
    const result = spawnBashQuoteFixture(
      host.path,
      ['-c', isolation.script + 'builtin printf "UNREACHABLE"'],
      {
        cwd: process.cwd(),
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !['bash_env', 'env'].includes(key.toLowerCase())
          )
        ),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 2000,
        maxBuffer: 65536,
      }
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 97);
    assert.match(result.stderr, /Fixture command mismatch: git/);
    assert.equal(result.stdout, '');
  });
});
