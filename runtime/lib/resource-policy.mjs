import fs from 'node:fs';
import path from 'node:path';
import {providerProfile, providerForRole, providerSpec, providerModels, providerNames, discoverProvider} from './providers.mjs';
import {validateProviderEntry} from './userProviders.mjs';
import {learnedResources} from './execution-report.mjs';
import {quotaStatus,quotaFailures} from './provider-quota.mjs';

export const MODEL_TIERS = ['economy', 'standard', 'advanced'];
export const RESOURCE_DEFAULTS = Object.freeze({enabled:false, default_sessions:8, max_sessions:20, auto_extend:true, auto_models:false, quota_failover:true, max_model_tier:'advanced', models:[]});
const level = tier => MODEL_TIERS.indexOf(tier);
export function readResourceConfig(root) {
  let config;
  try {config=JSON.parse(fs.readFileSync(path.join(root,'config','manager.json'),'utf8'));}
  catch (error) {if(error.code==='ENOENT')config={};else throw error;}
  Object.defineProperty(config,'__resourceRoot',{value:root});return config;
}
export function resourcePolicy(config={}) {
  const raw=config.resource_policy||{};
  return Object.fromEntries(Object.entries(RESOURCE_DEFAULTS).map(([key,value])=>[key,key==='models'?(Array.isArray(raw.models)?raw.models.map(m=>({...m})):raw.models??[]):raw[key]??value]));
}
export function validateResourcePolicy(input) {
  const p=resourcePolicy({resource_policy:input});
  for(const key of ['enabled','auto_extend','auto_models','quota_failover'])if(typeof p[key]!=='boolean')throw Error(`${key} must be a boolean`);
  for(const key of ['default_sessions','max_sessions'])if(!Number.isInteger(p[key])||p[key]<3||p[key]>50)throw Error(`${key} must be between 3 and 50`);
  if(p.default_sessions>p.max_sessions)throw Error('Default sessions cannot exceed the automatic session ceiling');
  if(!MODEL_TIERS.includes(p.max_model_tier))throw Error('Choose a valid model ceiling');
  if(!Array.isArray(p.models)||p.models.length>100)throw Error('Choose at most 100 model routes');
  const seen=new Set();
  p.models=p.models.map(m=>{
    if(!m||typeof m.provider!=='string'||!m.provider.trim()||typeof m.model!=='string'||!m.model.trim())throw Error('Each model route needs a provider and exact model id');
    if(!MODEL_TIERS.includes(m.tier)||!Number.isInteger(m.cost_order)||m.cost_order<0||m.cost_order>100)throw Error('Each model needs a capability tier and cost order from 0 to 100');
    if(typeof m.enabled!=='boolean')throw Error('Each model route needs an enabled flag');
    const item={provider:m.provider.trim().toLowerCase(),model:m.model.trim(),tier:m.tier,cost_order:m.cost_order,enabled:m.enabled};
    const key=`${item.provider}\0${item.model}`;if(seen.has(key))throw Error('Duplicate provider/model route');seen.add(key);return item;
  });
  if(p.auto_models&&!p.models.some(m=>m.enabled&&level(m.tier)<=level(p.max_model_tier)))throw Error('Automatic model routing needs an enabled model below the ceiling');
  return p;
}
export function saveResourcePolicy(root,input) {
  const p=validateResourcePolicy(input),config=readResourceConfig(root);
  config.resource_policy=p;
  const file=path.join(root,'config','manager.json');fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file+'.tmp',JSON.stringify(config,null,2)+'\n');fs.renameSync(file+'.tmp',file);
  return p;
}
export function assertModelAllowed(config,provider,model) {
  const p=resourcePolicy(config);
  if(!p.enabled||!p.auto_models)return;
  if(!p.models.some(m=>m.enabled&&m.provider===provider&&m.model===model&&level(m.tier)<=level(p.max_model_tier)))throw Error('Selected provider/model is outside the approved model pool or ceiling');
}

