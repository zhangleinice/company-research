import { targetBuyPrice } from '@company-research/shared';
import { valuationNumber } from './valuation-format.js';
const referenceMargins = [20, 30, 40, 50] as const;
/** Stateless reference table shared by DCF, PE and PEG. */
export function MarginOfSafety({
  model,
  fairValue,
}: {
  model: 'DCF' | 'PE' | 'PEG';
  fairValue: number | null;
}) {
  return (
    <section aria-label={`${model}安全边际`}>
      <table
        className="margin-of-safety-table"
        aria-label={`${model}安全边际参考价格`}
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
        }}
      >
        <tbody>
          <tr>
            <th scope="row">安全边际</th>
            {referenceMargins.map((p) => (
              <th scope="col" key={p}>
                {p}%
              </th>
            ))}
          </tr>
          <tr>
            <th scope="row">参考买入价</th>
            {referenceMargins.map((p) => (
              <td key={p}>{valuationNumber(targetBuyPrice(fairValue, p))}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}
