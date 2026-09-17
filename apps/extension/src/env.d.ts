/// <reference types="vite/client" />

// TypeScript 7 requires side-effect-only imports to resolve (TS2882).
declare module "*.css";

interface ImportMetaEnv {
  readonly WXT_API_URL?: string;
  readonly WXT_WEB_URL?: string;
  readonly WXT_S3_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
