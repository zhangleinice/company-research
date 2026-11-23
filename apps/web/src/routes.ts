export const routePaths = {
  companies: '/companies',
  favorites: '/favorites',
  mergers: '/mergers',
  detail: '/companies/:ticker',
  valuation: '/companies/:ticker/valuation',
} as const;

export function listReturnPath(value: string | null): string {
  if (!value) return '/companies';
  const path = value.split('?')[0];
  return path === '/companies' || path === '/favorites' ? value : '/companies';
}
export function companyPath(ticker: string, from: string) {
  return `/companies/${encodeURIComponent(ticker)}?${new URLSearchParams({ from: listReturnPath(from) })}`;
}
/** Old valuation links now open the unified detail, without a URL-selected tab. */
export function legacyValuationPath(ticker: string, search: string) {
  const from = new URLSearchParams(search).get('from');
  return from
    ? companyPath(ticker, listReturnPath(from))
    : `/companies/${encodeURIComponent(ticker)}`;
}
export function legacyHomePath(search: string) {
  const ticker = new URLSearchParams(search).get('company');
  return ticker && /^[A-Z0-9][A-Z0-9.-]{0,19}$/i.test(ticker)
    ? companyPath(ticker, '/companies')
    : '/companies';
}
export function listFilters(params: URLSearchParams) {
  const value = Number(params.get('page'));
  return {
    page: Number.isSafeInteger(value) && value > 0 ? value : 1,
    query: params.get('q') ?? '',
    mode:
      params.get('mode') === 'quarterly'
        ? ('quarterly' as const)
        : ('annual' as const),
  };
}
