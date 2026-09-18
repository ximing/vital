import { resolveDocMediaUrl, type ArticleBlockNode, type ArticleDoc, type ArticleInlineNode, type ArticleMark } from '@vital/article-doc';
import type { InboxAsset } from '@vital/dto';
import { Fragment, type ReactNode } from 'react';

/**
 * Article doc → React elements. Emits the same semantic tags the old purified
 * HTML did, so `.reader-article` CSS carries over unchanged.
 */
export function renderDoc(doc: ArticleDoc, assets: InboxAsset[]): ReactNode {
  return doc.content.map((block, index) => renderBlock(block, assets, index));
}

function renderBlock(block: ArticleBlockNode, assets: InboxAsset[], key: number): ReactNode {
  switch (block.type) {
    case 'paragraph':
      return <p key={key}>{renderInline(block.content)}</p>;
    case 'heading': {
      const level = Math.min(6, Math.max(1, block.attrs.level));
      const Tag = `h${String(level)}` as 'h1';
      return <Tag key={key}>{renderInline(block.content)}</Tag>;
    }
    case 'blockquote':
      return <blockquote key={key}>{block.content.map((child, i) => renderBlock(child, assets, i))}</blockquote>;
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{block.content.map((node) => node.text).join('')}</code>
        </pre>
      );
    case 'bulletList':
      return <ul key={key}>{block.content.map((item, i) => renderListItem(item.content, assets, i))}</ul>;
    case 'orderedList': {
      const start = block.attrs?.start;
      return (
        <ol key={key} {...(start !== undefined && start > 1 ? { start } : {})}>
          {block.content.map((item, i) => renderListItem(item.content, assets, i))}
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
                  return <Tag key={j}>{cell.content.map((child, k) => renderBlock(child, assets, k))}</Tag>;
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
      const poster = block.attrs.poster !== undefined ? resolveDocMediaUrl(block.attrs.poster, assets) : null;
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

function renderListItem(content: ArticleBlockNode[], assets: InboxAsset[], key: number): ReactNode {
  return <li key={key}>{content.map((child, i) => renderBlock(child, assets, i))}</li>;
}

function renderInline(nodes: ArticleInlineNode[]): ReactNode {
  return nodes.map((node, i) => {
    if (node.type === 'hardBreak') return <br key={i} />;
    const marks = node.marks ?? [];
    if (marks.length === 0) return node.text;
    return <Fragment key={i}>{applyMarks(node.text, marks)}</Fragment>;
  });
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
          <a href={mark.attrs.href} title={mark.attrs.title} target="_blank" rel="noopener noreferrer">
            {out}
          </a>
        );
        break;
    }
  }
  return out;
}
