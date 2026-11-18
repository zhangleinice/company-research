"""Independent Decimal bridge crosscheck, no import of the production engine."""
import json
from decimal import Decimal as D
from pathlib import Path
p=Path('docs/validation/ko-dcf-equity-bridge.json')
data=json.loads(p.read_text())
def close(a,b):
    assert abs(D(str(a))-D(str(b)))<D('0.00000001'),(a,b)
for s in data['scenarios']:
    r=s['result'];ev=D(str(r['ev']))
    equity=ev+D(10685)+D(20710)-D(41619)-D(2161)-D(7700)
    close(equity,r['equity']);close(equity/D(4314),r['perShare'])
for case in data['sensitivities']:
    for i,s in enumerate(case['scenarios']):
        ev=D(str(data['scenarios'][i]['result']['ev']))
        eq=ev+D(10685)+D(20710)-D(41619)-D(2161)-D(case['conditionalIncrementalTaxClaim'])
        close(eq,s['equity']);close(eq/D(4314),s['perShare'])
assert data['blockedResult']['equity'] is None and data['blockedResult']['perShare'] is None
print('Independent Decimal equity bridge, three EV scenarios, tax sensitivity and material blockers passed.')
