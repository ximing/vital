import {
  pathKey,
  resolveDocMediaUrl,
  type ArticleBlockNode,
  type ArticleDoc,
  type ArticleFindHit,
  type ArticleInlineNode,
  type ArticleMark,
} from '@vital/article-doc';
import type { InboxAsset } from '@vital/dto';
import { ArrowUpRight } from 'lucide-react';
import { Fragment, type MouseEvent, type ReactNode } from 'react';
import { Icon } from '@/ui/icon';
import { Tip } from '@/ui/tip';
import { openArticleLink } from './reader-link';

/**
 * Article doc → React elements. Emits the same semantic tags the old purified
 * HTML did, so `.reader-article` CSS carries over unchanged.
 */
export type ArticleFindView = {
  hits: ArticleFindHit[];
  current: number;
};

export function renderDoc(
  doc: ArticleDoc,
  assets: InboxAsset[],
  find: ArticleFindView | null = null,
): ReactNode {
  return doc.content.map((block, index) => renderBlock(block, assets, [index], find));
}

function renderBlock(
  block: ArticleBlockNode,
  assets: InboxAsset[],
  path: number[],
  find: ArticleFindView | null,
): ReactNode {
  const key = path[path.length - 1] ?? 0;
  switch (block.type) {
    case 'paragraph':
      return <p key={key}>{renderInline(block.content, path, find)}</p>;
    case 'heading': {
      const level = Math.min(6, Math.max(1, block.attrs.level));
      const Tag = `h${String(level)}` as 'h1';
      return <Tag key={key}>{renderInline(block.content, path, find)}</Tag>;
    }
    case 'blockquote':
      return (
        <blockquote key={key}>
          {block.content.map((child, i) => renderBlock(child, assets, [...path, i], find))}
        </blockquote>
      );
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>
            {renderHighlighted(
              block.content.map((node) => node.text).join(''),
              [],
              0,
              hitsFor(path, find),
              find?.current ?? -1,
            )}
          </code>
        </pre>
      );
    case 'bulletList':
      return (
        <ul key={key}>
          {block.content.map((item, i) => renderListItem(item.content, assets, [...path, i], find))}
        </ul>
      );
    case 'orderedList': {
      const start = block.attrs?.start;
      return (
        <ol key={key} {...(start !== undefined && start > 1 ? { start } : {})}>
          {block.content.map((item, i) => renderListItem(item.content, assets, [...path, i], find))}
        </ol>
      );
    }
    case 'horizontalRule':
      return <hr key={key} />;
    case 'table':
      return (
        <table key={key}>
          <tbody>
            {block.content.map((row, i) => (
              <tr key={i}>
                {row.content.map((cell, j) => {
                  const Tag = cell.type === 'tableHeader' ? 'th' : 'td';
                  return (
                    <Tag key={j}>
                      {cell.content.map((child, k) =>
                        renderBlock(child, assets, [...path, i, j, k], find),
                      )}
                    </Tag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'image': {
      const url = resolveDocMediaUrl(block.attrs.src, assets);
      if (url === null) return null;
      return (
        <img
          key={key}
          src={url}
          alt={block.attrs.alt ?? ''}
          width={block.attrs.width}
          height={block.attrs.height}
          loading="lazy"
        />
      );
    }
    case 'video': {
      const url = resolveDocMediaUrl(block.attrs.src, assets);
      if (url === null) return null;
      const poster =
        block.attrs.poster !== undefined ? resolveDocMediaUrl(block.attrs.poster, assets) : null;
      return (
        <video
          key={key}
          src={url}
          controls
          playsInline
          {...(poster !== null ? { poster } : {})}
          {...(block.attrs.mime !== undefined ? { 'data-mime': block.attrs.mime } : {})}
        />
      );
    }
  }
}

function renderListItem(
  content: ArticleBlockNode[],
  assets: InboxAsset[],
  path: number[],
  find: ArticleFindView | null,
): ReactNode {
  return (
    <li key={path[path.length - 1] ?? 0}>
      {content.map((child, i) => renderBlock(child, assets, [...path, i], find))}
    </li>
  );
}

function hitsFor(path: number[], find: ArticleFindView | null): ArticleFindHit[] {
  if (!find) return [];
  const key = pathKey(path);
  return find.hits.filter((hit) => pathKey(hit.path) === key);
}

function renderInline(
  nodes: ArticleInlineNode[],
  path: number[],
  find: ArticleFindView | null,
): ReactNode {
  const hits = hitsFor(path, find);
  const current = find?.current ?? -1;
  let offset = 0;
  return nodes.map((node, i) => {
    if (node.type === 'hardBreak') {
      offset += 1;
      return <br key={i} />;
    }
    const start = offset;
    offset += node.text.length;
    return (
      <Fragment key={i}>
        {renderHighlighted(node.text, node.marks ?? [], start, hits, current)}
      </Fragment>
    );
  });
}

function renderHighlighted(
  text: string,
  marks: ArticleMark[],
  nodeStart: number,
  hits: ArticleFindHit[],
  current: number,
): ReactNode {
  const local = hits
    .map((hit) => ({
      index: hit.index,
      start: Math.max(hit.start, nodeStart) - nodeStart,
      end: Math.min(hit.end, nodeStart + text.length) - nodeStart,
    }))
    .filter((hit) => hit.start < hit.end)
    .sort((a, b) => a.start - b.start);
  if (local.length === 0) return applyMarks(text, marks);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [i, hit] of local.entries()) {
    if (hit.start > cursor) {
      parts.push(
        <Fragment key={`t${String(i)}`}>
          {applyMarks(text.slice(cursor, hit.start), marks)}
        </Fragment>,
      );
    }
    const currentHit = hit.index === current;
    parts.push(
      <span
        key={`h${String(i)}`}
        className={currentHit ? 'doc-find-hit doc-find-hit-current' : 'doc-find-hit'}
        data-find-current={currentHit ? 'true' : undefined}
      >
        {applyMarks(text.slice(hit.start, hit.end), marks)}
      </span>,
    );
    cursor = hit.end;
  }
  if (cursor < text.length) {
    parts.push(<Fragment key="tail">{applyMarks(text.slice(cursor), marks)}</Fragment>);
  }
  return <>{parts}</>;
}

function applyMarks(text: string, marks: ArticleMark[]): ReactNode {
  let out: ReactNode = text;
  for (const mark of [...marks].reverse()) {
    switch (mark.type) {
      case 'bold':
        out = <strong>{out}</strong>;
        break;
      case 'italic':
        out = <em>{out}</em>;
        break;
      case 'underline':
        out = <u>{out}</u>;
        break;
      case 'strike':
        out = <s>{out}</s>;
        break;
      case 'code':
        out = <code>{out}</code>;
        break;
      case 'subscript':
        out = <sub>{out}</sub>;
        break;
      case 'superscript':
        out = <sup>{out}</sup>;
        break;
      case 'highlight':
        out = <mark>{out}</mark>;
        break;
      case 'link':
        out = (
          <Tip label={mark.attrs.title}>
            <a
              href={mark.attrs.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event: MouseEvent<HTMLAnchorElement>) =>
                openArticleLink(event, mark.attrs.href)
              }
            >
              {out}
              <span className="reader-link-icon">
                <Icon icon={ArrowUpRight} size={12} />
              </span>
            </a>
          </Tip>
        );
        break;
    }
  }
  return out;
}
