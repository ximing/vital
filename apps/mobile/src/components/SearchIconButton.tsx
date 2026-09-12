import { router } from 'expo-router';
import { Search } from 'lucide-react-native';
import { copy } from '../lib/copy';
import { IconButton } from './IconButton';

/** 页头搜索入口：统一 IconButton 规格（spec §1.1）。 */
export function SearchIconButton() {
  return <IconButton icon={Search} label={copy.nav.search} onPress={() => router.push('/search')} />;
}
