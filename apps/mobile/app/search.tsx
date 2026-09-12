import { Redirect } from 'expo-router';
import { useAuth } from '../src/services/auth.service';
import { Loading } from '../src/components/Loading';
import { SearchHome } from '../src/features/search/SearchHome';

export default function SearchScreen() {
  const auth = useAuth();
  if (!auth.ready) return <Loading />;
  if (!auth.user) return <Redirect href="/login" />;
  return <SearchHome />;
}
