import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '@/copy';
import { Button } from '@/ui/button';

interface Props {
  children: ReactNode;
  /** 变化时重置错误态（传 location.pathname，让用户点击其它导航可自愈） */
  resetKey?: string;
}

interface State {
  failed: boolean;
}

/**
 * 路由 chunk 加载失败（弱网、发版后旧 hash 失效）的兜底，避免整页白屏。
 * 包在 Shell 的 Outlet 外，壳与导航保持可用，用户可直接点别的页面。
 */
export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[route] page render failed', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        className="flex min-h-[60vh] flex-col items-center justify-center gap-2.5 px-5 py-10 text-center"
        role="alert"
      >
        <p className="text-[length:var(--text-body)] font-semibold text-fg">{t.route.loadFailed}</p>
        <p className="max-w-80 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {t.route.loadFailedHint}
        </p>
        <Button className="mt-1.5" onClick={() => window.location.reload()}>
          {t.route.reload}
        </Button>
      </div>
    );
  }
}
