import type { ArticleDoc } from '@vital/article-doc';
import type { InboxAsset } from '@vital/dto';
import { t } from '@/copy';
import { type ReaderSize } from './model';
import { renderDoc, type ArticleFindView } from './ReaderDoc';
import { isFileAsset, ReaderFileAsset } from './ReaderFileAsset';

function ReaderArticleBody({
  doc,
  assets,
  size,
  find,
}: {
  doc: ArticleDoc | null;
  assets: InboxAsset[];
  size: ReaderSize;
  find: ArticleFindView | null;
}) {
  if (doc === null || doc.content.length === 0) {
    return (
      <p className="text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
        {t.inbox.noBody}
      </p>
    );
  }

  return (
    <article className="reader-article" data-size={size}>
      {renderDoc(doc, assets, find)}
    </article>
  );
}

export function ReaderArticle(props: {
  doc: ArticleDoc | null;
  assets: InboxAsset[];
  size: ReaderSize;
  find?: ArticleFindView | null;
}) {
  const fileAssets = props.assets.filter(isFileAsset);
  return (
    <>
      {fileAssets.length > 0 ? (
        <div className="mb-6 flex flex-col gap-3">
          {fileAssets.map((a) => (
            <ReaderFileAsset key={a.id} asset={a} />
          ))}
        </div>
      ) : null}
      <ReaderArticleBody
        doc={props.doc}
        assets={props.assets}
        size={props.size}
        find={props.find ?? null}
      />
    </>
  );
}
