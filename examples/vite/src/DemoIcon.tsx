import { DEMO_ICONS, type DemoIconName } from '../../shared/demo-icons';

/** A stroke icon of the demo's own chrome. Decorative: the control names itself. */
export function DemoIcon({ name }: { name: DemoIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {DEMO_ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
