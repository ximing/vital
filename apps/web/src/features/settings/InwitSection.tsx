import { observer, useService } from '@rabjs/react';
import { useEffect, type FC } from 'react';
import { t } from '@/copy';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { SelectField } from '@/ui/select-field';
import { InwitSectionService } from './inwit.service';

export const InwitSection: FC = observer(function InwitSection() {
  const page = useService(InwitSectionService);

  useEffect(() => {
    void page.load();
  }, [page]);

  return (
    <div className="flex flex-col gap-4">
      {page.error ? <Banner>{page.error}</Banner> : null}
      {page.notice ? <Banner>{page.notice}</Banner> : null}
      <div className="flex flex-col gap-3 sm:max-w-md">
        <Field
          label={t.settings.inwit.baseUrl}
          value={page.baseUrl}
          placeholder={t.settings.inwit.baseUrlHint}
          autoComplete="url"
          onChange={(event) => page.setBaseUrl(event.target.value)}
        />
        <Field
          label={t.settings.inwit.accessKey}
          value={page.accessKey}
          placeholder={page.accessKeySet ? t.settings.inwit.accessKeySet : t.settings.inwit.accessKeyPlaceholder}
          type="password"
          autoComplete="new-password"
          onChange={(event) => page.setAccessKey(event.target.value)}
        />
        <div>
          <SelectField
            className="w-full"
            ariaLabel={t.settings.inwit.defaultTopic}
            value={page.defaultTopicId ?? ''}
            placeholder={t.settings.inwit.defaultTopicHint}
            disabled={page.topics.length === 0}
            options={page.topics.map((topic) => ({ value: topic.id, label: topic.title }))}
            onChange={(next) => page.setDefaultTopicId(next)}
          />
          <p className="mt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {t.settings.inwit.defaultTopicHint}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          loading={page.testing}
          disabled={!page.accessKeySet}
          onClick={() => void page.test()}
        >
          {page.testing ? t.settings.inwit.testing : t.settings.inwit.test}
        </Button>
        <Button loading={page.saving} onClick={() => void page.save()}>
          {t.settings.inwit.save}
        </Button>
      </div>
      {page.accessKey.trim() !== '' ? (
        <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {t.settings.inwit.saveBeforeTest}
        </p>
      ) : null}
      {!page.accessKeySet && !page.error ? (
        <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {t.settings.inwit.notConfigured}
        </p>
      ) : null}
    </div>
  );
});
