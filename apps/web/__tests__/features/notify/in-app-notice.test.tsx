import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/copy';
import { browserNotify, resetBrowserNotify } from '@/features/notify/browser-notify.service';
import { InAppNotice } from '@/features/notify/InAppNotice';
import { RabRoot } from '../../helpers/rab-root';

function PathProbe() {
  const location = useLocation();
  return <div data-testid="path">{location.pathname}</div>;
}

afterEach(() => {
  resetBrowserNotify();
  vi.unstubAllGlobals();
});

describe('InAppNotice', () => {
  it('shows the brief and opens /today without leaving the page origin', async () => {
    const user = userEvent.setup();
    const Ctor = function FakeNotification() {} as unknown as typeof Notification;
    Object.defineProperty(Ctor, 'permission', { configurable: true, value: 'default' });
    vi.stubGlobal('Notification', Ctor);
    render(
      <RabRoot>
        <MemoryRouter initialEntries={['/settings']}>
          <InAppNotice />
          <Routes>
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </RabRoot>,
    );
    browserNotify().showPush({
      type: 'notify',
      id: 'brief-1',
      title: '晨报',
      body: '3 个日程之间有空档，建议把「写报告」挪到这段或明天。',
      url: 'http://localhost:5180/today',
    });
    expect(await screen.findByRole('dialog', { name: '晨报' })).toBeInTheDocument();
    expect(screen.getByText(/空档/)).toBeInTheDocument();
    expect(screen.getByText(/建议/)).toBeInTheDocument();
    const open = screen.getByRole('link', { name: t.settings.notify.open });
    expect(open).toHaveAttribute('href', '/today');
    expect(open.getAttribute('href')).not.toContain('localhost');
    await user.click(open);
    expect(screen.getByTestId('path')).toHaveTextContent('/today');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
