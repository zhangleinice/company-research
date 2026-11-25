import type {
  OwnerEarningsDraft,
  OwnerEarningsPreview,
  OwnerEarningsYear,
} from '@company-research/shared';
import { previewOwnerEarnings } from './api.js';

/** Input validity only: all financial formulas remain on the server. */
export function validOwnerInput(
  draft: OwnerEarningsDraft | null,
  year?: OwnerEarningsYear,
): boolean {
  if (!draft || !year) return false;
  return draft.method === 'ratio'
    ? year.capex.value !== null &&
        draft.ratio !== null &&
        Number.isFinite(draft.ratio) &&
        draft.ratio >= 0 &&
        draft.ratio <= 100
    : draft.amount !== null &&
        Number.isFinite(draft.amount) &&
        draft.amount >= 0 &&
        draft.amount <= Number.MAX_SAFE_INTEGER / 1e6;
}
export const ownerPreviewKey = (
  identifier: string,
  draft: OwnerEarningsDraft,
) => JSON.stringify([identifier, draft]);

/** Cancel on every edit, save, company change and unmount, even if fetch ignores abort. */
export class OwnerPreviewScheduler {
  private sequence = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  constructor(
    private readonly request = previewOwnerEarnings,
    private readonly delay = 250,
  ) {}
  cancel() {
    this.sequence++;
    clearTimeout(this.timer);
    this.controller?.abort();
  }
  schedule(
    identifier: string,
    draft: OwnerEarningsDraft,
    success: (p: OwnerEarningsPreview) => void,
    failure: (e: unknown) => void,
  ) {
    this.cancel();
    const sequence = this.sequence,
      controller = new AbortController();
    this.controller = controller;
    this.timer = setTimeout(() => {
      void this.request(identifier, draft, controller.signal)
        .then((result) => {
          if (sequence === this.sequence && !controller.signal.aborted)
            success(result);
        })
        .catch((error) => {
          if (sequence === this.sequence && !controller.signal.aborted)
            failure(error);
        });
    }, this.delay);
  }
}
