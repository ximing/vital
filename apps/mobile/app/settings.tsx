import { RequireAuth } from '../src/components/RequireAuth';
import { SettingsHome } from '../src/features/settings/SettingsHome';

export default function SettingsScreen() {
  return (
    <RequireAuth>
      <SettingsHome />
    </RequireAuth>
  );
}
