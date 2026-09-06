import { RSRoot } from '@rabjs/react';
import type { ReactNode } from 'react';

export function RabRoot({ children }: { children: ReactNode }) {
  return <RSRoot>{children}</RSRoot>;
}
