import { useMemo, useState, type ReactNode } from 'react';
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';
import { Paperclip } from 'lucide-react-native';
import {
  resolveDocMediaUrl,
  type ArticleBlockNode,
  type ArticleInlineNode,
  type ArticleMark,
} from '@vital/article-doc';
import type { InboxAsset, InboxItem } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { copy } from '../lib/copy';
import { useTheme } from '../theme/use-theme';
import { Icon } from '../ui/icon';
import { READER_FONT_STEPS, type ReaderFontSize } from '../ui/reader-font';

function isFileAsset(asset: InboxAsset): boolean {
  return (
    asset.mime === 'application/pdf' ||
    asset.mime.startsWith('video/') ||
    asset.mime.startsWith('audio/')
  );
}

function isSafeHttpUrl(src: string): boolean {
  return /^https?:\/\//i.test(src.trim());
}

export function InboxReader({ item, size = 'md' }: { item: InboxItem; size?: ReaderFontSize }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const step = READER_FONT_STEPS[size];
  const doc = item.contentJson;
  const fileAssets = item.assets.filter(isFileAsset);
  const body = step as TextStyle;

  if ((doc === null || doc.content.length === 0) && fileAssets.length === 0) {
    return <Text style={[styles.muted, body]}>{copy.inbox.noBody}</Text>;
  }

  return (
    <View style={styles.wrap}>
      {fileAssets.map((asset) => (
        <ReaderFileAsset key={asset.id} asset={asset} styles={styles} />
      ))}
      {doc !== null ? renderBlocks(doc.content, item.assets, styles, body, 'r') : null}
    </View>
  );
}

function ReaderFileAsset({
  asset,
  styles,
}: {
  asset: InboxAsset;
  styles: ReturnType<typeof createStyles>;
}) {
  const t = useTheme();
  const name = asset.originalSrc.split('/').pop() || asset.mime;
  if (!asset.url) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={name}
      onPress={() => void Linking.openURL(asset.url ?? '').catch(() => undefined)}
      style={({ pressed }) => [styles.fileRow, pressed && styles.pressed]}
    >
      <Icon icon={Paperclip} size={16} color={t.fgMuted} />
      <Text style={styles.fileName} numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
}

function renderBlocks(
  blocks: ArticleBlockNode[],
  assets: InboxAsset[],
  styles: ReturnType<typeof createStyles>,
  body: TextStyle,
  keyPrefix: string,
): ReactNode[] {
  return blocks.map((block, i) =>
    renderBlock(block, assets, styles, body, `${keyPrefix}.${String(i)}`),
  );
}

