const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
writeFileSync(join(__dirname, '../dist/esm/package.json'), '{"type":"module"}\n');
