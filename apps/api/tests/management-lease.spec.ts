import { ManagementLease } from '../src/modules/ai-research/management-lease';
function fixture() {
  const task = {
    id: 'cik:management',
    token: 'worker1' as string | null,
    status: 'GENERATING',
    leaseUntil: new Date(Date.now() + 300000),
    progress: {} as unknown,
  };
  const updateMany = jest.fn(async ({ where, data }) => {
    if (
      task.token !== where.token ||
      task.status !== where.status ||
      task.leaseUntil <= where.leaseUntil.gt
    )
      return { count: 0 };
    Object.assign(task, data);
    return { count: 1 };
  });
  const db = {
    aiTask: { updateMany, findUnique: jest.fn(async () => ({ ...task })) },
  };
  return {
    task,
    db,
    lease: new ManagementLease(db as never, task.id, 'worker1'),
  };
}
afterEach(() => jest.useRealTimers());
it('renews child ownership every 30s during a long request and cleans up its timer', async () => {
  jest.useFakeTimers();
  const f = fixture();
  await jest.advanceTimersByTimeAsync(660000);
  expect(f.db.aiTask.updateMany).toHaveBeenCalledTimes(22);
  expect(f.task.leaseUntil.getTime()).toBe(Date.now() + 300000);
  await f.lease.dispose();
  await jest.advanceTimersByTimeAsync(60000);
  expect(f.db.aiTask.updateMany).toHaveBeenCalledTimes(22);
});
it('lease expiration prevents resurrection, checkpoint writes and continued requests', async () => {
  jest.useFakeTimers();
  const f = fixture();
  f.task.leaseUntil = new Date(Date.now() - 1);
  await expect(f.lease.save({ secret: 'unpublished' })).rejects.toThrow('租约');
  expect(f.lease.signal.aborted).toBe(true);
  await expect(f.lease.renew()).rejects.toThrow('租约');
  expect(f.task.progress).toEqual({});
  await f.lease.dispose();
});
it('old worker cannot save or publish after token takeover; new worker alone owns the lease', async () => {
  const f = fixture();
  f.task.token = 'worker2';
  const fresh = new ManagementLease(f.db as never, f.task.id, 'worker2');
  await fresh.save({ version: 1 });
  await expect(f.lease.settle()).rejects.toThrow('租约');
  await expect(f.lease.save({ version: 0 })).rejects.toThrow('租约');
  expect(f.task.progress).toEqual({ version: 1 });
  await fresh.settle();
  await f.lease.dispose();
  await fresh.dispose();
});
it('heartbeat DB failure aborts in-flight work instead of permitting unfenced writes', async () => {
  jest.useFakeTimers();
  const f = fixture();
  f.db.aiTask.updateMany.mockRejectedValueOnce(new Error('db unavailable'));
  await jest.advanceTimersByTimeAsync(30000);
  expect(f.lease.signal.aborted).toBe(true);
  await expect(f.lease.save({})).rejects.toThrow('租约');
  await f.lease.dispose();
});
