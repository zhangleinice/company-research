import { Typography } from 'antd';
import { companyWebsite } from '@company-research/shared';
export function InvestorRelationsLink({ url }: { url: string | null }) {
  const href = companyWebsite(url);
  return href ? (
    <Typography.Link href={href} target="_blank" rel="noopener noreferrer">
      投资者关系 ↗
    </Typography.Link>
  ) : null;
}
