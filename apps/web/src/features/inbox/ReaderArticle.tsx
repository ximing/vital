import type { InboxAsset } from '@vital/dto';
import { useEffect, useState } from 'react';
import { t } from '@/copy';
import { type ReaderSize } from './model';
import { prepareReaderHtml, purifyInboxHtml, readerSourceHtml } from './purify';
import { ReaderFileAsset } from './ReaderFileAsset';

function isFileAsset(a: InboxAsset) {
  return (
    a.mime === 'application/pdf' ||
    a.mime.startsWith('video/') ||
    a.mime.startsWith('audio/')
  );
}

function ReaderArticleBody({
  html,
  text,
  assets,
  size,
}: {
  html: string | null;
  text: string | null;
  assets: InboxAsset[];
  size: ReaderSize;
}) {
  const [out, setOut] = useState(() => purifyInboxHtml(readerSourceHtml(html, text)));

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    void prepareReaderHtml(html, text, assets).then(
      (result) => {
        urls.push(...result.objectUrls);
        if (!cancelled) setOut(result.html);
      },
    );
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [html, text, assets]);

  if (out === '') {
    return (
      <p className="text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
        {t.inbox.noBody}
      </p>
    );
  }

  return (
    <article
      className="reader-article"
      data-size={size}
      // Purified in prepareReaderHtml (DOMPurify + asset rewrite).
      dangerouslySetInnerHTML={{ __html: out }}
    />
  );
}

export function ReaderArticle(props: {
  html: string | null;
  text: string | null;
  assets: InboxAsset[];
  size: ReaderSize;
}) {
  const assetKey = props.assets
    .map((asset) => `${asset.attachmentId}:${asset.originalSrc}`)
    .join('|');
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
        key={`${props.html ?? ''}\n${props.text ?? ''}\n${assetKey}`}
        html={props.html}
        text={props.text}
        assets={props.assets}
        size={props.size}
      />
    </>
  );
}
