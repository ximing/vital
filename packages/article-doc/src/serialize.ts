import { escapeXml } from './entities.js';
import type {
  ArticleBlockNode,
  ArticleDoc,
  ArticleInlineNode,
  ArticleMark,
} from './types.js';

/** Article doc → deterministic HTML. Used for inwit export and HTML consumers. */
export function articleDocToHtml(doc: ArticleDoc): string {
  return doc.content.map((block) => blockToHtml(block)).join('');
}

function blockToHtml(block: ArticleBlockNode): string {
  switch (block.type) {
    case 'paragraph':
      return `<p>${inlineToHtml(block.content)}</p>`;
    case 'heading':
      return `<h${String(block.attrs.level)}>${inlineToHtml(block.content)}</h${String(block.attrs.level)}>`;
    case 'blockquote':
      return `<blockquote>${block.content.map((child) => blockToHtml(child)).join('')}</blockquote>`;
    case 'codeBlock': {
      const text = block.content.map((node) => node.text).join('');
      const lang = block.attrs?.language;
      const cls = lang !== undefined && lang !== '' ? ` class="language-${escapeXml(lang)}"` : '';
      return `<pre><code${cls}>${escapeXml(text)}</code></pre>`;
    }
    case 'bulletList':
      return `<ul>${block.content.map((item) => listItemToHtml(item.content)).join('')}</ul>`;
    case 'orderedList': {
      const start = block.attrs?.start;
      const attr = start !== undefined && start > 1 ? ` start="${String(start)}"` : '';
      return `<ol${attr}>${block.content.map((item) => listItemToHtml(item.content)).join('')}</ol>`;
    }
    case 'horizontalRule':
      return '<hr>';
    case 'table':
      return `<table>${block.content
        .map(
          (row) =>
            `<tr>${row.content
              .map((cell) => {
                const tag = cell.type === 'tableHeader' ? 'th' : 'td';
                return `<${tag}>${cell.content.map((child) => blockToHtml(child)).join('')}</${tag}>`;
              })
              .join('')}</tr>`,
        )
        .join('')}</table>`;
    case 'image': {
      const alt = block.attrs.alt !== undefined ? ` alt="${escapeXml(block.attrs.alt)}"` : '';
      const width = block.attrs.width !== undefined ? ` width="${String(block.attrs.width)}"` : '';
      const height = block.attrs.height !== undefined ? ` height="${String(block.attrs.height)}"` : '';
      return `<p><img src="${escapeXml(block.attrs.src)}"${alt}${width}${height}></p>`;
    }
    case 'video': {
      const poster =
        block.attrs.poster !== undefined ? ` poster="${escapeXml(block.attrs.poster)}"` : '';
      const mime = block.attrs.mime !== undefined ? ` type="${escapeXml(block.attrs.mime)}"` : '';
      return `<p><video src="${escapeXml(block.attrs.src)}"${poster}${mime} controls playsinline></video></p>`;
    }
  }
}

function listItemToHtml(content: ArticleBlockNode[]): string {
  return `<li>${content.map((child) => blockToHtml(child)).join('')}</li>`;
}

function inlineToHtml(nodes: ArticleInlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'hardBreak') return '<br>';
      let out = escapeXml(node.text);
      for (const mark of [...(node.marks ?? [])].reverse()) out = wrapMark(mark, out);
      return out;
    })
    .join('');
}

function wrapMark(mark: ArticleMark, inner: string): string {
  switch (mark.type) {
    case 'bold':
      return `<strong>${inner}</strong>`;
    case 'italic':
      return `<em>${inner}</em>`;
    case 'underline':
      return `<u>${inner}</u>`;
    case 'strike':
      return `<s>${inner}</s>`;
    case 'code':
      return `<code>${inner}</code>`;
    case 'subscript':
      return `<sub>${inner}</sub>`;
    case 'superscript':
      return `<sup>${inner}</sup>`;
    case 'highlight':
      return `<mark>${inner}</mark>`;
    case 'link': {
      const title =
        mark.attrs.title !== undefined ? ` title="${escapeXml(mark.attrs.title)}"` : '';
      return `<a href="${escapeXml(mark.attrs.href)}"${title}>${inner}</a>`;
    }
  }
}
