/**
 * Article node closed set. Source is read as text so this stays DB-free.
 *
 * Vocabulary comes from `ArticleBlockNode` (aliases inlined) and `ArticleMark`.
 * Each consumer is the set of `case '...'` arms in that file. `missing` is the
 * vocabulary that file does not switch on. The allow lists freeze today's gaps:
 * a new union member fails until a case is added or the allow list is updated
 * on purpose. Adding a case that shrinks a gap fails the same way.
 *
 * `from-pm.ts` accepts marks with `===` inside `markOf`, not `case`, so its
 * mark gap is the whole set. `pmjson.ts` also switches on markdown AST names;
 * `code` and `link` therefore look covered even though those arms are not
 * article marks.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const CONSUMERS = [
  'packages/article-doc/src/serialize.ts',
  'packages/article-doc/src/from-pm.ts',
  'packages/article-doc/src/find.ts',
  'packages/article-doc/src/text.ts',
  'packages/article-doc/src/rebind.ts',
  'packages/markdown/src/pmjson.ts',
  'apps/web/src/features/inbox/ReaderDoc.tsx',
  'apps/mobile/src/components/InboxReader.tsx',
] as const;

/** Block types with no `case` arm in that file, sorted. */
const BLOCK_GAPS: Record<(typeof CONSUMERS)[number], readonly string[]> = {
  'packages/article-doc/src/serialize.ts': [],
  'packages/article-doc/src/from-pm.ts': [],
  'packages/article-doc/src/find.ts': ['horizontalRule', 'image', 'video'],
  'packages/article-doc/src/text.ts': [],
  'packages/article-doc/src/rebind.ts': ['codeBlock', 'heading', 'horizontalRule', 'paragraph'],
  'packages/markdown/src/pmjson.ts': ['video'],
  'apps/web/src/features/inbox/ReaderDoc.tsx': [],
  'apps/mobile/src/components/InboxReader.tsx': [],
};

/** Mark types with no `case` arm in that file, sorted. */
const MARK_GAPS: Record<(typeof CONSUMERS)[number], readonly string[]> = {
  'packages/article-doc/src/serialize.ts': [],
  'packages/article-doc/src/from-pm.ts': [
    'bold',
    'code',
    'highlight',
    'italic',
    'link',
    'strike',
    'subscript',
    'superscript',
    'underline',
  ],
  'packages/article-doc/src/find.ts': [
    'bold',
    'code',
    'highlight',
    'italic',
    'link',
    'strike',
    'subscript',
    'superscript',
    'underline',
  ],
  'packages/article-doc/src/text.ts': [
    'bold',
    'code',
    'highlight',
    'italic',
    'link',
    'strike',
    'subscript',
    'superscript',
    'underline',
  ],
  'packages/article-doc/src/rebind.ts': [
    'bold',
    'code',
    'highlight',
    'italic',
    'link',
    'strike',
    'subscript',
    'superscript',
    'underline',
  ],
  'packages/markdown/src/pmjson.ts': [
    'bold',
    'highlight',
    'italic',
    'strike',
    'subscript',
    'superscript',
    'underline',
  ],
  'apps/web/src/features/inbox/ReaderDoc.tsx': [],
  'apps/mobile/src/components/InboxReader.tsx': [],
};

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function typeAliasBody(source: string, name: string): string {
  const marker = `export type ${name} =`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing export type ${name}`);
  let depth = 0;
  for (let i = start + marker.length; i < source.length; i += 1) {
    const char = source.charAt(i);
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === ';' && depth === 0) return source.slice(start + marker.length, i);
  }
  throw new Error(`unterminated export type ${name}`);
}

/** Inline alias names that appear as union members (`| ArticleImageNode`). */
function expandUnionAliases(source: string, body: string): string {
  let text = body;
  const seen = new Set<string>();
  for (;;) {
    const refs = [
      ...new Set(
        [...text.matchAll(/(?:^|\|)\s*([A-Z][A-Za-z0-9]*)\b/g)].map((match) => match[1] ?? ''),
      ),
    ].filter((name) => name !== '' && !seen.has(name));
    if (refs.length === 0) return text;
    for (const name of refs) {
      if (!source.includes(`export type ${name} =`)) {
        throw new Error(`ArticleBlockNode alias ${name} has no export type to inline`);
      }
      text = text.replaceAll(name, `(${typeAliasBody(source, name)})`);
      seen.add(name);
    }
  }
}

function typeLiterals(body: string): string[] {
  return [...new Set([...body.matchAll(/type:\s*'([^']+)'/g)].map((match) => match[1] ?? ''))]
    .filter((literal) => literal !== '')
    .sort();
}

function caseArms(source: string): Set<string> {
  return new Set(
    [...stripComments(source).matchAll(/\bcase\s+'([^']+)'/g)].map((match) => match[1] ?? ''),
  );
}

function missingTypes(vocabulary: readonly string[], source: string): string[] {
  const arms = caseArms(source);
  return vocabulary.filter((name) => !arms.has(name));
}

describe('article node closed set', () => {
  const typesSource = stripComments(readRepo('packages/article-doc/src/types.ts'));
  const blockTypes = typeLiterals(
    expandUnionAliases(typesSource, typeAliasBody(typesSource, 'ArticleBlockNode')),
  );
  const markTypes = typeLiterals(typeAliasBody(typesSource, 'ArticleMark'));

  it('inlines block aliases into concrete type literals', () => {
    expect(blockTypes).toEqual([
      'blockquote',
      'bulletList',
      'codeBlock',
      'heading',
      'horizontalRule',
      'image',
      'orderedList',
      'paragraph',
      'table',
      'video',
    ]);
    expect(markTypes).toEqual([
      'bold',
      'code',
      'highlight',
      'italic',
      'link',
      'strike',
      'subscript',
      'superscript',
      'underline',
    ]);
  });

  it('records block cases each consumer is still missing', () => {
    const actual = Object.fromEntries(
      CONSUMERS.map((file) => [file, missingTypes(blockTypes, readRepo(file))]),
    );
    expect(actual).toEqual(BLOCK_GAPS);
  });

  it('records mark cases each consumer is still missing', () => {
    const actual = Object.fromEntries(
      CONSUMERS.map((file) => [file, missingTypes(markTypes, readRepo(file))]),
    );
    expect(actual).toEqual(MARK_GAPS);
  });
});
