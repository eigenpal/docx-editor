/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const localPython = fileURLToPath(new URL('../../.local-validation/runtime/bin/python', import.meta.url));
const python = process.env.VALIDATION_PYTHON || (existsSync(localPython) ? localPython : 'python3');
const child = spawn(python, [fileURLToPath(new URL('./server.py', import.meta.url)), ...process.argv.slice(2).filter((arg) => arg !== '--')], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (!child.killed) child.kill(signal); });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
