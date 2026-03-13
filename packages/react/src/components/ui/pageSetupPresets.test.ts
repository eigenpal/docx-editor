import { describe, it, expect } from 'bun:test';
import type { SectionProperties } from '@eigenpal/docx-core/types/document';
import {
  getMarginPresetId,
  getPageSizePresetId,
  getOrientation,
  buildMarginProps,
  buildOrientationProps,
  buildPageSizeProps,
} from './pageSetupPresets';

describe('pageSetupPresets', () => {
  it('matches default margins to Normal', () => {
    const props: SectionProperties = {
      marginTop: 1440,
      marginBottom: 1440,
      marginLeft: 1440,
      marginRight: 1440,
    };
    expect(getMarginPresetId(props)).toBe('normal');
  });

  it('returns custom for non-preset margins', () => {
    const props: SectionProperties = {
      marginTop: 1200,
      marginBottom: 1200,
      marginLeft: 1200,
      marginRight: 1200,
    };
    expect(getMarginPresetId(props)).toBe('custom');
  });

  it('detects landscape by orientation or width/height', () => {
    expect(getOrientation({ orientation: 'landscape' })).toBe('landscape');
    expect(getOrientation({ pageWidth: 15840, pageHeight: 12240 })).toBe('landscape');
  });

  it('builds size props respecting current orientation', () => {
    const current: SectionProperties = { pageWidth: 15840, pageHeight: 12240 };
    const next = buildPageSizeProps('a4', current);
    expect(next.pageWidth).toBeGreaterThan(next.pageHeight!);
  });

  it('builds orientation props by swapping size', () => {
    const current: SectionProperties = { pageWidth: 12240, pageHeight: 15840 };
    const next = buildOrientationProps('landscape', current);
    expect(next.pageWidth).toBe(15840);
    expect(next.pageHeight).toBe(12240);
  });

  it('builds margin props from preset', () => {
    const next = buildMarginProps('narrow');
    expect(next.marginTop).toBe(720);
    expect(next.marginLeft).toBe(720);
  });

  it('matches page size preset or custom', () => {
    const props: SectionProperties = { pageWidth: 12240, pageHeight: 15840 };
    expect(getPageSizePresetId(props)).toBe('letter');
  });
});
