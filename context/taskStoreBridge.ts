import type { TaskContextType } from './TaskContext';

// AuthProvider and TaskProvider each need data from the other (AuthProvider
// logs auth events via the task store; TaskProvider scopes data to the
// signed-in user), so neither can be the sole ancestor of the other via
// React context. TaskProvider publishes its latest store here after each
// render; AuthProvider reads through this ref instead of calling useTasks()
// directly, which would throw outside a TaskProvider.
const taskStoreBridge: { current: TaskContextType | null } = { current: null };

export default taskStoreBridge;
