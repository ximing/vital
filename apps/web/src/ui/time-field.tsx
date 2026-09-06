import type { InputHTMLAttributes } from 'react';
import { Field } from '@/ui/field';

export function TimeField({
  label,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string }) {
  return <Field {...props} label={label} type="time" />;
}
