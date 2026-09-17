import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/copy';
import { NotifyAlertPage } from '../../../src/features/notify/NotifyAlertPage';
import {
  encodeStickyAlertHash,
  resetStickyAlertForTest,
} from '../../../src/features/notify/sticky-alert';

afterEach(() => {
  resetStickyAlertForTest();
  window.location.hash = '';
});

describe('NotifyAlertPage', () => {
  it('stays until the user dismisses or opens, and does not close itself', async () => {
    const user = userEvent.setup();
    const closeWindow = vi.fn();
    const openTarget = vi.fn();
    window.location.hash = encodeStickyAlertHash({
      id: 'n1',
      title: '任务提醒',
      body: '「交报告」提醒到了',
      url: '/todos/lists/l1?task=t1',
    });
    render(<NotifyAlertPage closeWindow={closeWindow} openTarget={openTarget} />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('任务提醒')).toBeInTheDocument();
    expect(screen.getByText('「交报告」提醒到了')).toBeInTheDocument();
    expect(closeWindow).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: t.settings.notify.later }));
    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(openTarget).not.toHaveBeenCalled();
  });

  it('opens the target then dismisses the current card', async () => {
    const user = userEvent.setup();
    const closeWindow = vi.fn();
    const openTarget = vi.fn();
    window.location.hash = encodeStickyAlertHash({
      id: 'n1',
      title: '任务到期',
      body: '到期了',
      url: '/today',
    });
    render(<NotifyAlertPage closeWindow={closeWindow} openTarget={openTarget} />);
    await user.click(screen.getByRole('button', { name: t.settings.notify.open }));
    expect(openTarget).toHaveBeenCalledWith('/today');
    await waitFor(() => expect(closeWindow).toHaveBeenCalledTimes(1));
  });
});
