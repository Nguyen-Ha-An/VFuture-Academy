'use client';

import { useCallback, useEffect, useId, useRef, type ButtonHTMLAttributes, type AnchorHTMLAttributes, type ReactNode, type ComponentProps, type Ref } from 'react';
import { Button, IconButton } from '@instructure/ui-buttons/v11_7';
import { TextInput, type TextInputProps } from '@instructure/ui-text-input/v11_7';
import { TextArea, type TextAreaProps } from '@instructure/ui-text-area/v11_7';
import { SimpleSelect, type SimpleSelectProps } from '@instructure/ui-simple-select/v11_7';
import { Checkbox, type CheckboxProps } from '@instructure/ui-checkbox/v11_7';
import { Alert } from '@instructure/ui-alerts/v11_7';
import { Link } from '@instructure/ui-link/v11_7';
import { Spinner } from '@instructure/ui-spinner/v11_7';

export type CanvasButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg';
  renderIcon?: ReactNode; href?: string; ref?: Ref<HTMLElement>;
};
/** Real InstUI buttons, keeping existing Academy action handlers and disabled semantics. */
export function CanvasButton({ variant = 'default', size = 'default', disabled, type = 'button', children, onClick, renderIcon, ref, ...props }: CanvasButtonProps) {
  const color = variant === 'destructive' ? 'danger' : variant === 'default' ? 'primary' : 'secondary';
  const buttonSize = size === 'sm' || size === 'icon-sm' ? 'small' : size === 'lg' || size === 'icon-lg' ? 'large' : 'medium';
  const shared = { ...props, elementRef: (element: Element | null) => { if (typeof ref === 'function') ref(element as HTMLElement | null); else if (ref) ref.current = element as HTMLElement | null; }, type, color, size: buttonSize, interaction: disabled ? 'disabled' as const : 'enabled' as const, withBackground: variant !== 'ghost' && variant !== 'link' && variant !== 'outline', onClick: onClick as ComponentProps<typeof Button>['onClick'] };
  if (size.startsWith('icon')) return <IconButton {...shared as unknown as ComponentProps<typeof IconButton>} screenReaderLabel={props['aria-label'] ?? props.title ?? ''} renderIcon={renderIcon ?? children} />;
  return <Button {...shared as unknown as ComponentProps<typeof Button>} renderIcon={renderIcon}><span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', maxWidth: '100%' }}>{children}</span></Button>;
}

export type CanvasTextInputProps = Omit<TextInputProps, 'onChange' | 'renderLabel'> & {
  label?: ReactNode; renderLabel?: TextInputProps['renderLabel'];
  onChange?: (value: string) => void; disabled?: boolean; readOnly?: boolean; required?: boolean;
};
export function CanvasTextInput({ label, renderLabel, onChange, disabled, readOnly, required, interaction, ...props }: CanvasTextInputProps) {
  return <TextInput {...props} renderLabel={renderLabel ?? label} isRequired={required ?? props.isRequired} interaction={disabled ? 'disabled' : readOnly ? 'readonly' : interaction} onChange={(_event, value) => onChange?.(value)} />;
}
export type CanvasTextAreaProps = Omit<TextAreaProps, 'onChange' | 'label'> & { label?: ReactNode; renderLabel?: ReactNode; onChange?: (value: string) => void };
export function CanvasTextArea({ label, renderLabel, onChange, ...props }: CanvasTextAreaProps) {
  return <TextArea {...props} label={renderLabel ?? label} onChange={event => onChange?.(event.target.value)} />;
}
export type CanvasSelectOption = { value: string; label: string; disabled?: boolean };
export type CanvasSelectProps = Omit<SimpleSelectProps, 'onChange' | 'renderLabel' | 'children'> & {
  label?: ReactNode; renderLabel?: SimpleSelectProps['renderLabel']; options: CanvasSelectOption[];
  onChange?: (value: string) => void; disabled?: boolean; readOnly?: boolean; required?: boolean;
};
export function CanvasSelect({ label, renderLabel, options, onChange, disabled, readOnly, required, interaction, mountNode, inputRef, ...props }: CanvasSelectProps) {
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const setInputRef = useCallback((element: HTMLInputElement | null) => {
    input.current = element;
    inputRef?.(element);
  }, [inputRef]);
  // A body portal escapes Radix's pointer and focus scope. Mount beside modal content,
  // outside its inner scrolling fields; explicit caller containers still take priority.
  const modalMountNode = useCallback(() => input.current?.closest('[role="dialog"], [role="alertdialog"]')
    ?? input.current?.ownerDocument.body ?? (typeof document === 'undefined' ? null : document.body), []);
  useEffect(() => {
    const ownerWindow = input.current?.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const keepFirstEscapeInSelect = (event: KeyboardEvent) => {
      const element = input.current;
      // InstUI closes the options on keyup. Prevent the containing Radix modal's
      // document-capture keydown dismissal, while allowing native select handling.
      if (event.key === 'Escape' && event.target === element && element?.getAttribute('aria-expanded') === 'true'
        && element.closest('[role="dialog"], [role="alertdialog"]')) event.preventDefault();
    };
    ownerWindow.addEventListener('keydown', keepFirstEscapeInSelect, true);
    return () => ownerWindow.removeEventListener('keydown', keepFirstEscapeInSelect, true);
  }, []);
  return <SimpleSelect {...props} inputRef={setInputRef} mountNode={mountNode !== undefined ? mountNode : modalMountNode} renderLabel={renderLabel ?? label} isRequired={required ?? props.isRequired} interaction={disabled ? 'disabled' : readOnly ? 'readonly' : interaction} onChange={(_event, option) => { if (option.value !== undefined) onChange?.(String(option.value)); }}>{options.map((option, index) => <SimpleSelect.Option key={option.value} id={`${id}-option-${index}`} value={option.value} isDisabled={option.disabled}>{option.label}</SimpleSelect.Option>)}</SimpleSelect>;
}
export type CanvasCheckboxProps = Omit<CheckboxProps, 'onChange'> & { onChange?: (checked: boolean) => void };
export function CanvasCheckbox({ onChange, ...props }: CanvasCheckboxProps) { return <Checkbox {...props} onChange={event => onChange?.(event.target.checked)} />; }
export function CanvasAlert({ children, variant = 'info', ...props }: Omit<ComponentProps<typeof Alert>, 'hasShadow'> & { hasShadow?: boolean }) { return <Alert {...props} variant={variant} hasShadow={props.hasShadow ?? false} transition="none">{children}</Alert>; }
export function CanvasSpinner(props: ComponentProps<typeof Spinner>) { return <Spinner {...props} />; }
export type CanvasLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'color' | 'onClick'> & { onClick?: ComponentProps<typeof Link>['onClick']; renderIcon?: ComponentProps<typeof Link>['renderIcon']; variant?: 'inline' | 'standalone' };
export function CanvasLink({ children, ...props }: CanvasLinkProps) { return <Link {...props as unknown as ComponentProps<typeof Link>}>{children}</Link>; }
