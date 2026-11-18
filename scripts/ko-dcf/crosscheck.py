"""Independent Decimal formulas; does not import the TypeScript/JS engine."""
import json
from decimal import Decimal, getcontext
from pathlib import Path
getcontext().prec=45
D=lambda x: Decimal(str(x))
p=Path('docs/validation/ko-dcf-validation.json')
d=json.loads(p.read_text())
results=[]
for s in d['scenarios']:
 i=s['input'];c=i['capital'];r=s['result'];ke=D(c['rf'])+D(c['beta'])*D(c['erp']);w=D(c['equityWeight'])*ke+D(c['debtWeight'])*D(c['kd'])*(1-D(c['tax']))
 rev=D(i['revenue']);pv=Decimal(0);rows=[]
 def same(a,b): assert abs(D(a)-D(b))<max(Decimal('1e-8'),abs(D(b))*Decimal('1e-12')),(a,b)
 same(w,r['wacc'])
 for year,y in enumerate(i['years'],1):
  old=rev;rev*=1+D(y['growth']);same((rev-old)*D(s['nwcRatio']),y['deltaNwc'])
  f=rev*(D(y['margin'])*(1-D(y['tax']))+D(y['da'])-D(y['capex']))-D(y['deltaNwc'])
  discounted=f/(1+w)**year;pv+=discounted;same(f,r['rows'][year-1]['fcff']);same(discounted,r['rows'][year-1]['pv']);rows.append(str(f))
 # Build year6 from stable business ratios, independently from TV=FCFF5*(1+g).
 y=i['years'][-1];g=D(i['g']);rev6=rev*(1+g)
 fcff6=rev6*(D(y['margin'])*(1-D(y['tax']))+D(y['da'])-D(y['capex']))-(rev6-rev)*D(s['nwcRatio'])
 same(fcff6,f*(1+g));tv=fcff6/(w-g);tpv=tv/(1+w)**5;ev=pv+tpv
 same(tv,r['terminalValue']);same(tpv,r['terminalPV']);same(ev,r['ev'])
 probe=s['syntheticBridgeProbe'];same(ev+D(10)-D(20)-D(3),probe['equity']);same((ev-D(13))/1000,probe['perShare'])
 assert r['equity'] is None and r['perShare'] is None
 results.append({'scenario':s['name'],'Ke':str(ke),'WACC':str(w),'EV':str(ev),'terminalPVShare':str(tpv/ev),'independentCheckPassed':True})
Path('docs/validation/ko-dcf-crosscheck.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(results,ensure_ascii=False,indent=2))
