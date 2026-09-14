import type { FastifyInstance } from 'fastify';
import { resolveAndroidRelease, resolveAppLatest } from './app-release.service.js';

export function registerAppReleaseRoutes(app: FastifyInstance): void {
  /** Latest GitHub Release catalog (Android APK + desktop installers). `latest` is null when none is published. */
  app.get('/api/v1/app', async () => ({ latest: await resolveAppLatest() }));
  /** Latest Android APK from GitHub Releases. `android` is null when none is published. */
  app.get('/api/v1/app/android', async () => ({ android: await resolveAndroidRelease() }));
}
