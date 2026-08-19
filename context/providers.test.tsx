import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { onAuthStateChanged } from 'firebase/auth';
import { AuthProvider, useAuth } from './AuthContext';
import { TaskProvider, useTasks } from './TaskContext';

// Regression test: AuthProvider and TaskProvider each need data from the
// other (AuthProvider logs auth events via the task store; TaskProvider
// scopes data to the signed-in user via useAuth). Nesting them the way the
// app actually boots (<AuthProvider><TaskProvider>...) used to throw
// "useTasks must be used within a TaskProvider" synchronously on first
// render, because AuthProvider called useTasks() before TaskProvider — its
// own child — had mounted. Component tests that mock useAuth/useTasks
// individually never exercise this wiring, which is how the bug reached CI
// undetected.
vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback) => {
  (callback as (user: null) => void)(null);
  return () => {};
});

const Probe: React.FC = () => {
  const { isReady } = useAuth();
  const { getItems } = useTasks();
  return <div>ready: {String(isReady)}, items: {getItems().length}</div>;
};

describe('AuthProvider + TaskProvider composition', () => {
  it('mounts without throwing and exposes both contexts to descendants', async () => {
    render(
      <AuthProvider>
        <TaskProvider>
          <Probe />
        </TaskProvider>
      </AuthProvider>,
    );

    expect(await screen.findByText(/ready: true/)).toBeVisible();
  });
});
