import { test } from '@playwright/test';
import { realAdapterGate } from './realAdapterGate.ts';

realAdapterGate('vue', 'http://localhost:5274');
