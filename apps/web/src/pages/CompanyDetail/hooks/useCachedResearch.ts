import { useEffect, useState } from 'react';
import type { AiResearchKind, AiResearchState } from '@company-research/shared';
import { fetchAiResearch } from '../../../services/api.js';
export interface CachedResearch {
  state: AiResearchState | null;
  error: string;
}
export function useCachedResearch(
  cik: string,
  kind: AiResearchKind,
  revision = 0,
  enabled = true,
): CachedResearch {
  const [state, setState] = useState<AiResearchState | null>(null);
  const [error, setError] = useState('');
  const [owner, setOwner] = useState('');
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setError('');
    fetchAiResearch(cik, kind, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setOwner(`${cik}:${kind}`);
          setState(next);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          if (owner !== `${cik}:${kind}`) setState(null);
          setOwner(`${cik}:${kind}`);
          setError(e instanceof Error ? e.message : '摘要缓存读取失败');
        }
      });
    return () => controller.abort();
  }, [cik, kind, revision, enabled]);
  return {
    state: owner === `${cik}:${kind}` ? state : null,
    error: owner === `${cik}:${kind}` ? error : '',
  };
}
