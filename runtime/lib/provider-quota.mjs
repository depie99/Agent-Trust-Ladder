import fs from 'node:fs';
import path from 'node:path';
import {loadUsage} from './usage.mjs';

const fileFor=root=>path.join(root,'.trust','manager','provider-quota.json');
export function quotaFailures(root) {
  if(!root)return [];
  try{const data=JSON.parse(fs.readFileSync(fileFor(root),'utf8'));return Array.isArray(data.failures)?data.failures:[];}catch{return [];}
}
export function recordQuotaFailure(root,{provider,model=null,scope='provider',retryAfterSeconds=1800,reason='Provider reported exhausted quota'}) {
  const now=Date.now(),seconds=Math.max(30,Math.min(86400,Number(retryAfterSeconds)||1800));
  const row={provider,model:scope==='model'?model:null,scope:scope==='model'?'model':'provider',observedAt:new Date(now).toISOString(),retryAt:new Date(now+seconds*1000).toISOString(),reason};
  const failures=quotaFailures(root).filter(item=>Date.parse(item.retryAt)>now&&!(item.provider===row.provider&&item.model===row.model));
  failures.push(row);fs.mkdirSync(path.dirname(fileFor(root)),{recursive:true});
  const temp=fileFor(root)+'.tmp';fs.writeFileSync(temp,JSON.stringify({version:1,failures},null,2)+'\n');fs.renameSync(temp,fileFor(root));return row;
}
export function quotaStatus(root,provider,model,{now=Date.now()}={}) {
  const failure=quotaFailures(root).find(item=>item.provider===provider&&(!item.model||item.model===model)&&Date.parse(item.retryAt)>now);
  if(failure)return {status:'exhausted',source:'provider-error',retryAt:failure.retryAt,reason:failure.reason};
  if(root) {
    const sample=loadUsage(root).snapshots.filter(row=>row.provider===provider&&(!row.model||row.model===model)&&row.confidence==='verified'&&row.source==='provider-adapter'&&typeof row.remaining==='number'&&now-Date.parse(row.captured_at)<3600000&&now>=Date.parse(row.captured_at)).at(-1);
    if(sample&&!(sample.reset_at&&Date.parse(sample.reset_at)<=now))return {status:sample.remaining>0?'available':'exhausted',source:'verified-provider-adapter',retryAt:sample.reset_at||null};
  }
  return {status:'unknown',source:'not-exposed'};
}
