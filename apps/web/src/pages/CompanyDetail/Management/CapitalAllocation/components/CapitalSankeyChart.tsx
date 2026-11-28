import { Sankey } from '@ant-design/charts';
import type { CapitalSankeyModel } from '@company-research/shared';
import { capitalSankeyConfig } from '../utils/capital-sankey-options.js';
export default function CapitalSankeyChart({
  model,
  period,
}: {
  model: CapitalSankeyModel;
  period: string;
}) {
  return <Sankey {...capitalSankeyConfig(model, period)} />;
}
