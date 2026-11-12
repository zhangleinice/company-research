import type { ApiErrorResponse } from '@company-research/shared';

async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, signal ? { signal } : undefined);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `API 返回了无效 JSON（HTTP ${response.status}），请检查后端服务及代理配置`,
    );
  }
  if (!response.ok) {
    const error = body as Partial<ApiErrorResponse> | null;
    const message = error?.message;
    throw new Error(
      Array.isArray(message)
        ? message.join('; ')
        : typeof message === 'string'
          ? message
          : `请求失败（HTTP ${response.status}）`,
    );
  }
  return body as T;
}

export async function fetchResearchList(
  options: {
    page: number;
    q: string;
    mode: import('@company-research/shared').FinancialMode;
    favorites: boolean;
  },
  signal?: AbortSignal,
): Promise<import('@company-research/shared').ResearchListResponse> {
  const query = new URLSearchParams({
    page: String(options.page),
    limit: '10',
    q: options.q,
    mode: options.mode,
  });
  return requestJson(
    `/api/companies${options.favorites ? '/favorites' : ''}?${query}`,
    signal,
  );
}

export function fetchCompanyDetail(
  identifier: string,
  signal?: AbortSignal,
): Promise<import('@company-research/shared').CompanyDetail> {
  return requestJson(
    `/api/companies/${encodeURIComponent(identifier)}`,
    signal,
  );
}

export async function setCompanyFavorite(
  cik: string,
  isFavorite: boolean,
): Promise<void> {
  const response = await fetch(
    `/api/companies/${encodeURIComponent(cik)}/favorite`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite }),
    },
  );
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => null)) as Partial<ApiErrorResponse> | null;
    throw new Error(
      typeof body?.message === 'string'
        ? body.message
        : `收藏操作失败（HTTP ${response.status}）`,
    );
  }
}

export async function fetchAiResearch(
  cik: string,
  kind: import('@company-research/shared').AiResearchKind,
  signal?: AbortSignal,
): Promise<import('@company-research/shared').AiResearchState> {
  return requestJson(
    `/api/companies/${encodeURIComponent(cik)}/ai/${kind}`,
    signal,
  );
}
export async function companyUpdate(
  cik: string,
  action: 'status' | 'initialize' | 'start',
  signal?: AbortSignal,
): Promise<import('@company-research/shared').CompanyUpdateState> {
  const url = `/api/companies/${encodeURIComponent(cik)}/updates${action === 'initialize' ? '/initialize' : ''}`;
  const response = await fetch(url, {
    method: action === 'status' ? 'GET' : 'POST',
    signal,
  });
  const body =
    (await response.json()) as import('@company-research/shared').CompanyUpdateState & {
      message?: string;
    };
  if (!response.ok)
    throw new Error(body.message ?? `更新请求失败 HTTP ${response.status}`);
  return body;
}

export function fetchRevenueBreakdown(
  cik: string,
  signal?: AbortSignal,
): Promise<import('@company-research/shared').RevenueBreakdownResponse> {
  return requestJson(
    `/api/companies/${encodeURIComponent(cik)}/revenue-breakdown`,
    signal,
  );
}
