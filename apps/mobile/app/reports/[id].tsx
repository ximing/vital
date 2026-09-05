import { useLocalSearchParams } from 'expo-router';
import { RequireAuth } from '../../src/components/RequireAuth';
import { ReportEditor } from '../../src/features/reports/ReportEditor';

export default function ReportScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  return (
    <RequireAuth>
      <ReportEditor reportId={id} />
    </RequireAuth>
  );
}
