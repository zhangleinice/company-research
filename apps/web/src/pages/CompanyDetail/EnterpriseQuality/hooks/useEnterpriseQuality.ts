import { useEffect, useState } from 'react';
import type { EnterpriseQuality } from '@company-research/shared';
import { fetchEnterpriseQuality } from '../../../../services/api.js';

export interface QualityResource {
  data: EnterpriseQuality | null;
  error: string;
  loading: boolean;
}
export function useEnterpriseQuality(
  ticker: string,
  revision = 0,
): QualityResource {
  const [state, setState] = useState<{
    ticker: string;
    revision: number;
    data: EnterpriseQuality | null;
    error: string;
    loading: boolean;
  }>({ ticker, revision, data: null, error: '', loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ ticker, revision, data: null, error: '', loading: true });
    void fetchEnterpriseQuality(ticker, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ ticker, revision, data, error: '', loading: false });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            ticker,
            revision,
            data: null,
            error: '已有财务缓存暂不可用，未触发数据更新。',
            loading: false,
          });
      });
    return () => controller.abort();
  }, [ticker, revision]);
  // Never show a previously selected company's results while an effect is pending.
  return state.ticker === ticker && state.revision === revision
    ? state
    : { data: null, error: '', loading: true };
}
