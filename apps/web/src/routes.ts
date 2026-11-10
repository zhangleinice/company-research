export type ListPath = '/companies' | '/favorites';

export function listReturnPath(value: string | null): string {
  if (!value) return '/companies';
  const path = value.split('?')[0];
  return path === '/companies' || path === '/favorites' ? value : '/companies';
}

export function readRoute(url: URL) {
  const match = /^\/companies\/([^/]+)\/?$/.exec(url.pathname);
  let ticker: string | null = null;
  try {
    ticker = match ? decodeURIComponent(match[1]) : null;
  } catch {
    // Malformed paths return to the directory.
  }
  const legacy = url.pathname === '/' ? url.searchParams.get('company') : null;
  const returnTo = listReturnPath(url.searchParams.get('from'));
  return {
    ticker: ticker || legacy,
    listPath: (url.pathname === '/favorites'
      ? '/favorites'
      : '/companies') as ListPath,
    returnTo,
  };
}

export function companyPath(ticker: string, from: string) {
  return `/companies/${encodeURIComponent(ticker)}?${new URLSearchParams({ from: listReturnPath(from) })}`;
}
