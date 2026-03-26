import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Ribbon - Show/Hide Marks', () => {
  test('toggle reveals non-printing markers', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();
    await editor.focus();

    await page.evaluate(() => {
      const root = document.querySelector('.docx-editor');
      if (!root) return;

      root.classList.remove('docx-show-marks');

      const existing = root.querySelector('.e2e-show-marks-probe');
      if (existing) existing.remove();

      const wrapper = document.createElement('div');
      wrapper.className = 'e2e-show-marks-probe';
      wrapper.style.position = 'absolute';
      wrapper.style.left = '-9999px';
      wrapper.style.top = '0';

      const bookmarkStart = document.createElement('span');
      bookmarkStart.className = 'docx-bookmark-start';
      bookmarkStart.setAttribute('data-bookmark-id', 'TestBookmark');

      const bookmarkEnd = document.createElement('span');
      bookmarkEnd.className = 'docx-bookmark-end';
      bookmarkEnd.setAttribute('data-bookmark-id', 'TestBookmark');

      const hiddenRun = document.createElement('span');
      hiddenRun.className = 'docx-run-hidden';
      hiddenRun.textContent = 'HiddenText';

      const tabRun = document.createElement('span');
      tabRun.className = 'docx-tab';
      tabRun.textContent = '\t';

      const softHyphen = document.createElement('span');
      softHyphen.className = 'docx-soft-hyphen';
      softHyphen.textContent = '\u00AD';

      const field = document.createElement('span');
      field.className = 'docx-field';
      field.textContent = 'Field';

      const sectionBreak = document.createElement('div');
      sectionBreak.className = 'docx-section-break';
      sectionBreak.setAttribute('data-section-break', 'Next Page');

      wrapper.appendChild(bookmarkStart);
      wrapper.appendChild(document.createTextNode('Visible'));
      wrapper.appendChild(bookmarkEnd);
      wrapper.appendChild(hiddenRun);
      wrapper.appendChild(tabRun);
      wrapper.appendChild(softHyphen);
      wrapper.appendChild(field);
      wrapper.appendChild(sectionBreak);

      root.appendChild(wrapper);
    });

    const getStyles = async () =>
      await page.evaluate(() => {
        const hiddenRun = document.querySelector('.docx-run-hidden') as HTMLElement | null;
        const bookmarkStart = document.querySelector('.docx-bookmark-start') as HTMLElement | null;
        const bookmarkEnd = document.querySelector('.docx-bookmark-end') as HTMLElement | null;
        const tabRun = document.querySelector('.docx-tab') as HTMLElement | null;
        const softHyphen = document.querySelector('.docx-soft-hyphen') as HTMLElement | null;
        const field = document.querySelector('.docx-field') as HTMLElement | null;
        const sectionBreak = document.querySelector('.docx-section-break') as HTMLElement | null;

        const style = (el: HTMLElement | null) => (el ? window.getComputedStyle(el).display : '');
        const marker = (el: HTMLElement | null) =>
          el ? window.getComputedStyle(el, '::before').content : '';
        const tabMarker = (el: HTMLElement | null) =>
          el ? window.getComputedStyle(el, '::after').content : '';
        const sectionMarker = (el: HTMLElement | null) =>
          el ? window.getComputedStyle(el, '::after').content : '';

        return {
          hiddenDisplay: style(hiddenRun),
          bookmarkStartMarker: marker(bookmarkStart),
          bookmarkEndMarker: marker(bookmarkEnd),
          tabMarker: tabMarker(tabRun),
          softHyphenMarker: tabMarker(softHyphen),
          fieldOutline: field ? window.getComputedStyle(field).outlineStyle : '',
          sectionMarker: sectionMarker(sectionBreak),
        };
      });

    const before = await getStyles();
    expect(before.hiddenDisplay).toBe('none');
    expect(before.bookmarkStartMarker).toBe('none');
    expect(before.bookmarkEndMarker).toBe('none');
    expect(before.tabMarker).toBe('none');
    expect(before.softHyphenMarker).toBe('none');
    expect(before.sectionMarker).toBe('none');

    await editor.clickRibbonButton('showMarks');

    const after = await getStyles();
    expect(after.hiddenDisplay).not.toBe('none');
    expect(after.bookmarkStartMarker).not.toBe('none');
    expect(after.bookmarkEndMarker).not.toBe('none');
    expect(after.tabMarker).not.toBe('none');
    expect(after.softHyphenMarker).not.toBe('none');
    expect(after.sectionMarker).not.toBe('none');
  });
});
