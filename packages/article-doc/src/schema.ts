import { z } from 'zod';
import { isAllowedDocMediaSrc, isSafeHref } from './refs.js';
import type { ArticleDoc } from './types.js';

/** Serialized doc cap (mirrors the old 2MB extract HTML budget). */
export const MAX_CONTENT_JSON_BYTES = 2 * 1024 * 1024;

const hrefSchema = z
  .string()
  .max(2048)
  .refine(isSafeHref, 'http(s)/mailto href required');

const mediaSrcSchema = z
  .string()
  .max(4096)
  .refine(isAllowedDocMediaSrc, 'upload ref or http(s) src required');

const linkMarkSchema = z.object({
  type: z.literal('link'),
  attrs: z.object({
    href: hrefSchema,
    title: z.string().max(500).optional(),
  }),
});

const plainMarkSchema = z.object({
  type: z.enum([
    'bold',
    'italic',
    'underline',
    'strike',
    'code',
    'subscript',
    'superscript',
    'highlight',
  ]),
});

const markSchema = z.union([plainMarkSchema, linkMarkSchema]);

const textNodeSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(100_000),
  marks: z.array(markSchema).max(16).optional(),
});

const hardBreakSchema = z.object({ type: z.literal('hardBreak') });

const inlineNodeSchema = z.union([textNodeSchema, hardBreakSchema]);

const imageNodeSchema = z.object({
  type: z.literal('image'),
  attrs: z.object({
    src: mediaSrcSchema,
    alt: z.string().max(500).optional(),
    width: z.number().int().positive().max(100_000).optional(),
    height: z.number().int().positive().max(100_000).optional(),
  }),
});

const videoNodeSchema = z.object({
  type: z.literal('video'),
  attrs: z.object({
    src: mediaSrcSchema,
    poster: mediaSrcSchema.optional(),
    mime: z
      .string()
      .regex(/^[^\s"'{}]{1,127}$/)
      .optional(),
  }),
});

const MAX_BLOCKS = 5_000;
const MAX_INLINE = 5_000;

const blockNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('paragraph'),
      content: z.array(inlineNodeSchema).max(MAX_INLINE),
    }),
    z.object({
      type: z.literal('heading'),
      attrs: z.object({ level: z.number().int().min(1).max(6) }),
      content: z.array(inlineNodeSchema).max(MAX_INLINE),
    }),
    z.object({
      type: z.literal('blockquote'),
      content: z.array(blockNodeSchema).max(MAX_BLOCKS),
    }),
    z.object({
      type: z.literal('codeBlock'),
      attrs: z.object({ language: z.string().max(50).optional() }).optional(),
      content: z.array(textNodeSchema).max(1),
    }),
    z.object({
      type: z.literal('bulletList'),
      content: z.array(listItemSchema).max(MAX_BLOCKS),
    }),
    z.object({
      type: z.literal('orderedList'),
      attrs: z.object({ start: z.number().int().min(1).max(1_000_000).optional() }).optional(),
      content: z.array(listItemSchema).max(MAX_BLOCKS),
    }),
    z.object({ type: z.literal('horizontalRule') }),
    z.object({
      type: z.literal('table'),
      content: z.array(tableRowSchema).max(1_000),
    }),
    imageNodeSchema,
    videoNodeSchema,
  ]),
);

const listItemSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.literal('listItem'),
    content: z.array(blockNodeSchema).max(MAX_BLOCKS),
  }),
);

const tableRowSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.literal('tableRow'),
    content: z
      .array(
        z.object({
          type: z.enum(['tableHeader', 'tableCell']),
          content: z.array(blockNodeSchema).max(MAX_BLOCKS),
        }),
      )
      .max(100),
  }),
);

/** Inbound validation for client-supplied article docs. Unknown nodes/attrs are rejected. */
export const articleDocSchema = z
  .object({
    type: z.literal('doc'),
    content: z.array(blockNodeSchema).max(MAX_BLOCKS),
  })
  .refine((doc) => JSON.stringify(doc).length <= MAX_CONTENT_JSON_BYTES, {
    message: `doc exceeds ${String(MAX_CONTENT_JSON_BYTES)} bytes`,
  }) as unknown as z.ZodType<ArticleDoc>;
