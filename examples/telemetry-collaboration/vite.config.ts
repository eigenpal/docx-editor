import { defineConfig } from 'vite';
import { telemetryExampleConfig } from '../telemetry-stack/client/vite-config.ts';

export default defineConfig(telemetryExampleConfig(5182));
