import { lazy, Suspense, useState } from 'react';
import { useTranslation } from '@docx-editor.dev/react';
import { keepCaret } from './demoButtons';

const ServerAutomationRecipe = lazy(() =>
  import('./ServerAutomationRecipe').then((module) => ({ default: module.ServerAutomationRecipe }))
);

/**
 * Visible Server-panel launcher that keeps both editor-api entries out of the flagship
 * demo's initial bundle. The heavy recipe loads only when the panel is opened.
 */
export function ServerAutomationLauncher() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <aside
      className={`automation-recipes server-automation${open ? ' automation-recipes--open' : ''}`}
    >
      <button
        type="button"
        className="automation-recipes__toggle"
        aria-expanded={open}
        aria-label={open ? t('serverAutomation.hide') : t('serverAutomation.show')}
        title={open ? t('serverAutomation.hide') : t('serverAutomation.show')}
        onMouseDown={keepCaret}
        onClick={() => setOpen((current) => !current)}
      >
        {t('serverAutomation.badge')}
      </button>
      {open ? (
        <Suspense
          fallback={
            <div className="automation-recipes__card">
              <p>{t('serverAutomation.running')}</p>
            </div>
          }
        >
          <ServerAutomationRecipe onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </aside>
  );
}
