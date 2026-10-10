// The expedition permit: every Word content control, with pop-ups cut from ice.
//
// A document's controls carry their own sessions — a dropdown's items, a date's ISO value, a
// gallery's building blocks, a picture's drawing — and the engine paints a serviceable pop-up
// for each on its own. This file is what a product does instead: it takes those sessions
// through `popups` and renders them in its own shapes, over the same draft state
// (`useContentControlWidget`) and the same parts the packaged pop-up is built from. Nothing
// here re-implements a calendar, a listbox or an image write; the parts and the hook do the
// work, and the demo decides what they look like and what sits beside them.

import { useEffect, useRef, useState } from 'react';
import {
  DocxEditorContentControlWidget as Widget,
  useContentControlWidget,
  type DocxEditorPopups,
} from '@docx-editor.dev/react';
import type { ContentControlWidgetSession } from '@docx-editor.dev/core/editor';
import { announce } from './notice';

const Frost = ({ children }: { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const SnowflakeIcon = (
  <Frost>
    <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
  </Frost>
);

/**
 * A crew's list: the same `List`/`Item` parts, dressed as ice, with the block's category read
 * off the session for gallery picks so the safety briefs group under their heading.
 */
function IceList() {
  const widget = useContentControlWidget();
  const heading =
    widget.kind === 'buildingBlockGallery'
      ? 'From the expedition glossary'
      : widget.kind === 'comboBox'
        ? 'Pick one, or write your own'
        : 'Pick one';
  return (
    <>
      <div className="igloo-permit__heading" data-docx-part="heading">
        {SnowflakeIcon}
        <span>{heading}</span>
      </div>
      {widget.kind === 'comboBox' ? <Widget.Input className="igloo-permit__input" /> : null}
      {widget.items.length === 0 ? (
        <p className="igloo-permit__empty">This document carries no blocks for this gallery.</p>
      ) : (
        <Widget.List className="igloo-permit__list">
          {widget.items.map((item) => (
            <Widget.Item key={item.value} item={item} className="igloo-permit__item">
              <span className="igloo-permit__flake" aria-hidden="true">
                ❄
              </span>
              <span>{item.displayText}</span>
            </Widget.Item>
          ))}
        </Widget.List>
      )}
      <Widget.Error className="igloo-permit__error" />
      {widget.kind === 'comboBox' ? <Widget.Footer className="igloo-permit__footer" /> : null}
    </>
  );
}

/**
 * The date, picked with the OPERATING SYSTEM's own calendar: a native `<input type="date">`
 * opens the platform picker (macOS, Windows, iOS and Android each draw their own), and its
 * ISO value goes straight to `apply`. The packaged grid stays one toggle away for a host that
 * wants the same picker on every platform — that is the override, and either way the write,
 * the validation and the undo step are the engine's.
 */
function IceCalendar() {
  const widget = useContentControlWidget();
  const [native, setNative] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!native) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    // Chromium and WebKit open the platform picker on request; elsewhere the input itself is
    // the picker, which is the same thing one keystroke later.
    try {
      input.showPicker?.();
    } catch {
      // A picker that will not open here leaves the input, which still takes a typed date.
    }
  }, [native]);
  return (
    <>
      <div className="igloo-permit__heading" data-docx-part="heading">
        {SnowflakeIcon}
        <span>Departure</span>
        <button
          type="button"
          className="igloo-permit__switch"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => setNative((on) => !on)}
        >
          {native ? 'Ice calendar' : 'System picker'}
        </button>
      </div>
      {native ? (
        <div className="igloo-permit__native">
          <input
            ref={inputRef}
            type="date"
            className="igloo-permit__native-input"
            aria-label="Departure date"
            value={widget.value}
            disabled={!widget.isEnabled}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              if (event.target.value) widget.apply(event.target.value);
            }}
          />
        </div>
      ) : (
        <>
          <Widget.Header className="igloo-permit__calendar-header" />
          <Widget.Weekdays className="igloo-permit__weekdays" />
          <Widget.Grid className="igloo-permit__grid" />
        </>
      )}
      <div className="igloo-permit__calendar-actions">
        <Widget.Today asChild>
          <button type="button" className="igloo-permit__today">
            Freeze today
          </button>
        </Widget.Today>
        {native ? null : <Widget.Input className="igloo-permit__input" />}
      </div>
      <Widget.Error className="igloo-permit__error" />
      <Widget.Footer className="igloo-permit__footer" />
    </>
  );
}

