import './styles.css';
import { createPocDocxFixture } from '../src/poc/docx';
import { createPocEditorDriver } from './driver';

const editableHost = document.querySelector<HTMLElement>('#editable-host');
const replicaHost = document.querySelector<HTMLElement>('#replica-host');
const statusHost = document.querySelector<HTMLElement>('#poc-status');

if (!editableHost || !replicaHost || !statusHost) {
  throw new Error('POC hosts are missing from the page');
}

const driver = createPocEditorDriver({ editableHost, replicaHost, statusHost });

document.querySelector<HTMLButtonElement>('#load-fixture')?.addEventListener('click', async () => {
  await driver.loadDocx(await createPocDocxFixture());
});

document.querySelector<HTMLButtonElement>('#toggle-bold')?.addEventListener('click', async () => {
  await driver.execute({ type: 'toggleMark', mark: 'bold' });
});

document.querySelector<HTMLButtonElement>('#toggle-italic')?.addEventListener('click', async () => {
  await driver.execute({ type: 'toggleMark', mark: 'italic' });
});

document.querySelector<HTMLButtonElement>('#undo-edit')?.addEventListener('click', async () => {
  await driver.undo();
});

document.querySelector<HTMLButtonElement>('#save-docx')?.addEventListener('click', async () => {
  await driver.save();
});

void (async () => {
  await driver.loadDocx(await createPocDocxFixture());
})();

declare global {
  interface Window {
    pocEditorDriver?: typeof driver;
  }
}

window.pocEditorDriver = driver;