function renderBlock(
  block: ArticleBlockNode,
  assets: InboxAsset[],
  styles: ReturnType<typeof createStyles>,
  body: TextStyle,
  key: string,
): ReactNode {
  switch (block.type) {
    case 'paragraph':
      return (
        <View key={key} style={styles.paragraph}>
          <Text style={[styles.body, body]}>{renderInline(block.content, styles)}</Text>
        </View>
      );
    case 'heading':
      return (
        <Text key={key} style={headingStyle(block.attrs.level, styles)}>
          {renderInline(block.content, styles)}
        </Text>
      );
    case 'blockquote':
      return (
        <View key={key} style={styles.quote}>
          {renderBlocks(block.content, assets, styles, { ...body, ...styles.quoteText }, key)}
        </View>
      );
    case 'bulletList':
    case 'orderedList':
      return renderList(block, assets, styles, body, key);
    case 'codeBlock':
      return (
        <ScrollView key={key} horizontal nestedScrollEnabled style={styles.pre}>
          <Text style={[styles.code, body]}>{block.content.map((node) => node.text).join('')}</Text>
        </ScrollView>
      );
    case 'horizontalRule':
      return <View key={key} style={styles.hr} />;
    case 'image':
      return <ArticleImage key={key} block={block} assets={assets} styles={styles} />;
    case 'video': {
      const href = resolveDocMediaUrl(block.attrs.src, assets);
      return (
        <MediaLink key={key} href={href ?? undefined} label="视频" styles={styles} body={body} />
      );
    }
    case 'table':
      return (
        <ScrollView key={key} horizontal nestedScrollEnabled style={styles.tableWrap}>
          <View>
            {block.content.map((row, ri) => (
              <View key={`${key}.${String(ri)}`} style={styles.tr}>
                {row.content.map((cell, ci) => (
                  <View
                    key={`${key}.${String(ri)}.${String(ci)}`}
                    style={[styles.td, cell.type === 'tableHeader' && styles.th]}
                  >
                    {cell.content.map((child, bi) =>
                      child.type === 'paragraph' ? (
                        <Text
                          key={`${key}.${String(ri)}.${String(ci)}.${String(bi)}`}
                          style={[styles.body, body, cell.type === 'tableHeader' && styles.bold]}
                        >
                          {renderInline(child.content, styles)}
                        </Text>
                      ) : (
                        renderBlock(child, assets, styles, body, `${key}.${String(ri)}.${String(ci)}.${String(bi)}`)
                      ),
                    )}
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
  }
}

function renderList(
  block: Extract<ArticleBlockNode, { type: 'bulletList' | 'orderedList' }>,
  assets: InboxAsset[],
  styles: ReturnType<typeof createStyles>,
  body: TextStyle,
  key: string,
): ReactNode {
  const ordered = block.type === 'orderedList';
  let n = block.type === 'orderedList' ? (block.attrs?.start ?? 1) : 1;
  return (
    <View key={key} style={styles.list}>
      {block.content.map((item, i) => {
        const mark = ordered ? `${n}.` : '·';
        n += 1;
        return (
          <View key={`${key}.${String(i)}`} style={styles.li}>
            <Text style={[styles.body, styles.bullet, body]}>{mark}</Text>
            <View style={styles.liBody}>
              {renderBlocks(item.content, assets, styles, body, `${key}.${String(i)}`)}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function renderInline(
  nodes: ArticleInlineNode[],
  styles: ReturnType<typeof createStyles>,
): ReactNode[] {
  return nodes.map((node, i) => {
    if (node.type === 'hardBreak') return '\n';
    return applyMarks(node.text, node.marks ?? [], styles, i);
  });
}

function applyMarks(
  text: string,
  marks: ArticleMark[],
  styles: ReturnType<typeof createStyles>,
  key: number,
): ReactNode {
  if (marks.length === 0) return text;
  const [head, ...rest] = marks;
  if (head === undefined) return text;
  const inner = <>{applyMarks(text, rest, styles, key)}</>;
  switch (head.type) {
    case 'bold':
      return <Text key={key} style={styles.bold}>{inner}</Text>;
    case 'italic':
      return <Text key={key} style={styles.italic}>{inner}</Text>;
    case 'underline':
      return <Text key={key} style={styles.underline}>{inner}</Text>;
    case 'strike':
      return <Text key={key} style={styles.strike}>{inner}</Text>;
    case 'code':
      return <Text key={key} style={styles.code}>{inner}</Text>;
    case 'highlight':
      return <Text key={key} style={styles.mark}>{inner}</Text>;
    case 'subscript':
      return <Text key={key} style={styles.sub}>{inner}</Text>;
    case 'superscript':
      return <Text key={key} style={styles.sup}>{inner}</Text>;
    case 'link':
      return (
        <Text
          key={key}
          style={styles.link}
          onPress={() => void Linking.openURL(head.attrs.href).catch(() => undefined)}
          accessibilityRole="link"
        >
          {inner}
        </Text>
      );
  }
}

function headingStyle(level: number, styles: ReturnType<typeof createStyles>): TextStyle {
  if (level <= 1) return styles.h1;
  if (level === 2) return styles.h2;
  return styles.h3;
}

function ArticleImage({
  block,
  assets,
  styles,
}: {
  block: Extract<ArticleBlockNode, { type: 'image' }>;
  assets: InboxAsset[];
  styles: ReturnType<typeof createStyles>;
}) {
  const uri = resolveDocMediaUrl(block.attrs.src, assets) ?? '';
  const width = block.attrs.width;
  const height = block.attrs.height;
  const initial =
    width !== undefined && height !== undefined && width > 0 && height > 0
      ? width / height
      : 16 / 9;
  const [ratio, setRatio] = useState(initial);
  const [failed, setFailed] = useState(false);
  if (!isSafeHttpUrl(uri) || failed) return null;
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={block.attrs.alt ?? undefined}
      style={[styles.image, { aspectRatio: ratio }]}
      resizeMode="contain"
      onLoad={(event) => {
        const src = event.nativeEvent.source;
        if (src.width > 0 && src.height > 0) setRatio(src.width / src.height);
      }}
      onError={() => setFailed(true)}
    />
  );
}

function MediaLink({
  href,
  label,
  styles,
  body,
}: {
  href: string | undefined;
  label: string;
  styles: ReturnType<typeof createStyles>;
  body: TextStyle;
}) {
  if (href === undefined || !isSafeHttpUrl(href)) return null;
  return (
    <Text
      style={[styles.link, body]}
      accessibilityRole="link"
      onPress={() => void Linking.openURL(href).catch(() => undefined)}
    >
      {label}
    </Text>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { gap: 18 },
    paragraph: { gap: t.space[2] },
    h1: {
      fontSize: 22,
      lineHeight: 30,
      fontWeight: '600',
      color: t.fgPrimary,
    },
    h2: {
      fontSize: t.type.title.fontSize,
      lineHeight: t.type.title.lineHeight,
      fontWeight: '600',
      color: t.fgPrimary,
    },
    h3: {
      fontSize: t.type.section.fontSize,
      lineHeight: t.type.section.lineHeight,
      fontWeight: '600',
      color: t.fgPrimary,
    },
    body: {
      color: t.fgPrimary,
    },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    underline: { textDecorationLine: 'underline' },
    strike: { textDecorationLine: 'line-through' },
    mark: { backgroundColor: t.bgAccentSubtle },
    sup: { fontSize: 10, lineHeight: 14 },
    sub: { fontSize: 10, lineHeight: 14 },
    muted: { color: t.fgMuted },
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: t.accentPrimary,
      paddingLeft: 14,
      gap: t.space[2],
    },
    quoteText: { color: t.fgMuted },
    list: { gap: 4, paddingLeft: 2 },
    li: { flexDirection: 'row', gap: t.space[2], alignItems: 'flex-start' },
    bullet: { color: t.fgMuted, minWidth: 18 },
    liBody: { flex: 1, minWidth: 0, gap: t.space[1] },
    pre: {
      backgroundColor: t.bgSurfaceMuted,
      borderRadius: t.radius.md,
      padding: t.space[3],
    },
    code: {
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
      fontSize: 13,
      color: t.fgPrimary,
    },
    hr: { height: StyleSheet.hairlineWidth, backgroundColor: t.borderSubtle },
    image: {
      width: '100%',
      borderRadius: t.radius.md,
      backgroundColor: t.bgSurfaceMuted,
    },
    tableWrap: { maxWidth: '100%' },
    tr: { flexDirection: 'row' },
    td: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borderSubtle,
      paddingHorizontal: t.space[3],
      paddingVertical: t.space[2],
      minWidth: 72,
      maxWidth: 220,
    },
    th: { backgroundColor: t.bgSurfaceMuted },
    link: { color: t.accentPrimary, textDecorationLine: 'underline' },
    fileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space[2],
      minHeight: 40,
      borderRadius: t.radius.md,
      backgroundColor: t.bgSurfaceMuted,
      paddingHorizontal: t.space[3],
    },
    fileName: { flex: 1, minWidth: 0, fontSize: t.type.meta.fontSize, color: t.fgMuted },
    pressed: { opacity: 0.7 },
  });
