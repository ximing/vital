/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
}

interface Window {
  __VITAL_HOST__?: import('./host').VitalHost;
  __VITAL_CLOSE_LAYER__?: () => boolean;
  __VITAL_UNDO_COMPLETE__?: () => boolean;
}

declare module '*.svg?react' {
  import type { FunctionComponent, SVGProps } from 'react';
  const component: FunctionComponent<SVGProps<SVGSVGElement>>;
  export default component;
}
