import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginView } from './LoginView';
import { useAuth } from '../context/AuthContext';

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);

describe('LoginView', () => {
  const login = vi.fn();
  const signup = vi.fn();
  const sendPasswordReset = vi.fn();

  beforeEach(() => {
    login.mockReset().mockResolvedValue(undefined);
    signup.mockReset().mockResolvedValue(undefined);
    sendPasswordReset.mockReset().mockResolvedValue(undefined);
    mockedUseAuth.mockReturnValue({ login, signup, sendPasswordReset } as any);
  });

  it('submits sign-in credentials to the auth context', async () => {
    render(<LoginView />);
    await userEvent.type(screen.getByLabelText(/email address/i), 'ada@example.com');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'hunter22');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('ada@example.com', 'hunter22', true);
    });
  });

  it('shows a validation error instead of calling signup when passwords do not match (edge case)', async () => {
    render(<LoginView />);
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }));

    await userEvent.type(screen.getByLabelText(/full name/i), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText(/^email address$/i), 'ada@example.com');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'longenough');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'different');
    fireEvent.submit(screen.getByRole('button', { name: /sign up/i }).closest('form')!);

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(signup).not.toHaveBeenCalled();
  });

  it('surfaces the auth error when login rejects', async () => {
    login.mockRejectedValueOnce(new Error('Invalid credentials'));
    render(<LoginView />);
    await userEvent.type(screen.getByLabelText(/email address/i), 'ada@example.com');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'wrongpass');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
  });
});
