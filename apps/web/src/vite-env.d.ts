/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TAURI_API_URL?: string;
}

interface Window {
  __TAURI_INTERNALS__?: unknown;
}

declare module '*.svg?react' {
  import type { FunctionComponent, SVGProps } from 'react';
  const component: FunctionComponent<SVGProps<SVGSVGElement>>;
  export default component;
}
