import type { ReactNode } from 'react';

function inline(source: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let index = 0;
  for (const match of source.matchAll(re)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push(source.slice(last, at));
    const token = match[0];
    const id = `${key}-${String(index)}`;
    index += 1;
    if (token.startsWith('`')) {
      nodes.push(
        <code key={id} className="rounded bg-surface-muted px-1 font-mono text-[0.92em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={id}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={id}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(
        <a key={id} href={match[6]} target="_blank" rel="noreferrer noopener" className="text-accent underline">
          {match[5]}
        </a>,
      );
    }
    last = at + token.length;
  }
  if (last < source.length) nodes.push(source.slice(last));
  return nodes;
}

/** Escape-free markdown: React text nodes only, links limited to http(s). */
export function ChatMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  const ids = { n: 0 };
  const nextKey = () => {
    ids.n += 1;
    return `md-${String(ids.n)}`;
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre key={nextKey()} className="overflow-x-auto rounded-md bg-surface-muted px-3 py-2 font-mono text-[length:var(--text-meta)]">
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const content = inline(heading[2] ?? '', nextKey());
      const className = level === 1 ? 'text-[length:var(--text-section)] font-semibold' : 'font-semibold';
      blocks.push(
        <p key={nextKey()} className={className}>
          {content}
        </p>,
      );
      i += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? '')) {
        items.push(<li key={nextKey()}>{inline((lines[i] ?? '').replace(/^[-*]\s+/, ''), nextKey())}</li>);
        i += 1;
      }
      blocks.push(
        <ul key={nextKey()} className="list-disc space-y-1 pl-5">
          {items}
        </ul>,
      );
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i] ?? '')) {
        items.push(<li key={nextKey()}>{inline((lines[i] ?? '').replace(/^\d+\.\s+/, ''), nextKey())}</li>);
        i += 1;
      }
      blocks.push(
        <ol key={nextKey()} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? '';
      if (
        current.trim() === '' ||
        current.startsWith('```') ||
        /^(#{1,3})\s+/.test(current) ||
        /^[-*]\s+/.test(current) ||
        /^\d+\.\s+/.test(current)
      ) {
        break;
      }
      para.push(current);
      i += 1;
    }
    blocks.push(
      <p key={nextKey()} className="whitespace-pre-wrap">
        {inline(para.join('\n'), nextKey())}
      </p>,
    );
  }

  return <div className="space-y-2 break-words">{blocks}</div>;
}
