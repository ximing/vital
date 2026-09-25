import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Image, Linking, Platform, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { parseMarkdownToPmJSON, type PmMark, type PmNode } from '@vital/markdown';
import type { ReportEmbeds, TaskStatus } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { client } from '../lib/api';
import { chipLabel } from '../features/reports/chip-label';
import { useTheme } from '../theme/use-theme';
import { EntityChip } from './EntityChip';

const UPLOAD_REF =
  /^\/api\/v1\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function uploadIdOf(src: string): string | null {
  return UPLOAD_REF.exec(src.trim())?.[1]?.toLowerCase() ?? null;
}

function markStyle(marks: PmMark[] | undefined, styles: ReturnType<typeof createStyles>): TextStyle[] {
  const out: TextStyle[] = [];
  for (const mark of marks ?? []) {
    if (mark.type === 'bold') out.push(styles.bold);
    if (mark.type === 'italic') out.push(styles.italic);
    if (mark.type === 'strike') out.push(styles.strike);
    if (mark.type === 'code') out.push(styles.code);
    if (mark.type === 'link') out.push(styles.link);
  }
  return out;
}

function hrefOf(marks: PmMark[] | undefined): string | null {
  const link = marks?.find((mark) => mark.type === 'link');
  const href = link?.attrs?.href;
  return typeof href === 'string' && href !== '' ? href : null;
}

