import { observer, useService } from '@rabjs/react';
import type { FC } from 'react';
import { RouteLoadService } from '@/shell/route-load.service';

/**
 * 顶部路由加载进度条。必须挂在 Routes 之外、且不消费 router context：
 * react-router v7 的导航 transition 悬挂期间，router 子树内的外部 store 更新
 * 会被纠缠到 transition commit 才渲染（反馈失效）；独立子树的 sync 更新不受影响。
 */
export const RouteProgress: FC = observer(function RouteProgress() {
  const routeLoad = useService(RouteLoadService);
  return <div className={routeLoad.bar ? 'route-progress is-on' : 'route-progress'} aria-hidden />;
});
