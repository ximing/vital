/** Local unpacked / `wxt` / `wxt build` / `wxt zip`. */
export const LOCAL_API_URL = 'http://localhost:3010';
export const LOCAL_WEB_URL = 'http://localhost:5180';

/** Chrome Web Store package (`VITAL_EXTENSION_TARGET=store`). */
export const STORE_ORIGIN = 'https://vital.aimo.plus';

export const DEFAULT_S3_ENDPOINT = 'https://s3.aimo.plus';

export interface ExtensionOrigins {
  apiUrl: string;
  webUrl: string;
  s3: string;
  outDir: string;
}

/** Node-side only (wxt.config). Do not call from extension runtime. */
export function resolveExtensionOrigins(
  env: Record<string, string | undefined> = process.env,
): ExtensionOrigins {
  const store = env.VITAL_EXTENSION_TARGET === 'store';
  return {
    apiUrl: env.WXT_API_URL ?? (store ? STORE_ORIGIN : LOCAL_API_URL),
    webUrl: env.WXT_WEB_URL ?? (store ? STORE_ORIGIN : LOCAL_WEB_URL),
    s3: env.WXT_S3_ENDPOINT ?? DEFAULT_S3_ENDPOINT,
    outDir: store ? 'dist-store' : 'dist',
  };
}