function UploadImage({ src, alt }: { src: string; alt: string }) {
  const t = useTheme();
  const [url, setUrl] = useState<string | null>(src.startsWith('http') ? src : null);
  const id = uploadIdOf(src);
  useEffect(() => {
    if (id === null) return;
    let cancel = false;
    void client
      .getUploadUrl(id)
      .then((res) => {
        if (!cancel) setUrl(res.url);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [id]);
  if (url === null) return null;
  return (
    <Image
      source={{ uri: url }}
      accessibilityLabel={alt}
      style={{ width: '100%', height: 180, borderRadius: t.radius.md, backgroundColor: t.bgSurfaceMuted }}
    />
  );
}

function Inline({
  nodes,
  styles,
  base,
}: {
  nodes: PmNode[];
  styles: ReturnType<typeof createStyles>;
  base: TextStyle;
}) {
  return (
    <Text style={base}>
      {nodes.map((node, index) => {
        if (node.type === 'hardBreak') return '\n';
        if (node.type !== 'text') return null;
        const href = hrefOf(node.marks);
        return (
          <Text
            key={index}
            style={markStyle(node.marks, styles)}
            onPress={href !== null ? () => void Linking.openURL(href) : undefined}
          >
            {node.text ?? ''}
          </Text>
        );
      })}
    </Text>
  );
}

function ParagraphBits({
  nodes,
  styles,
  embeds,
  onToggleTask,
  onOpenInbox,
}: {
  nodes: PmNode[];
  styles: ReturnType<typeof createStyles>;
  embeds?: ReportEmbeds;
  onToggleTask?: (id: string, status: TaskStatus) => void;
  onOpenInbox?: (id: string) => void;
}) {
  const chunks: Array<{ kind: 'text'; nodes: PmNode[] } | { kind: 'atom'; node: PmNode }> = [];
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'hardBreak') {
      const last = chunks[chunks.length - 1];
      if (last?.kind === 'text') last.nodes.push(node);
      else chunks.push({ kind: 'text', nodes: [node] });
    } else if (node.type === 'vitalEntity' || node.type === 'image') {
      chunks.push({ kind: 'atom', node });
    }
  }
  if (chunks.length === 0) return <Text style={styles.body}> </Text>;
  return chunks.map((chunk, index) => {
    if (chunk.kind === 'text') {
      return <Inline key={index} nodes={chunk.nodes} styles={styles} base={styles.body} />;
    }
    const atom = (
      <Atom node={chunk.node} embeds={embeds} onToggleTask={onToggleTask} onOpenInbox={onOpenInbox} />
    );
    if (chunk.node.type === 'image') {
      return (
        <View key={index} style={styles.imageWrap}>
          {atom}
        </View>
      );
    }
    return <View key={index}>{atom}</View>;
  });
}

function Blocks({
  nodes,
  styles,
  embeds,
  onToggleTask,
  onOpenInbox,
}: {
  nodes: PmNode[];
  styles: ReturnType<typeof createStyles>;
  embeds?: ReportEmbeds;
  onToggleTask?: (id: string, status: TaskStatus) => void;
  onOpenInbox?: (id: string) => void;
}): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.type}-${String(index)}`;
    if (node.type === 'heading') {
      const level = node.attrs?.level;
      const style = level === 2 ? styles.h2 : level === 3 ? styles.h3 : styles.h1;
      return <Inline key={key} nodes={node.content ?? []} styles={styles} base={style} />;
    }
    if (node.type === 'paragraph') {
      return (
        <View key={key} style={styles.line}>
          <ParagraphBits
            nodes={node.content ?? []}
            styles={styles}
            embeds={embeds}
            onToggleTask={onToggleTask}
            onOpenInbox={onOpenInbox}
          />
        </View>
      );
    }
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      return (
        <View key={key} style={styles.list}>
          {(node.content ?? []).map((item, itemIndex) => (
            <View key={`${key}-${String(itemIndex)}`} style={styles.listItem}>
              <Text style={styles.marker}>
                {node.type === 'orderedList' ? `${String(itemIndex + 1)}.` : '•'}
              </Text>
              <View style={styles.listBody}>
                <Blocks
                  nodes={item.content ?? []}
                  styles={styles}
                  embeds={embeds}
                  onToggleTask={onToggleTask}
                  onOpenInbox={onOpenInbox}
                />
              </View>
            </View>
          ))}
        </View>
      );
    }
    if (node.type === 'blockquote') {
      return (
        <View key={key} style={styles.quote}>
          <Blocks
            nodes={node.content ?? []}
            styles={styles}
            embeds={embeds}
            onToggleTask={onToggleTask}
            onOpenInbox={onOpenInbox}
          />
        </View>
      );
    }
    if (node.type === 'codeBlock') {
      const text = (node.content ?? []).map((child) => child.text ?? '').join('');
      return (
        <Text key={key} style={styles.codeBlock}>
          {text}
        </Text>
      );
    }
    if (node.type === 'image' || node.type === 'vitalEntity') {
      return (
        <Atom
          key={key}
          node={node}
          embeds={embeds}
          onToggleTask={onToggleTask}
          onOpenInbox={onOpenInbox}
        />
      );
    }
    if (node.content) {
      return (
        <Blocks
          key={key}
          nodes={node.content}
          styles={styles}
          embeds={embeds}
          onToggleTask={onToggleTask}
          onOpenInbox={onOpenInbox}
        />
      );
    }
    return null;
  });
}

function Atom({
  node,
  embeds,
  onToggleTask,
  onOpenInbox,
}: {
  node: PmNode;
  embeds?: ReportEmbeds;
  onToggleTask?: (id: string, status: TaskStatus) => void;
  onOpenInbox?: (id: string) => void;
}) {
  if (node.type === 'image') {
    const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
    const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
    if (src === '') return null;
    return <UploadImage src={src} alt={alt} />;
  }
  if (node.type !== 'vitalEntity' || embeds === undefined) return null;
  const kind = node.attrs?.kind === 'inbox' ? 'inbox' : 'task';
  const id = typeof node.attrs?.id === 'string' ? node.attrs.id : '';
  if (id === '') return null;
  const token = { kind, id, start: 0, end: 0 } as const;
  const status = kind === 'task' ? embeds.tasks[id]?.status : undefined;
  return (
    <EntityChip
      kind={kind}
      label={chipLabel(token, embeds)}
      status={status}
      onPress={() => {
        if (kind === 'task' && status !== undefined) onToggleTask?.(id, status);
        if (kind === 'inbox') onOpenInbox?.(id);
      }}
    />
  );
}

/** Render stored markdown (headings, marks, lists, links, images, report chips). */
export function MarkdownDoc({
  markdown,
  embeds,
  onToggleTask,
  onOpenInbox,
}: {
  markdown: string;
  embeds?: ReportEmbeds;
  onToggleTask?: (id: string, status: TaskStatus) => void;
  onOpenInbox?: (id: string) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const doc = useMemo(() => parseMarkdownToPmJSON(markdown), [markdown]);
  return (
    <View style={styles.wrap}>
      <Blocks
        nodes={doc.content ?? []}
        styles={styles}
        embeds={embeds}
        onToggleTask={onToggleTask}
        onOpenInbox={onOpenInbox}
      />
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { gap: t.space[2] },
    line: {
      width: '100%',
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: t.space[1],
    },
    imageWrap: { width: '100%' },
    body: { fontSize: 14, lineHeight: 22, color: t.fgPrimary },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    strike: { textDecorationLine: 'line-through' },
    code: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      backgroundColor: t.bgSurfaceMuted,
    },
    link: { color: t.accentPrimary, textDecorationLine: 'underline' },
    h1: { fontSize: 20, lineHeight: 28, fontWeight: '700', color: t.fgPrimary },
    h2: { fontSize: 17, lineHeight: 24, fontWeight: '700', color: t.fgPrimary },
    h3: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: t.fgPrimary },
    list: { gap: 4 },
    listItem: { flexDirection: 'row', alignItems: 'flex-start', gap: t.space[2] },
    listBody: { flex: 1, minWidth: 0 },
    marker: { width: 18, fontSize: 14, lineHeight: 22, color: t.fgMuted },
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: t.accentPrimary,
      paddingLeft: t.space[3],
    },
    codeBlock: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      lineHeight: 20,
      color: t.fgPrimary,
      backgroundColor: t.bgSurfaceMuted,
      borderRadius: t.radius.md,
      padding: t.space[3],
    },
  });
