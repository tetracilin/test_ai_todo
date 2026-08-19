import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePermissions } from './usePermissions';
import { ItemStatus, ItemType, Task, WorkPackage, WorkPackageType } from '../types';

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: 't1',
  creatorId: 'creator',
  title: 'A task',
  note: '',
  createdAt: '',
  updatedAt: '',
  flagged: false,
  type: ItemType.Task,
  workPackageId: null,
  tagIds: [],
  dueDate: null,
  deferDate: null,
  scheduledTime: null,
  estimate: null,
  completedAt: null,
  status: ItemStatus.Active,
  isBlocked: false,
  blockageDetails: null,
  timerStartedAt: null,
  accumulatedTime: 0,
  ...overrides,
});

const baseWorkPackage = (overrides: Partial<WorkPackage> = {}): WorkPackage => ({
  id: 'wp1',
  creatorId: 'creator',
  title: 'A work package',
  note: '',
  createdAt: '',
  updatedAt: '',
  flagged: false,
  type: ItemType.WorkPackage,
  workPackageType: WorkPackageType.Sequential,
  status: ItemStatus.Active,
  completedAt: null,
  responsible: [],
  accountable: null,
  consulted: [],
  informed: [],
  projectId: null,
  ...overrides,
});

describe('usePermissions.canViewItem / canEditItem', () => {
  it('lets the creator view and edit an inbox task', () => {
    const { result } = renderHook(() => usePermissions());
    const task = baseTask({ creatorId: 'u1', workPackageId: null });
    expect(result.current.canViewItem(task, 'u1', [task])).toBe(true);
    expect(result.current.canEditItem(task, 'u1', [task])).toBe(true);
  });

  it('denies a stranger from viewing another user\'s inbox task', () => {
    const { result } = renderHook(() => usePermissions());
    const task = baseTask({ creatorId: 'u1', workPackageId: null });
    expect(result.current.canViewItem(task, 'stranger', [task])).toBe(false);
  });

  it('lets an assignee view and edit a task even if not the creator', () => {
    const { result } = renderHook(() => usePermissions());
    const task = baseTask({ creatorId: 'u1', assigneeId: 'assignee', workPackageId: null });
    expect(result.current.canViewItem(task, 'assignee', [task])).toBe(true);
    expect(result.current.canEditItem(task, 'assignee', [task])).toBe(true);
  });

  it('derives task visibility from the parent work package RACI matrix', () => {
    const { result } = renderHook(() => usePermissions());
    const wp = baseWorkPackage({ id: 'wp1', creatorId: 'owner', consulted: ['viewer1'] });
    const task = baseTask({ id: 't1', creatorId: 'other', workPackageId: 'wp1' });
    const allItems = [wp, task];
    expect(result.current.canViewItem(task, 'viewer1', allItems)).toBe(true);
    expect(result.current.canViewItem(task, 'nobody', allItems)).toBe(false);
  });

  it('a consulted person can view but not edit the work package', () => {
    const { result } = renderHook(() => usePermissions());
    const wp = baseWorkPackage({ creatorId: 'owner', consulted: ['c1'] });
    expect(result.current.canViewItem(wp, 'c1', [wp])).toBe(true);
    expect(result.current.canEditItem(wp, 'c1', [wp])).toBe(true);
  });

  it('an informed-only person can view but not edit the work package', () => {
    const { result } = renderHook(() => usePermissions());
    const wp = baseWorkPackage({ creatorId: 'owner', informed: ['i1'] });
    expect(result.current.canViewItem(wp, 'i1', [wp])).toBe(true);
    expect(result.current.canEditItem(wp, 'i1', [wp])).toBe(false);
  });

  it('getVisibleItemsForUser filters to only items the user can see', () => {
    const { result } = renderHook(() => usePermissions());
    const mine = baseTask({ id: 'mine', creatorId: 'u1', workPackageId: null });
    const theirs = baseTask({ id: 'theirs', creatorId: 'u2', workPackageId: null });
    const visible = result.current.getVisibleItemsForUser('u1', [mine, theirs]);
    expect(visible.map((i) => i.id)).toEqual(['mine']);
  });
});
