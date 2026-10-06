import { Service } from '@rabjs/react';

const BAR_DELAY_MS = 160;
const BAR_MIN_VISIBLE_MS = 360;

/**
 * 路由 chunk 加载状态。react-router v7 把导航包在 startTransition 里，
 * lazy chunk 未就绪时界面保留旧页面（URL、选中态也暂缓切换），
 * 这里负责在此期间给出「正在加载」的信号：顶部进度条 + 被点导航项的 pending 样式。
 *
 * 注意：本服务只走全局容器（register.ts 注册），不要加进 Shell 的 bindServices——
 * 会造出第二个实例，状态与全局 resolve 互不可见。
 */
export class RouteLoadService extends Service {
  /** 进行中的路由 chunk 加载数（不含预取） */
  loading = 0;
  /** 顶部进度条可见（延迟出现、短暂停留，避免快网下闪烁） */
  bar = false;
  /** 已点击但尚未生效的导航目标，用于 rail 项的 pending 样式 */
  pendingTo: string | null = null;

  private shownAt = 0;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  /** chunk 开始加载时调用；返回结束回调（幂等，resolve/reject 都必须走到） */
  track(): () => void {
    this.loading += 1;
    if (this.loading === 1) {
      if (this.hideTimer !== null) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
      if (!this.bar && this.showTimer === null) {
        this.showTimer = setTimeout(() => {
          this.showTimer = null;
          this.bar = true;
          this.shownAt = Date.now();
        }, BAR_DELAY_MS);
      }
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.loading = Math.max(0, this.loading - 1);
      if (this.loading === 0) this.finish();
    };
  }

  /** 导航点击时记录目标，给被点项即时的 pending 反馈 */
  markClick(path: string): void {
    if (this.pendingTo !== path) this.pendingTo = path;
  }

  /** location 生效后由 Shell 调用，清除对应的点击 pending */
  settle(pathname: string): void {
    if (this.pendingTo === pathname) this.pendingTo = null;
  }

  private finish(): void {
    // 加载结束（含失败）：点击 pending 的使命到此为止，之后靠 settle 或选中态接管
    this.pendingTo = null;
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (!this.bar) return;
    // 已亮起的条至少停留一小段，避免一闪而过
    const remain = BAR_MIN_VISIBLE_MS - (Date.now() - this.shownAt);
    this.hideTimer = setTimeout(
      () => {
        this.hideTimer = null;
        this.bar = false;
      },
      Math.max(0, remain),
    );
  }

  override destroy(): void {
    if (this.showTimer !== null) clearTimeout(this.showTimer);
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    super.destroy();
  }
}
