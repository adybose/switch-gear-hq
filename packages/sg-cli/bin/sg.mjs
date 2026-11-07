#!/usr/bin/env node
// Runs the TypeScript source directly through tsx (a root dev dependency), so `sg` works
// from a fresh clone after `npm install` without a build step.
import { register } from 'tsx/esm/api';

register();
await import('../src/index.ts');
