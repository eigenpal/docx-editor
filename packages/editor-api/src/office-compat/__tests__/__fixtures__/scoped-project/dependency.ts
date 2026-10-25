/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A file the program reaches but the project does not include: a type error in its body, and
// every kind of server-runtime reference the host scan reports, beside look-alikes it must not.
import fs from 'fs';
import { join } from 'node:path';
import legacy = require('fs');

const dependencyError: number = 'not a number';

export const fromDependency = 1;
export const hostModules = [fs, join, legacy, dependencyError];
export const hostGlobal = process.env;
export const hostMeta = import.meta.dir;
export const hostShorthand = { process };

// Not host references: a member, a property name, and a local declaration.
export const member = (globalThis as { process?: unknown }).process;
export const property = { process: 1 };
function require(id: string): string {
  return id;
}
export const local = require('x');
