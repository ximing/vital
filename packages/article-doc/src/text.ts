import type {
  ArticleBlockNode,
  ArticleDoc,
  ArticleInlineNode,
  ArticleListItemNode,
} from './types.js';

/** Plain text → paragraph doc (`\n\n` splits paragraphs, single `\n` is a hard break). */
export function textToArticleDoc(text: string): ArticleDoc {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter((para) => para !== '');
  return {
    type: 'doc',
    content: paragraphs.map((para) => {
      const content: ArticleInlineNode[] = [];
      const lines = para.split('\n');
      lines.forEach((line, index) => {
        if (index > 0) content.push({ type: 'hardBreak' });
        if (line !== '') content.push({ type: 'text', text: line });
      });
      return { type: 'paragraph' as const, content };
    }),
  };
}

function inlineToText(nodes: ArticleInlineNode[]): string {
  return nodes
    .map((node) => (node.type === 'hardBreak' ? '\n' : node.text))
    .join('');
}

function listItemToText(item: ArticleListItemNode, bullet: string): string {
  const inner = item.content.map(blockToText).filter((part) => part !== '').join('\n');
  return inner === '' ? bullet : `${bullet}${inner}`;
}

function blockToText(block: ArticleBlockNode): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return inlineToText(block.content);
    case 'blockquote':
      return block.content.map(blockToText).filter((part) => part !== '').join('\n');
    case 'codeBlock':
      return block.content.map((node) => node.text).join('');
    case 'bulletList':
      return block.content.map((item) => listItemToText(item, '- ')).join('\n');
    case 'orderedList': {
      const start = block.attrs?.start ?? 1;
      return block.content
        .map((item, index) => listItemToText(item, `${String(start + index)}. `))
        .join('\n');
    }
    case 'horizontalRule':
      return '';
    case 'table':
      return block.content
        .map((row) =>
          row.content
            .map((cell) => cell.content.map(blockToText).filter((part) => part !== '').join(' '))
            .join('\t'),
        )
        .join('\n');
    case 'image':
      return block.attrs.alt ?? '';
    case 'video':
      return '';
  }
}

/** Flatten an article-doc to plain text for search / extractedText. */
export function articleDocToText(doc: ArticleDoc): string {
  return doc.content
    .map(blockToText)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join('\n\n');
}
