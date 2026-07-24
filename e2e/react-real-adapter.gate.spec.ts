import { test } from '@playwright/test';
import { realAdapterGate } from './realAdapterGate.ts';

realAdapterGate('react', 'http://localhost:5273');