export function assessTask(task={}, {role='rowan'}={}) {
  const ownObjective=String(task.objective||'').split(/\n\nOriginal request(?: \(context\))?:/)[0];
  const text=[task.title,ownObjective,task.instructions,...(task.completion_checks||[]),...(task.selected_skills||[])].filter(Boolean).join(' ');
  const files=task.files||task.dispatch_contract?.files||[];
  const reasons=[];
  let complexity='standard',tier='standard';
  if(['critical','dangerous'].includes(task.risk)||/\b(payment|credential migration|production migration|authentication redesign)\b/i.test(text)) {
    complexity='critical';tier='advanced';reasons.push('Critical risk or a sensitive migration');
  } else if(task.integrated_delivery||files.length>5||(task.plan_depends_on||task.depends_on||[]).length>2||/atl-ui-review|\b(desktop.*mobile|migration|concurren|architecture|cross[- ]layer)\b/i.test(text)) {
    complexity='complex';reasons.push('Multiple surfaces, integration, or cross-layer verification');
  } else if(files.length<=2&&(task.completion_checks||[]).length<=2&&/\b(typo|rename|copy edit|documentation|readme|routine|repetitive|formatting)\b|اصلاح املایی|تکراری/i.test(text)) {
    complexity='simple';tier='economy';reasons.push('Small routine change with few checks');
  } else reasons.push('Standard effort; insufficient evidence for a routine-only route');
  const estimate=task.resource_estimate;
  const order=['simple','standard','complex','critical'];
  if(estimate&&order.indexOf(estimate.complexity)>order.indexOf(complexity)&&String(estimate.reason||'').trim()) {
    complexity=estimate.complexity;tier=complexity==='critical'?'advanced':'standard';reasons.push(`Planner estimate: ${String(estimate.reason).slice(0,300)}`);
  }
  const rejected=(task.evidence||[]).filter(e=>e.kind==='review'&&e.result==='changes-requested'&&!e.invalidated&&(e.packet_revision||1)===(task.packet_revision||1)).length;
  if(rejected) {tier=MODEL_TIERS[Math.min(2,level(tier)+1)];reasons.push(`${rejected} review rejection(s): increase reasoning capacity`);}
  if(['sage','planning-review'].includes(role)&&task.risk==='risky'){tier='advanced';reasons.push('Risky work requires a stronger independent review');}
  return {complexity,tier,rejections:rejected,reasons};
}
export function budgetDecision(config,task={}, {runLimit=null}={}) {
  const p=resourcePolicy(config),assessment=assessTask(task);
  const learned=learnedResources(config.__resourceRoot,task,assessment);
  const used=task.execution_budget?.used||0;
  if(task.execution_budget&&task.execution_budget.source!=='automatic')return {max_sessions:task.execution_budget.max_sessions,used,source:'owner',ceiling:task.execution_budget.max_sessions,reasons:['Existing task limit is owner-controlled'],assessment};
  const ceiling=Math.min(p.max_sessions,runLimit??p.max_sessions);
  let requested=p.default_sessions;
  if(p.enabled)requested=({simple:3,standard:p.default_sessions,complex:p.default_sessions+4,critical:p.default_sessions+8})[assessment.complexity]+Math.min(assessment.rejections,3)*2;
  if(p.enabled&&learned.sessionFloor!==null){requested=Math.max(3,learned.sessionFloor)+Math.min(assessment.rejections,3)*2;assessment.reasons.push(`Project history: ${learned.samples} comparable verified tasks; ${learned.sessionFloor} session baseline`);}
  const remaining=task.status==='verifying'?1:task.status==='in_review'?2:3;
  if(p.enabled&&p.auto_extend)requested=Math.max(requested,used+remaining);
  const previous=task.execution_budget?.max_sessions||0;
  const max=p.enabled&&(!previous||p.auto_extend)?Math.min(ceiling,Math.max(previous,requested)):previous||Math.min(ceiling,requested);
  return {max_sessions:Math.max(used,max),used,source:p.enabled?'automatic':'default',ceiling,reasons:assessment.reasons,assessment};
}

