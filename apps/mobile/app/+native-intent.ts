import { routeForVitalPushUrl } from '../src/lib/push-link';

/** Keep Huawei taps off routes that do not exist, such as /task/:id. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return routeForVitalPushUrl(path) ?? path;
}
