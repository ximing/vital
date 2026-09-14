import { bindServices, useService } from '@rabjs/react';
import type { AppLatestRelease, DesktopAsset, DesktopAssetId } from '@vital/dto';
import { useEffect, type FC, type ReactNode } from 'react';
import { Link } from 'react-router';
import { HOME_PATH, t } from '@/copy';
import { resolveTheme } from '@/lib/theme';
import { LandingPageService } from '@/pages/landing.service';
import { AuthService } from '@/services/auth.service';
import { ThemeService } from '@/services/theme.service';
import { ThemeSwitch } from '@/shell/ThemeToggle';
import { VitalMark } from '@/shell/VitalMark';
import './landing.css';

const GITHUB = 'https://github.com/ximing/vital';

function scrollFolio(dir: -1 | 1): void {
  const el = document.querySelector<HTMLElement>('.landing-folio-scroller');
  if (!el) return;
  const cards = [...el.children] as HTMLElement[];
  if (cards.length === 0) return;
  const origin = el.getBoundingClientRect().left;
  const positions = cards.map((card) => card.getBoundingClientRect().left - origin + el.scrollLeft);
  let index = 0;
  for (let i = 0; i < positions.length; i += 1) {
    if ((positions[i] ?? 0) <= el.scrollLeft + 40) index = i;
  }
  const nextIndex = Math.max(0, Math.min(cards.length - 1, index + dir));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollTo({ left: positions[nextIndex] ?? 0, behavior: reduced ? 'auto' : 'smooth' });
}

type Family = 'web' | 'macos' | 'windows' | 'linux' | 'android';

function detectFamily(): Family {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/Mac/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) return 'macos';
  if (/Win/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'linux';
  return 'web';
}

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function assetById(catalog: AppLatestRelease | null, id: DesktopAssetId): DesktopAsset | undefined {
  return catalog?.desktop.find((item) => item.id === id);
}

const TEXT_LINK =
  'text-fg underline decoration-accent/50 underline-offset-4 transition-[color,text-decoration-color] duration-[var(--ease-out)] hover:decoration-accent';

function HeaderLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex h-9 items-center rounded-md px-3 text-[length:var(--text-meta)] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
    >
      {children}
    </Link>
  );
}

function TocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="text-[length:var(--text-caption)] text-muted transition-colors hover:text-fg"
    >
      {children}
    </a>
  );
}

