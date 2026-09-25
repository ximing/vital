import type { SimilarTaskHit } from '@vital/dto';
import { PickerOption, PickerSheet } from '../../components/PickerSheet';
import { copy } from '../../lib/copy';

/** After creating a task, offer the open tasks that look like it. */
export function SimilarOpenSheet({
  hits,
  onClose,
  onOpen,
}: {
  hits: SimilarTaskHit[];
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <PickerSheet visible={hits.length > 0} title={copy.todos.similarOpenPrefix} onClose={onClose}>
      {hits.map((hit) => (
        <PickerOption
          key={hit.id}
          label={hit.title}
          onPress={() => {
            onClose();
            onOpen(hit.id);
          }}
        />
      ))}
    </PickerSheet>
  );
}
