import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MainHeader } from './MainHeader';

vi.mock('./UserMenu', () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

describe('MainHeader', () => {
  it('renders the title and fires the sidebar toggle', async () => {
    const onToggleSidebar = vi.fn();
    render(<MainHeader title="Today" onToggleSidebar={onToggleSidebar} />);

    expect(screen.getAllByText('Today').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: '' }));
    expect(onToggleSidebar).toHaveBeenCalledOnce();
  });

  it('only renders the add-item button when onAddItem is provided (edge case)', () => {
    const { rerender } = render(<MainHeader title="Today" onToggleSidebar={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);

    rerender(<MainHeader title="Today" onToggleSidebar={() => {}} onAddItem={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
