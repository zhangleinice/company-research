/* Annual tooling only. Never imports market data into company records. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const XLSX = require('xlsx');
const source = 'https://www.stern.nyu.edu/~adamodar/pc/datasets/wacc.xls';
function parseWacc(bytes) {
  const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: false });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Industry Averages'], {
    header: 1,
    defval: null,
  });
  const header = rows.findIndex((row) => row[0] === 'Industry Name');
  const index = rows[header]?.indexOf('Cost of Capital');
  if (
    header < 0 ||
    index < 0 ||
    !rows.slice(0, header).some((row) => row.includes('US companies'))
  )
    throw Error('Unexpected US industry sheet/header');
  const updated = rows.find((row) => row[0] === 'Date updated:')?.[1];
  const d =
    typeof updated === 'number' ? XLSX.SSF.parse_date_code(updated) : null;
  if (!d || d.y < 2000 || d.y > 2100)
    throw Error('Missing source version date');
  const industries = rows
    .slice(header + 1)
    .filter(
      (row) =>
        typeof row[0] === 'string' &&
        !/^Total Market/.test(row[0]) &&
        typeof row[1] === 'number' &&
        row[1] > 0,
    )
    .map((row) => {
      if (
        typeof row[index] !== 'number' ||
        !Number.isFinite(row[index]) ||
        row[index] <= 0 ||
        row[index] >= 1
      )
        throw Error('Invalid Cost of Capital');
      return { name: row[0].trim(), wacc: row[index] };
    });
  if (
    industries.length < 50 ||
    industries.length > 200 ||
    new Set(industries.map((x) => x.name)).size !== industries.length
  )
    throw Error('Invalid industry coverage');
  const aggregate = rows
    .slice(header + 1)
    .filter((row) => row[0] === 'Total Market (without financials)');
  if (
    aggregate.length !== 1 ||
    typeof aggregate[0][index] !== 'number' ||
    !Number.isFinite(aggregate[0][index]) ||
    aggregate[0][index] <= 0 ||
    aggregate[0][index] >= 1
  )
    throw Error('Missing valid official nonfinancial market aggregate');
  return {
    nonFinancialMarket: {
      name: 'Total Market (without financials)',
      wacc: aggregate[0][index],
    },
    version: 1,
    region: 'US',
    currency: 'USD',
    date: `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`,
    source,
    page: 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/wacc.html',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    field: 'Cost of Capital',
    industries,
  };
}
async function main() {
  const file = process.argv.indexOf('--file');
  const bytes =
    file >= 0
      ? await fs.readFile(process.argv[file + 1])
      : await (async () => {
          const r = await fetch(source, { signal: AbortSignal.timeout(45000) });
          if (!r.ok) throw Error(`Official XLS HTTP ${r.status}`);
          return Buffer.from(await r.arrayBuffer());
        })();
  const result = parseWacc(bytes);
  const target = path.resolve(
    __dirname,
    '../apps/web/src/data/industry-wacc-us.json',
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target + '.tmp', JSON.stringify(result, null, 2) + '\n');
  await fs.rename(target + '.tmp', target);
  console.log(
    `${result.date}: ${result.industries.length} industries; ${result.field}; ${result.sha256}`,
  );
}
module.exports = { parseWacc };
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
