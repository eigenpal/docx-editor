import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react';
import { keepCaret } from './demoButtons';

export interface DemoHeaderButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` for the main action, `icon` for a button that shows only its icon. */
  readonly variant?: 'primary' | 'secondary' | 'icon';
  readonly keepEditorCaret?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
}

/**
 * One visual and focus contract for every action in the demo top bar. The look comes from
 * `examples/shared/demo-shell.css`, which the Vue example uses too.
 */
export function DemoHeaderButton({
  variant = 'secondary',
  keepEditorCaret = true,
  className,
  onMouseDown,
  ...props
}: DemoHeaderButtonProps) {
  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (keepEditorCaret) keepCaret(event);
    onMouseDown?.(event);
  };
  return (
    <button
      {...props}
      type="button"
      className={`demo-header-action demo-header-action--${variant}${
        className ? ` ${className}` : ''
      }`}
      onMouseDown={handleMouseDown}
    />
  );
}
