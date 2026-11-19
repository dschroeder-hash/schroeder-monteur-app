import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SyncBadge } from './SyncBadge';

describe('SyncBadge', () => {
  it('shows offline state and pending count', () => {
    render(<SyncBadge status={{ online: false, pending: 3, lastSync: null }} />);
    expect(screen.getByRole('status').textContent).toContain('Offline');
    expect(screen.getByRole('status').textContent).toContain('3 ausstehend');
  });
  it('shows online when nothing is pending', () => {
    render(<SyncBadge status={{ online: true, pending: 0, lastSync: new Date() }} />);
    expect(screen.getByRole('status').textContent).toContain('Online');
  });
});
