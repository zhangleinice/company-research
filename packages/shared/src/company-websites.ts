export interface CompanyWebsites {
  website: string | null;
  investorWebsite: string | null;
}
/** SEC-provided absolute web addresses only. Never guess an IR path. */
export function companyWebsite(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (
    !text ||
    text.length > 2048 ||
    Array.from(text).some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
    )
  )
    return null;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) &&
      url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