/**
 * Three sled photos, carved on the spot: each tile rasterizes a small scene on a canvas and
 * hands the PNG bytes to the session. The last tile is the packaged `Picture` part, kept for
 * a file of the crew's own — the same input the packaged pop-up would open at once.
 */
const SCENES = [
  { id: 'dawn', name: 'Dawn over the floe', sky: ['#ffd7a8', '#7fc4e4'], sea: '#0d3149' },
  { id: 'noon', name: 'Noon on the shelf', sky: ['#bfe9ff', '#5fb3dd'], sea: '#134a6a' },
  { id: 'aurora', name: 'Aurora watch', sky: ['#0b1d3a', '#2fbf9a'], sea: '#061224' },
] as const;

function carveScene(scene: (typeof SCENES)[number]): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  const sky = ctx.createLinearGradient(0, 0, 0, 200);
  sky.addColorStop(0, scene.sky[0]);
  sky.addColorStop(1, scene.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 480, 200);
  ctx.fillStyle = scene.sea;
  ctx.fillRect(0, 200, 480, 120);
  // The berg: a white crown above the waterline, a paler mass below it.
  ctx.fillStyle = '#f4fbff';
  ctx.beginPath();
  ctx.moveTo(90, 200);
  ctx.lineTo(160, 90);
  ctx.lineTo(220, 140);
  ctx.lineTo(270, 60);
  ctx.lineTo(340, 150);
  ctx.lineTo(390, 200);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(190, 230, 250, 0.55)';
  ctx.beginPath();
  ctx.moveTo(60, 200);
  ctx.lineTo(420, 200);
  ctx.lineTo(300, 300);
  ctx.lineTo(170, 290);
  ctx.closePath();
  ctx.fill();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function IcePicture() {
  const widget = useContentControlWidget();
  const [busy, setBusy] = useState<string | null>(null);
  const carve = async (scene: (typeof SCENES)[number]) => {
    setBusy(scene.id);
    try {
      const blob = await carveScene(scene);
      if (blob) await widget.replaceImage(blob);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="igloo-permit__heading" data-docx-part="heading">
        {SnowflakeIcon}
        <span>Sled photo</span>
      </div>
      <div className="igloo-permit__scenes" role="group" aria-label="Carve a sled photo">
        {SCENES.map((scene) => (
          <button
            key={scene.id}
            type="button"
            className="igloo-permit__scene"
            disabled={!widget.isEnabled || busy !== null}
            aria-busy={busy === scene.id}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => void carve(scene)}
          >
            <span
              className="igloo-permit__scene-art"
              style={{
                background: `linear-gradient(${scene.sky[0]}, ${scene.sky[1]} 62%, ${scene.sea} 62%)`,
              }}
              aria-hidden="true"
            />
            <span>{scene.name}</span>
          </button>
        ))}
      </div>
      <label className="igloo-permit__upload">
        <span>Or a photo of your own</span>
        <Widget.Picture autoOpen={false} className="igloo-permit__file" />
      </label>
      {widget.refused ? (
        <p className="igloo-permit__error" role="alert">
          The engine refused that image. PNG, JPEG, GIF, BMP and WebP are welcome.
        </p>
      ) : null}
      {/* No Apply: a tile or a file is the commit, so the footer keeps only the way out. */}
      <Widget.Footer className="igloo-permit__footer">
        <Widget.Cancel />
      </Widget.Footer>
    </>
  );
}

/**
 * A checkbox press, taken through `contentControlCheckbox`: the toggle applies at once, as
 * Word's does, and the sled's inspector gets a word in the notice strip.
 */
function IceCheckbox({ session }: { session: ContentControlWidgetSession }) {
  useEffect(() => {
    if (session.signal.aborted) return;
    const next = session.value === 'true' ? 'false' : 'true';
    if (session.apply(next)) {
      announce(next === 'true' ? 'Sealed with a paw print.' : 'Unsealed. The cold waits.');
    }
  }, [session]);
  return null;
}

function IcePopup(props: { session: ContentControlWidgetSession }) {
  const { kind } = props.session;
  return (
    <Widget {...props} className="igloo-permit">
      {kind === 'date' ? <IceCalendar /> : kind === 'picture' ? <IcePicture /> : <IceList />}
    </Widget>
  );
}

/**
 * The `popups` entries the permit needs. Everything else keeps the packaged defaults. One
 * object at module scope: the map is configuration, like the modules list, not render state.
 */
export const PERMIT_POPUPS: DocxEditorPopups = {
  contentControlWidget: (props) => <IcePopup {...props} />,
  contentControlPicture: (props) => <IcePopup {...props} />,
  contentControlCheckbox: (props) => <IceCheckbox session={props.session} />,
};
