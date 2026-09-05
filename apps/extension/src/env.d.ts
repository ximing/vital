/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly WXT_API_URL?: string;
  readonly WXT_WEB_URL?: string;
  readonly WXT_S3_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