function Plate({
  src,
  alt,
  caption,
  className = '',
}: {
  src: string;
  alt: string;
  caption?: string;
  className?: string;
}) {
  return (
    <figure className={`landing-plate ${className}`.trim()}>
      <img src={src} alt={alt} />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

function Folio({
  slides,
}: {
  slides: { src: string; alt: string; caption: string; phone?: boolean }[];
}) {
  return (
    <section id="folio" className="landing-folio border-y border-border">
      <div className="landing-frame flex flex-wrap items-end justify-between gap-3 pb-6">
        <div>
          <h2 className="font-display text-[length:var(--text-title)] font-semibold tracking-[-0.03em]">
            {t.landing.folioTitle}
          </h2>
          <p className="mt-1 text-[length:var(--text-caption)] text-muted">{t.landing.folioHint}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            data-folio="prev"
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[length:var(--text-meta)] text-muted transition-colors hover:bg-surface-muted hover:text-fg"
            onClick={() => scrollFolio(-1)}
          >
            {t.landing.folioPrev}
          </button>
          <button
            type="button"
            data-folio="next"
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[length:var(--text-meta)] text-muted transition-colors hover:bg-surface-muted hover:text-fg"
            onClick={() => scrollFolio(1)}
          >
            {t.landing.folioNext}
          </button>
        </div>
      </div>
      <div className="landing-folio-scroller" tabIndex={0} aria-label={t.landing.folioTitle}>
        {slides.map((slide) => (
          <Plate
            key={slide.src}
            src={slide.src}
            alt={slide.alt}
            caption={slide.caption}
            className={`landing-folio-slide ${slide.phone ? 'is-phone' : ''}`}
          />
        ))}
      </div>
    </section>
  );
}

function DownloadRow({
  family,
  title,
  hint,
  href,
  size,
  preferred,
  download,
}: {
  family: Family;
  title: string;
  hint: string;
  href: string | null;
  size?: string;
  preferred: boolean;
  download?: boolean;
}) {
  return (
    <li
      data-family={family}
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-border py-3.5 last:border-b-0 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto] ${
        preferred ? 'bg-accent-subtle/60' : ''
      }`}
    >
      <p className="px-1 font-display text-[length:var(--text-body)] font-semibold leading-[var(--text-body-lh)] sm:px-0">
        {title}
        {preferred ? (
          <span className="ml-2 align-middle text-[11px] font-medium text-accent">{t.landing.recommended}</span>
        ) : null}
      </p>
      <p className="col-start-1 px-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted sm:col-start-2 sm:px-0">
        {hint}
        {size ? <span className="ml-2 font-mono tabular-nums text-tertiary">{size}</span> : null}
      </p>
      {href ? (
        download ? (
          <a
            href={href}
            className={`${TEXT_LINK} col-start-2 row-span-2 justify-self-end sm:col-start-3 sm:row-span-1`}
          >
            {t.landing.download}
          </a>
        ) : (
          <Link
            to={href}
            className={`${TEXT_LINK} col-start-2 row-span-2 justify-self-end sm:col-start-3 sm:row-span-1`}
          >
            {t.landing.openWeb}
          </Link>
        )
      ) : (
        <span className="col-start-2 row-span-2 justify-self-end text-[length:var(--text-caption)] text-tertiary sm:col-start-3 sm:row-span-1">
          {t.landing.missing}
        </span>
      )}
    </li>
  );
}

function Cta({ signedIn }: { signedIn: boolean }) {
  if (signedIn) {
    return (
      <Link
        to={HOME_PATH}
        className="inline-flex h-10 items-center rounded-md bg-accent-deep px-4 text-[length:var(--text-meta)] font-medium text-on-accent transition-[background-color] duration-[var(--ease-out)] hover:bg-accent-hover"
      >
        {t.landing.enter}
      </Link>
    );
  }
  return (
    <>
      <Link
        to="/register"
        className="inline-flex h-10 items-center rounded-md bg-accent-deep px-4 text-[length:var(--text-meta)] font-medium text-on-accent transition-[background-color] duration-[var(--ease-out)] hover:bg-accent-hover"
      >
        {t.landing.start}
      </Link>
      <Link
        to="/login"
        className="inline-flex h-10 items-center rounded-md px-3 text-[length:var(--text-meta)] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
      >
        {t.nav.login}
      </Link>
    </>
  );
}

function LandingContent() {
  const page = useService(LandingPageService);
  const auth = useService(AuthService);
  const theme = useService(ThemeService);
  const signedIn = Boolean(auth.user);
  const catalog = page.catalog;
  const preferred = detectFamily();
  const dark = resolveTheme(theme.choice) === 'dark';

  useEffect(() => {
    page.load();
  }, [page]);

  const todaySrc = dark ? '/marketing/today-dark.png' : '/marketing/today.png';
  const todosSrc = dark ? '/marketing/todos-dark.png' : '/marketing/todos.png';
  const readerSrc = dark ? '/marketing/inbox-reader-dark.png' : '/marketing/inbox-reader.png';

  const arm = assetById(catalog, 'macos-arm');
  const intel = assetById(catalog, 'macos-intel');
  const exe = assetById(catalog, 'windows-exe');
  const msi = assetById(catalog, 'windows-msi');
  const deb = assetById(catalog, 'linux-deb');
  const appimage = assetById(catalog, 'linux-appimage');
  const rpm = assetById(catalog, 'linux-rpm');
  const apk = catalog?.android;

  return (
    <div className="landing" data-page="landing">
      <header className="sticky top-0 z-20 border-b border-border bg-canvas/90 backdrop-blur-md">
        <div className="landing-frame flex h-14 items-center gap-3">
          <Link to="/" className="flex items-center gap-2 text-fg" aria-label={t.brand.wordmark}>
            <VitalMark className="h-7 w-7 text-accent" />
            <span className="font-display text-[length:var(--text-title)] font-semibold tracking-[-0.03em]">
              {t.brand.wordmark}
            </span>
          </Link>
          <nav className="ml-4 hidden items-center gap-4 md:flex" aria-label={t.brand.wordmark}>
            <TocLink href="#today">{t.landing.tocToday}</TocLink>
            <TocLink href="#todos">{t.landing.tocTodos}</TocLink>
            <TocLink href="#inbox">{t.landing.tocInbox}</TocLink>
            <TocLink href="#folio">{t.landing.tocFolio}</TocLink>
            <TocLink href="#download">{t.landing.downloads}</TocLink>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-md px-3 text-[length:var(--text-meta)] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
            >
              {t.landing.github}
            </a>
            <ThemeSwitch variant="rail" />
            {signedIn ? (
              <Link
                to={HOME_PATH}
                className="inline-flex h-9 items-center rounded-md bg-accent-deep px-3.5 text-[length:var(--text-meta)] font-medium text-on-accent transition-[background-color] duration-[var(--ease-out)] hover:bg-accent-hover"
              >
                {t.landing.enter}
              </Link>
            ) : (
              <>
                <HeaderLink to="/login">{t.nav.login}</HeaderLink>
                <Link
                  to="/register"
                  className="inline-flex h-9 items-center rounded-md bg-accent-deep px-3.5 text-[length:var(--text-meta)] font-medium text-on-accent transition-[background-color] duration-[var(--ease-out)] hover:bg-accent-hover"
                >
                  {t.landing.start}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="landing-cover">
          <div className="landing-frame landing-cover-grid">
            <div>
              <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-accent">
                {t.landing.heroLead}
              </p>
              <h1 className="mt-3 font-display text-[clamp(2.6rem,7vw,4.35rem)] font-bold leading-[1.08] tracking-[-0.045em]">
                {t.landing.hero}
              </h1>
              <p className="mt-6 max-w-[34rem] text-[length:var(--text-body)] leading-[1.7] text-muted">
                {t.landing.body}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Cta signedIn={signedIn} />
              </div>
            </div>
            <div className="landing-collage">
              <Plate src={todaySrc} alt={t.landing.screenshotAlt} className="is-main" />
              <Plate src={readerSrc} alt={t.landing.plates.reader} className="is-offset" />
              <Plate src="/marketing/mobile-today.png" alt={t.landing.plates.mobile} className="is-phone" />
            </div>
          </div>
        </section>

        <section className="border-y border-border">
          <div className="landing-frame">
            <blockquote className="landing-quote">{t.landing.quote}</blockquote>
          </div>
        </section>

        <section id="today" className="landing-frame landing-spread">
          <div className="landing-spread-copy">
            <p className="text-[length:var(--text-meta)] text-accent">{t.landing.spread.today.kicker}</p>
            <h2 className="mt-2 font-display text-[clamp(1.6rem,3vw,2.15rem)] font-semibold leading-[1.2] tracking-[-0.03em]">
              {t.landing.spread.today.title}
            </h2>
            <p className="mt-4 text-[length:var(--text-body)] leading-[1.7] text-muted">{t.landing.spread.today.body}</p>
          </div>
          <Plate src={todaySrc} alt={t.landing.screenshotAlt} caption={t.landing.plates.today} />
        </section>

        <section id="todos" className="border-y border-border">
          <div className="landing-frame landing-spread is-flip">
            <div className="landing-spread-copy">
              <p className="text-[length:var(--text-meta)] text-accent">{t.landing.spread.todos.kicker}</p>
              <h2 className="mt-2 font-display text-[clamp(1.6rem,3vw,2.15rem)] font-semibold leading-[1.2] tracking-[-0.03em]">
                {t.landing.spread.todos.title}
              </h2>
              <p className="mt-4 text-[length:var(--text-body)] leading-[1.7] text-muted">{t.landing.spread.todos.body}</p>
            </div>
            <Plate src={todosSrc} alt={t.landing.plates.todos} caption={t.landing.plates.todos} />
          </div>
        </section>

        <section id="inbox" className="landing-frame landing-spread">
          <div className="landing-spread-copy">
            <p className="text-[length:var(--text-meta)] text-accent">{t.landing.spread.inbox.kicker}</p>
            <h2 className="mt-2 font-display text-[clamp(1.6rem,3vw,2.15rem)] font-semibold leading-[1.2] tracking-[-0.03em]">
              {t.landing.spread.inbox.title}
            </h2>
            <p className="mt-4 text-[length:var(--text-body)] leading-[1.7] text-muted">{t.landing.spread.inbox.body}</p>
          </div>
          <Plate src={readerSrc} alt={t.landing.plates.reader} caption={t.landing.plates.reader} />
        </section>

        <Folio
          slides={[
            { src: '/marketing/reports.png', alt: t.landing.plates.reports, caption: t.landing.plates.reports },
            { src: '/marketing/thread.png', alt: t.landing.plates.thread, caption: t.landing.plates.thread },
            { src: '/marketing/habits.png', alt: t.landing.plates.habits, caption: t.landing.plates.habits },
            { src: '/marketing/search.png', alt: t.landing.plates.search, caption: t.landing.plates.search },
            { src: '/marketing/todos-board.png', alt: t.landing.plates.board, caption: t.landing.plates.board },
            { src: '/marketing/todos-week.png', alt: t.landing.plates.week, caption: t.landing.plates.week },
            { src: '/marketing/memory.png', alt: t.landing.plates.memory, caption: t.landing.plates.memory },
            {
              src: '/marketing/mobile-inbox.png',
              alt: t.landing.plates.mobile,
              caption: t.landing.plates.mobile,
              phone: true,
            },
          ]}
        />

        <section id="agent" className="landing-frame landing-spread">
          <div className="landing-spread-copy">
            <p className="text-[length:var(--text-meta)] text-accent">{t.landing.spread.agent.kicker}</p>
            <h2 className="mt-2 font-display text-[clamp(1.6rem,3vw,2.15rem)] font-semibold leading-[1.2] tracking-[-0.03em]">
              {t.landing.spread.agent.title}
            </h2>
            <p className="mt-4 text-[length:var(--text-body)] leading-[1.7] text-muted">{t.landing.spread.agent.body}</p>
            <dl className="mt-8 grid gap-6">
              <div>
                <dt className="font-display text-[length:var(--text-body)] font-semibold">{t.landing.agentIn.title}</dt>
                <dd className="mt-1 text-[length:var(--text-meta)] leading-[1.65] text-muted">{t.landing.agentIn.body}</dd>
              </div>
              <div>
                <dt className="font-display text-[length:var(--text-body)] font-semibold">{t.landing.agentOut.title}</dt>
                <dd className="mt-1 text-[length:var(--text-meta)] leading-[1.65] text-muted">{t.landing.agentOut.body}</dd>
              </div>
            </dl>
          </div>
          <Plate src="/marketing/memory.png" alt={t.landing.plates.memory} caption={t.landing.plates.memory} />
        </section>

        <section id="download" className="border-t border-border">
          <div className="landing-frame py-14">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="font-display text-[length:var(--text-title)] font-semibold tracking-[-0.03em]">
                {t.landing.downloads}
              </h2>
              {catalog ? (
                <p className="font-mono text-[length:var(--text-caption)] tabular-nums text-tertiary">
                  {t.landing.version.replace('{v}', catalog.versionName)}
                </p>
              ) : null}
            </div>

            {page.loading ? (
              <p className="mt-6 text-[length:var(--text-meta)] text-muted">{t.landing.loading}</p>
            ) : null}
            {page.error || (!page.loading && catalog === null) ? (
              <p className="mt-6 text-[length:var(--text-meta)] text-muted">
                {t.landing.unavailable}{' '}
                <a href={`${GITHUB}/releases`} target="_blank" rel="noreferrer" className={TEXT_LINK}>
                  {t.landing.githubReleases}
                </a>
              </p>
            ) : null}

            <ul className="mt-6 border-t border-border">
              <DownloadRow
                family="web"
                title={t.landing.web}
                hint={t.landing.webHint}
                href={signedIn ? HOME_PATH : '/login'}
                preferred={preferred === 'web'}
              />
              <DownloadRow
                family="macos"
                title={t.landing.macos}
                hint={t.landing.arm}
                href={arm?.url ?? null}
                size={formatSize(arm?.sizeBytes)}
                preferred={preferred === 'macos'}
                download
              />
              <DownloadRow
                family="macos"
                title={t.landing.macos}
                hint={t.landing.intel}
                href={intel?.url ?? null}
                size={formatSize(intel?.sizeBytes)}
                preferred={false}
                download
              />
              <DownloadRow
                family="windows"
                title={t.landing.windows}
                hint={t.landing.exe}
                href={exe?.url ?? msi?.url ?? null}
                size={formatSize(exe?.sizeBytes ?? msi?.sizeBytes)}
                preferred={preferred === 'windows'}
                download
              />
              <DownloadRow
                family="linux"
                title={t.landing.linux}
                hint={[deb ? t.landing.deb : null, appimage ? t.landing.appimage : null, rpm ? t.landing.rpm : null]
                  .filter(Boolean)
                  .join(' / ')}
                href={deb?.url ?? appimage?.url ?? rpm?.url ?? null}
                size={formatSize(deb?.sizeBytes ?? appimage?.sizeBytes)}
                preferred={preferred === 'linux'}
                download
              />
              <DownloadRow
                family="android"
                title={t.landing.android}
                hint={t.landing.apk}
                href={apk?.apkUrl ?? null}
                size={formatSize(apk?.sizeBytes)}
                preferred={preferred === 'android'}
                download
              />
            </ul>

            {linuxExtras(deb, appimage, rpm) ? (
              <p className="mt-4 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
                Linux：
                {[
                  deb ? (
                    <a key="deb" href={deb.url} className={TEXT_LINK}>
                      {t.landing.deb}
                    </a>
                  ) : null,
                  appimage ? (
                    <a key="appimage" href={appimage.url} className={TEXT_LINK}>
                      {t.landing.appimage}
                    </a>
                  ) : null,
                  rpm ? (
                    <a key="rpm" href={rpm.url} className={TEXT_LINK}>
                      {t.landing.rpm}
                    </a>
                  ) : null,
                ]
                  .filter(Boolean)
                  .reduce<ReactNode[]>((acc, node, index) => {
                    if (index > 0) acc.push('、');
                    acc.push(node);
                    return acc;
                  }, [])}
              </p>
            ) : null}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="landing-frame flex flex-wrap items-center justify-between gap-3 py-6">
          <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {t.landing.footer}
          </p>
          <a
            href={GITHUB}
            target="_blank"
            rel="noreferrer"
            className="text-[length:var(--text-caption)] text-muted transition-colors hover:text-fg"
          >
            {t.landing.github}
          </a>
        </div>
      </footer>
    </div>
  );
}

function linuxExtras(
  deb: DesktopAsset | undefined,
  appimage: DesktopAsset | undefined,
  rpm: DesktopAsset | undefined,
): boolean {
  const count = [deb, appimage, rpm].filter(Boolean).length;
  return count > 1;
}

export const LandingPage: FC = bindServices(LandingContent, [LandingPageService]);
