// The browser decode port converts EMF metafiles to SVG through the lazily loaded
// EMF renderer; WMF declines (null) so the resource layer keeps its labelled placeholder.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { convertBrowserMetafile } from '../browser-image-decode-port.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';

const LIMITS = resolveImageResourceLimits();

/** Header + EOF only; frame rectangle declares one inch square (2540 hundredth-mm). */
function minimalEmf(): Uint8Array {
  const bytes = new Uint8Array(108);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true); // EMR_HEADER
  view.setUint32(4, 88, true);
  view.setInt32(16, 96, true);
  view.setInt32(20, 96, true);
  view.setInt32(32, 2540, true);
  view.setInt32(36, 2540, true);
  view.setUint32(40, 0x464d_4520, true); // " EMF"
  view.setUint32(44, 0x0001_0000, true);
  view.setUint32(48, 108, true);
  view.setUint32(52, 2, true);
  view.setUint16(56, 1, true);
  view.setUint32(72, 96, true);
  view.setUint32(76, 96, true);
  view.setUint32(80, 25, true);
  view.setUint32(84, 25, true);
  view.setUint32(88, 14, true); // EMR_EOF
  view.setUint32(92, 20, true);
  view.setUint32(100, 16, true);
  view.setUint32(104, 20, true);
  return bytes;
}

describe('browser metafile conversion', () => {
  test('EMF converts to a bounded SVG at the frame size', async () => {
    const converted = await convertBrowserMetafile(minimalEmf(), 'image/x-emf', LIMITS);
    expect(converted).not.toBeNull();
    expect(converted!.pixelWidth).toBe(96);
    expect(converted!.pixelHeight).toBe(96);
    const markup = new TextDecoder().decode(converted!.svgBytes);
    expect(markup.startsWith('<svg')).toBe(true);
    expect(markup).toContain('viewBox="0 0 96 96"');
  });

  test('WMF declines so the placeholder label stays truthful', async () => {
    const converted = await convertBrowserMetafile(
      new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a]),
      'image/x-wmf',
      LIMITS
    );
    expect(converted).toBeNull();
  });

  test('a truncated EMF header throws instead of converting', async () => {
    await expect(
      convertBrowserMetafile(new Uint8Array([0x01, 0x00, 0x00, 0x00]), 'image/x-emf', LIMITS)
    ).rejects.toThrow();
  });
});
