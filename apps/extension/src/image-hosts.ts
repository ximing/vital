/** Optional origins declared in the manifest. Requested on save so the SW can
 * fetch article CDNs (WeChat mmbiz etc.) without a required `<all_urls>`. */
export const IMAGE_HOST_PERMISSIONS = ['http://*/*', 'https://*/*'] as const;

export async function requestImageHostAccess(): Promise<boolean> {
  const origins = [...IMAGE_HOST_PERMISSIONS];
  try {
    if (await chrome.permissions.contains({ origins })) return true;
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}
