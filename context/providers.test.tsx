import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { TaskProvider, useTasks } from './TaskContext';

// Regression test: AuthProvider and TaskProvider each need data from the
// other (AuthProvider seeds the user profile via the task store; TaskProvider
// scopes data to the signed-in user via useAuth). Nesting them the way the
// app actually boots (<AuthProvider><TaskProvider>...) used to throw
// "useTasks must be used within a TaskProvider" synchronously on first
// render, because AuthProvider called useTasks() before TaskProvider — its
// own child — had mounted. Component tests that mock useAuth/useTasks
// individually never exercise this wiring, which is how the bug reached CI
// undetected.

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
    expect(screen.getByText(/items: 0/)).toBeVisible();
  });
});
