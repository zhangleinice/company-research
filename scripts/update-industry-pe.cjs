/* Annual official US industry snapshot; no issuer quotes or analyst forecasts are retained. */
const fs = require('node:fs/promises'),
  path = require('node:path'),
  { createHash } = require('node:crypto'),
  XLSX = require('xlsx');
const source = 'https://www.stern.nyu.edu/~adamodar/pc/datasets/pedata.xls';
const field =
  'Aggregate Mkt Cap/ Trailing Net Income (only money making firms)';
function parsePe(bytes) {
  const w = XLSX.read(bytes, { type: 'buffer' }),
    sheet = w.Sheets['Industry Averages'];
  if (!sheet) throw Error('Missing Industry Averages');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }),
    h = rows.findIndex((r) => r[0] === 'Industry Name'),
    i = rows[h]?.indexOf(field);
  if (
    h < 0 ||
    i < 0 ||
    !rows.slice(0, h).some((r) => r.includes('US companies'))
  )
    throw Error('Unrecognized official US profitable-firm trailing PE field');
  const date = rows.find((r) => r[0] === 'Date updated:')?.[1],
    d = typeof date === 'number' ? XLSX.SSF.parse_date_code(date) : null;
  if (!d || d.y < 2000 || d.y > 2100) throw Error('Missing source date');
  const industries = rows
    .slice(h + 1)
    .filter(
      (r) =>
        typeof r[0] === 'string' &&
        !r[0].startsWith('Total Market') &&
        typeof r[1] === 'number' &&
        r[1] > 0,
    )
    .map((r) => ({
      name: r[0].trim(),
      pe:
        typeof r[i] === 'number' && Number.isFinite(r[i]) && r[i] > 0
          ? r[i]
          : null,
    }));
  if (
    industries.length < 50 ||
    industries.length > 200 ||
    new Set(industries.map((r) => r.name)).size !== industries.length
  )
    throw Error('Invalid industry coverage');
  return {
    version: 1,
    region: 'US',
    date: `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`,
    source,
    page: 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/pedata.html',
    field,
    definition:
      'Aggregate equity market capitalization divided by aggregate trailing net income of profitable firms only; not the arithmetic average PE or forward PE.',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    industries,
  };
}
async function main() {
  const i = process.argv.indexOf('--file');
  let bytes;
  if (i >= 0) bytes = await fs.readFile(process.argv[i + 1]);
  else {
    const r = await fetch(source, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw Error(`Official XLS HTTP ${r.status}`);
    bytes = Buffer.from(await r.arrayBuffer());
  }
  const data = parsePe(bytes),
    target = path.resolve(
      __dirname,
      '../apps/web/src/data/industry-pe-us.json',
    );
  await fs.writeFile(target + '.tmp', JSON.stringify(data, null, 2) + '\n');
  await fs.rename(target + '.tmp', target);
  console.log(data.date, data.industries.length, data.field);
}
module.exports = { parsePe };
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
