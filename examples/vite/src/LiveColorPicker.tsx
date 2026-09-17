// One native color commitment is one gesture. The shared binding owns native terminal
// events; React's onChange only applies values. Native popup closure is not portable.
import { useState } from 'react';
import { useEditorValueCommand, useHistoryGroup, useTranslation } from '@docx-editor.dev/react';
import type { ExecResult } from '@docx-editor.dev/core';

export function LiveColorPicker() {
  const color = useEditorValueCommand('text.color');
  const gesture = useHistoryGroup({ kind: 'native-color' });
  const { t } = useTranslation();
  const [result, setResult] = useState<ExecResult | null>(null);
  return (
    <label className="demo-live-color" title={color.disabledReason ?? undefined}>
      <span>{t('formattingBar.fontColor')}</span>
      <input
        ref={gesture.ref}
        type="color"
        value={`#${color.value ?? '000000'}`}
        disabled={!color.isEnabled}
        onChange={(event) =>
          setResult(color.execute(event.currentTarget.value.slice(1), gesture.options()))
        }
      />
      <span className="demo-live-color__count" aria-live="polite">
        {color.value === null ? t('dialogs.paragraph.mixed') : `#${color.value}`}
        {result ? ` · ${result.ok ? (result.history?.kind ?? 'none') : result.reason}` : ''}
      </span>
    </label>
  );
}
