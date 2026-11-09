// Optional instrumented local API for acceptance. Does not initiate paid work.
// Logs upstream request COUNTS only, never headers, bodies or credentials.
const { URL } = require('node:url');
const originalFetch = global.fetch;
const counts = {companyFacts:0,submissions:0,archives:0,otherSec:0,ai:0};
global.fetch=async(input,options)=>{
  const url=new URL(typeof input==='string'||input instanceof URL ? input : input.url);
  const category = url.hostname==='api.router.ai' ? 'ai' : url.hostname.endsWith('sec.gov') ? url.pathname.includes('/companyfacts/') ? 'companyFacts' : url.pathname.includes('/submissions/') ? 'submissions' : url.pathname.includes('/Archives/') ? 'archives' : 'otherSec' : null;
  if(category) {counts[category]++;console.log('UPSTREAM_COUNTS',JSON.stringify(counts));}
  return originalFetch(input,options);
};
console.log('UPSTREAM_COUNTS',JSON.stringify(counts));
const timer=setInterval(()=>console.log('UPSTREAM_COUNTS',JSON.stringify(counts)),30000);timer.unref();
require('../apps/api/dist/main');
