import type { AllocationValue } from '@company-research/shared';
export const unknown = (reason: string): AllocationValue => ({
  value: null,
  reason,
  sources: [],
});
