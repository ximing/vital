import type { FastifyInstance } from 'fastify';
import { resolveAndroidRelease } from './app-release.service.js';

export function registerAppReleaseRoutes(app: FastifyInstance): void {
  /** Latest Android APK from GitHub Releases. `android` is null when none is published. */
  app.get('/api/v1/app/android', async () => ({ android: await resolveAndroidRelease() }));
}
