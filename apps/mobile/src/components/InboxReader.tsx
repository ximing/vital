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
import type { InboxAsset, InboxItem } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { isFileAsset, isSafeHref, isSafeHttpUrl, prepareArticleNodes } from '../lib/article';
import { isElement, textContent, type HtmlNode } from '../lib/html-ast';
import { copy } from '../lib/copy';
import { useTheme } from '../theme/use-theme';
import { Icon } from '../ui/icon';
import { READER_FONT_STEPS, type ReaderFontSize } from '../ui/reader-font';

const INLINE_TAGS = new Set([
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'del',
  'ins',
  'mark',
  'code',
  'a',
  'br',
  'sub',
  'sup',
  'abbr',
  'q',
  'cite',
  'small',
  'time',
  'kbd',
  'span',
]);

export function InboxReader({ item, size = 'md' }: { item: InboxItem; size?: ReaderFontSize }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const step = READER_FONT_STEPS[size];
  const nodes = useMemo(
    () => prepareArticleNodes(item.extractedHtml, item.extractedText, item.assets),
    [item.extractedHtml, item.extractedText, item.assets],
  );
  const fileAssets = item.assets.filter(isFileAsset);
  const body = step as TextStyle;

  if (nodes.length === 0 && fileAssets.length === 0) {
    return <Text style={[styles.muted, body]}>{copy.inbox.noBody}</Text>;
  }

  return (
    <View style={styles.wrap}>
      {fileAssets.map((asset) => (
        <ReaderFileAsset key={asset.id} asset={asset} styles={styles} />
      ))}
      {renderFlow(nodes, styles, body, 'r')}
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

function renderFlow(
  nodes: HtmlNode[],
  styles: ReturnType<typeof createStyles>,
  body: TextStyle,
  keyPrefix: string,
): ReactNode[] {
  const out: ReactNode[] = [];
  let inline: HtmlNode[] = [];

  const flush = (key: string): void => {
    if (inline.length === 0) return;
    out.push(
      <Text key={key} style={[styles.body, body]}>
        {renderInline(inline, styles, body)}
      </Text>,
    );
    inline = [];
  };

  nodes.forEach((node, i) => {
    const key = `${keyPrefix}.${i}`;
    if (node.type === 'text' || (isElement(node) && INLINE_TAGS.has(node.tag))) {
      inline.push(node);
      return;
    }
    flush(`${key}.t`);
    out.push(renderBlock(node, styles, body, key));
  });
  flush(`${keyPrefix}.end`);
  return out;
}

function renderBlock(
  node: HtmlNode,
  styles: ReturnType<typeof createStyles>,
  body: TextStyle,
  key: string,
): ReactNode {
  if (node.type === 'text') {
    return (
      <Text key={key} style={[styles.body, body]}>
        {node.value}
      </Text>
    );
  }
  switch (node.tag) {
    case 'p':
      return (
        <View key={key} style={styles.paragraph}>
          {renderFlow(node.children, styles, body, key)}
        </View>
      );
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return (
        <Text key={key} style={headingStyle(node.tag, styles)}>
          {renderInline(node.children, styles, body)}
        </Text>
      );
    case 'blockquote':
      return (
        <View key={key} style={styles.quote}>
          {renderFlow(node.children, styles, { ...body, ...styles.quoteText }, key)}
        </View>
      );
    case 'ul':
    case 'ol':
      return renderList(node, styles, body, key);
    case 'li':
      return (
        <View key={key} style={styles.paragraph}>
          {renderFlow(node.children, styles, body, key)}
        </View>
      );
    case 'pre':
      return (
        <ScrollView key={key} horizontal nestedScrollEnabled style={styles.pre}>
          <Text style={[styles.code, body]}>{textContent(node.children)}</Text>
        </ScrollView>
      );
    case 'hr':
      return <View key={key} style={styles.hr} />;
    case 'img':
      return <ArticleImage key={key} node={node} styles={styles} />;
    case 'figure':
      return (
        <View key={key} style={styles.figure}>
          {renderFlow(node.children, styles, body, key)}
        </View>
      );
    case 'figcaption':
      return (
        <Text key={key} style={[styles.caption, body]}>
          {renderInline(node.children, styles, body)}
        </Text>
      );
    case 'table':
      return renderTable(node, styles, body, key);
    case 'dl':
      return (
        <View key={key} style={styles.paragraph}>
          {renderFlow(node.children, styles, body, key)}
        </View>
      );
    case 'dt':
      return (
        <Text key={key} style={[styles.body, styles.bold, body]}>
          {renderInline(node.children, styles, body)}
        </Text>
      );
    case 'dd':
      return (
        <Text key={key} style={[styles.body, styles.muted, styles.dd, body]}>
          {renderInline(node.children, styles, body)}
        </Text>
      );
    case 'details':
    case 'summary':
      return (
        <View key={key} style={node.tag === 'details' ? styles.details : undefined}>
          {renderFlow(node.children, styles, body, key)}
        </View>
      );
    case 'video':
      return (
        <MediaLink key={key} href={videoSrc(node)} label="视频" styles={styles} body={body} />
      );
    default:
      return (
        <View key={key} style={styles.paragraph}>
          {renderFlow(node.children, styles, body, key)}
        </View>
      );
  }
}

function renderList(
  node: Extract<HtmlNode, { type: 'element' }>,
  styles: ReturnType<typeof createStyles>,
  body: TextStyle,
  key: string,
): ReactNode {
  const ordered = node.tag === 'ol';
  const start = Number(node.attrs.start ?? '1');
  let n = Number.isFinite(start) && start > 0 ? start : 1;
  const items = node.children.filter(
    (child): child is Extract<HtmlNode, { type: 'element' }> =>
      isElement(child) && child.tag === 'li',
  );
  return (
    <View key={key} style={styles.list}>
      {items.map((item, i) => {
        const mark = ordered ? `${n}.` : '·';
        n += 1;
        return (
          <View key={`${key}.${i}`} style={styles.li}>
            <Text style={[styles.body, styles.bullet, body]}>{mark}</Text>
            <View style={styles.liBody}>{renderFlow(item.children, styles, body, `${key}.${i}`)}</View>
          </View>
        );
      })}
    </View>
  );
}

function renderTable(
  node: Extract<HtmlNode, { type: 'element' }>,
  styles: ReturnType<typeof createStyles>,
  body: TextStyle,
  key: string,
): ReactNode {
  const rows = collectRows(node);
  return (
    <ScrollView key={key} horizontal nestedScrollEnabled style={styles.tableWrap}>
      <View>
        {rows.map((row, ri) => (
          <View key={`${key}.${ri}`} style={styles.tr}>
            {row.map((cell, ci) => (
              <View key={`${key}.${ri}.${ci}`} style={[styles.td, cell.header && styles.th]}>
                <Text style={[styles.body, body, cell.header && styles.bold]}>
                  {renderInline(cell.children, styles, body)}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function collectRows(
  node: Extract<HtmlNode, { type: 'element' }>,
): Array<Array<{ header: boolean; children: HtmlNode[] }>> {
  const rows: Array<Array<{ header: boolean; children: HtmlNode[] }>> = [];
  const walk = (nodes: HtmlNode[], header: boolean): void => {
    for (const child of nodes) {
      if (!isElement(child)) continue;
      if (child.tag === 'tr') {
        rows.push(
          child.children
            .filter(isElement)
            .filter((cell) => cell.tag === 'td' || cell.tag === 'th')
            .map((cell) => ({
              header: header || cell.tag === 'th',
              children: cell.children,
            })),
        );
        continue;
      }
      if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
        walk(child.children, child.tag === 'thead');
      }
    }
  };
  walk(node.children, false);
  return rows;
}

function renderInline(
  nodes: HtmlNode[],
  styles: ReturnType<typeof createStyles>,
  body: TextStyle,
): ReactNode[] {
  return nodes.map((node, i) => {
    if (node.type === 'text') return node.value;
    if (node.tag === 'br') return '\n';
    if (node.tag === 'strong' || node.tag === 'b') {
      return (
        <Text key={i} style={styles.bold}>
          {renderInline(node.children, styles, body)}
        </Text>
      );
    }
    if (node.tag === 'em' || node.tag === 'i') {
      return (
        <Text key={i} style={styles.italic}>
          {renderInline(node.children, styles, body)}
        </Text>
      );
    }
    if (node.tag === 'u' || node.tag === 'ins') {
      return (
        <Text key={i} style={styles.underline}>
          {renderInline(node.children, styles, body)}
        </Text>
      );
    }
    if (node.tag === 's' || node.tag === 'del') {
      return (
        <Text key={i} style={styles.strike}>
          {renderInline(node.children, styles, body)}
        </Text>
      );
    }
    if (node.tag === 'code' || node.tag === 'kbd') {
      return (
        <Text key={i} style={styles.code}>
          {textContent(node.children)}
        </Text>
      );
    }
    if (node.tag === 'a') {
      const href = node.attrs.href;
      const open = href !== undefined && isSafeHref(href);
      return (
        <Text
          key={i}
          style={styles.link}
          onPress={open ? () => void Linking.openURL(href).catch(() => undefined) : undefined}
          accessibilityRole={open ? 'link' : undefined}
        >
          {renderInline(node.children, styles, body)}
        </Text>
      );
    }
    if (node.tag === 'mark') {
      return (
        <Text key={i} style={styles.mark}>
          {renderInline(node.children, styles, body)}
        </Text>
      );
    }
    if (node.tag === 'sub' || node.tag === 'sup') {
      return (
        <Text key={i} style={node.tag === 'sup' ? styles.sup : styles.sub}>
          {renderInline(node.children, styles, body)}
        </Text>
      );
    }
    return (
      <Text key={i}>{renderInline(node.children, styles, body)}</Text>
    );
  });
}

function videoSrc(node: Extract<HtmlNode, { type: 'element' }>): string | undefined {
  if (node.attrs.src) return node.attrs.src;
  for (const child of node.children) {
    if (isElement(child) && child.tag === 'source' && child.attrs.src) return child.attrs.src;
  }
  return undefined;
}

function headingStyle(tag: string, styles: ReturnType<typeof createStyles>): TextStyle {
  if (tag === 'h1') return styles.h1;
  if (tag === 'h2') return styles.h2;
  return styles.h3;
}

function ArticleImage({
  node,
  styles,
}: {
  node: Extract<HtmlNode, { type: 'element' }>;
  styles: ReturnType<typeof createStyles>;
}) {
  const uri = node.attrs.src ?? '';
  const width = Number(node.attrs.width);
  const height = Number(node.attrs.height);
  const initial =
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
      ? width / height
      : 16 / 9;
  const [ratio, setRatio] = useState(initial);
  const [failed, setFailed] = useState(false);
  if (!isSafeHttpUrl(uri) || failed) return null;
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={node.attrs.alt || undefined}
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
    figure: { gap: t.space[2] },
    caption: { color: t.fgMuted, fontSize: 13 },
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
    dd: { paddingLeft: t.space[6] },
    details: {
      backgroundColor: t.bgSurfaceMuted,
      borderRadius: t.radius.md,
      padding: t.space[3],
      gap: t.space[2],
    },
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