export function routeTask(config,task={},role='rowan',{profile=providerProfile(config),discover=discoverProvider,overrides={}}={}) {
  profile={...profile,byRole:{...profile.byRole},modelByRole:{...profile.modelByRole}};
  const taskRoute=task.provider_route || null;
  const selectedWorker=overrides.worker || taskRoute?.provider;
  const selectedModel=overrides.model || (overrides.worker ? null : taskRoute?.model);
  if(selectedWorker){profile.byRole[role]=String(selectedWorker).toLowerCase();delete profile.modelByRole[role];}
  if(selectedModel)profile.modelOverride=String(selectedModel);
  const p=resourcePolicy(config),assessment=assessTask(task,{role});
  const learned=learnedResources(config.__resourceRoot,task,assessment);
  if(p.enabled&&p.auto_models&&learned.tierFloor&&level(learned.tierFloor)>level(assessment.tier)){assessment.tier=learned.tierFloor;assessment.reasons.push(`Project history: repeated review repairs in ${learned.samples} comparable verified tasks; raise capability to ${learned.tierFloor}`);}
  const pinned=Boolean(selectedWorker||selectedModel||profile.byRole?.[role]||profile.modelByRole?.[role]);
  const base=providerForRole(profile,role);
  let chosen=null,blocked=null;
  if(p.enabled&&p.auto_models) {
    const candidates=p.models.filter(m=>m.enabled&&level(m.tier)<=level(p.max_model_tier));
    if(pinned) {
      const id=base.userProvider?.id||base.worker;
      chosen=candidates.find(m=>m.provider===id&&m.model===base.model);
      if(!chosen)blocked='The explicit provider/model override is outside the approved model pool or ceiling';
      else if(level(chosen.tier)<level(assessment.tier))blocked=`The explicit model override is below the required ${assessment.tier} capability; update the override or task scope`;
    } else {
      const eligible=candidates.filter(m=>level(m.tier)>=level(assessment.tier)).sort((a,b)=>a.cost_order-b.cost_order||level(a.tier)-level(b.tier)||a.provider.localeCompare(b.provider));
      chosen=eligible.find(m=>{
        const spec=providerSpec(profile,m.provider);
        return quotaStatus(config.__resourceRoot,m.provider,m.model).status!=='exhausted'&&discover(spec.userProvider?.worker||m.provider,{command:spec.command}).available&&(!spec.userProvider||!validateProviderEntry({...spec.userProvider,model:m.model}).length);
      });
      if(!chosen)blocked=`No available approved model meets ${assessment.tier} capability within the ${p.max_model_tier} ceiling`;
    }
  }
  let pick=base;
  if(chosen) {
    const spec=providerSpec(profile,chosen.provider);
    const entry=spec.userProvider?{id:chosen.provider,...spec.userProvider,model:chosen.model}:null;
    pick={worker:entry?.worker||chosen.provider,auth:entry?'api':spec.auth,model:chosen.model,source:pinned?'explicit override within resource policy':'automatic resource policy',...(entry?{userProvider:entry}:{})};
  }
  const originalId=base.userProvider?.id||base.worker;
  const selectedId=pick.userProvider?.id||pick.worker;
  const exhausted=quotaStatus(config.__resourceRoot,selectedId,pick.model).status==='exhausted';
  const originalExhausted=quotaStatus(config.__resourceRoot,originalId,base.model).status==='exhausted';
  let failover=null;
  if(p.quota_failover&&(exhausted||originalExhausted)) {
    const allowed=p.models.length?p.models.filter(m=>m.enabled&&level(m.tier)<=level(p.max_model_tier)&&level(m.tier)>=level(assessment.tier)):p.auto_models?[]:[...new Set([profile.use,profile.defaultWorker,...Object.keys(profile.catalog||{}),...Object.keys(profile.userProviders||{})].filter(Boolean))].map(id=>({provider:id,model:providerSpec(profile,id).model,cost_order:0}));
    const eligible=allowed.map(model=>({...model,quota:quotaStatus(config.__resourceRoot,model.provider,model.model)})).filter(model=>model.quota.status!=='exhausted').sort((a,b)=>(a.quota.status==='available'?0:1)-(b.quota.status==='available'?0:1)||a.cost_order-b.cost_order);
    const alternative=eligible.find(model=>{const spec=providerSpec(profile,model.provider);return discover(spec.userProvider?.worker||model.provider,{command:spec.command}).available&&(!spec.userProvider||!validateProviderEntry({...spec.userProvider,model:model.model}).length);});
    if(alternative) {
      const spec=providerSpec(profile,alternative.provider),entry=spec.userProvider?{id:alternative.provider,...spec.userProvider,model:alternative.model}:null;
      chosen=alternative;pick={worker:entry?.worker||alternative.provider,auth:entry?'api':spec.auth,model:alternative.model,source:'automatic quota failover',...(entry?{userProvider:entry}:{})};blocked=null;
      failover={from:{provider:originalId,model:base.model},to:{provider:alternative.provider,model:alternative.model},quota:alternative.quota};
      assessment.reasons.push(`Quota failover to ${alternative.provider}/${alternative.model||'provider default'}; quota ${alternative.quota.status}`);
    }else blocked='All eligible configured model/provider routes are quota-exhausted or unavailable; no session started';
  }
  const spec=providerSpec(profile,chosen?.provider||pick.userProvider?.id||pick.worker);
  return { ...pick,provider:{...spec,model:pick.model,...(pick.userProvider?{userProvider:pick.userProvider}:{})},decision:{...assessment,automatic:p.enabled&&p.auto_models,selected:chosen?{...chosen}: {provider:pick.userProvider?.id||pick.worker,model:pick.model},pinned,blocked,failover,...(blocked&&(exhausted||originalExhausted)?{blocker:'provider-quota'}:{}),reasons:[...assessment.reasons,failover?'Quota failover is enabled':pinned?'Explicit role/run selection is preserved':chosen?'Lowest configured cost order meeting required capability':'Project provider; automatic model routing is off']} };
}
export function modelInventory(config,{profile=providerProfile(config)}={}) {
  const rows=[];
  for(const id of providerNames(profile)) {
    const spec=providerSpec(profile,id);
    const names=[...new Set([spec.model,...(spec.models||[]),...providerModels(id).map(m=>m.id),(profile.use===id?profile.raw?.model:null)].filter(Boolean))];
    for(const model of names)rows.push({provider:id,model});
  }
  return rows;
}
export function resourceView(root) {
  const config=readResourceConfig(root);
  return {policy:resourcePolicy(config),models:modelInventory(config),tiers:MODEL_TIERS,quota_failures:quotaFailures(root)};
}
export function taskResourcePreview(config,task,role=null,options={}) {
  role ||= ({in_review:'sage',verifying:'beacon',new:'pip',triaged:'mira'})[task.status]||'rowan';
  const routing=routeTask(config,task,role,options);
  return {budget:budgetDecision(config,task),routing:routing.decision,stages:Object.fromEntries(['rowan','sage','beacon'].map(stage=>[stage,stage===role?routing.decision:routeTask(config,task,stage,options).decision]))};
}
