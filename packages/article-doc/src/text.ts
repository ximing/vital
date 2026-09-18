import type { ArticleDoc, ArticleInlineNode } from './types.js';

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
