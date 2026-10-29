// Regenerate source-derived references before building the public website.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const write=(file,text)=>{
  if(file==='docs/cli-reference.md')text+=consoleReference();
  const target=path.join(root,file);
  if(fs.existsSync(target)&&read(file)===text)return;
  if(process.argv.includes('--check')){console.error('Stale reference: '+file);process.exitCode=1;}
  else fs.writeFileSync(target,text);
};
function consoleReference(){
 const source=read('runtime/lib/command-console.mjs');
 const rows=[...source.matchAll(/\{ name: "([^"]+)", usage: "([^"]+)", kind: "([^"]+)", summary: "([^"]+)" \}/g)];
 return `\n## Browser and terminal command console\n\nEnter these inside the Control Plane CLI console or the terminal command console. They are not all top-level \`atl\` subcommands. In particular, the top-level CLI queue command only exposes add, remove, list, and clear; named-queue operations below belong to the console or browser queue UI. Source: \`runtime/lib/command-console.mjs\`.\n\n| Console syntax | Effect class | Purpose |\n|---|---|---|\n${rows.map(m=>`| \`${m[2].replaceAll('|',' / ')}\` | ${m[3]} | ${m[4]} |`).join('\n')}\n`;
}
const cli=read('runtime/atl-manager.mjs');
const help=cli.match(/function usage\(\)\s*\{\s*return `([\s\S]*?)`;/)?.[1];
if(!help)throw new Error('CLI help source boundary changed');
const lifecycle=JSON.parse(read('config/manager-state-contract.json'));
write('docs/state-contract.md',`# Lifecycle reference\n\nGenerated from \`config/manager-state-contract.json\`, consumed directly by \`runtime/lib/state.mjs\`. These are literal runtime values, separate from the conceptual diagrams.\n\n## How to use the contract\n\nInspect a task with \`atl show T-001\` and explain its gate with \`atl why T-001\`. Use supported runtime operations rather than editing state JSON. Actor authorization alone does not satisfy the listed evidence requirements; inspect their implementation in \`state.mjs\`.\n\n## Status values\n\n${lifecycle.statuses.map(status=>'\`'+status+'\`').join(', ')}.\n\n## Transitions\n\n| Transition | Allowed actors | Required gates |\n|---|---|---|\n${Object.entries(lifecycle.transitions).map(([transition,rule])=>`| \`${transition}\` | ${rule.actors.map(actor=>'\`'+actor+'\`').join(', ')} | ${rule.requires.length?rule.requires.map(gate=>'\`'+gate+'\`').join(', '):'No additional requirement in this row'} |`).join('\n')}\n\nThe manager's privileged behavior and additional runtime validation must be inspected in the implementation; the table is the serialized transition contract. See [verification](../verification/README.md) for the bounded lifecycle model and its negative control.\n`);
write('docs/cli-reference.md',`# CLI reference\n\nGenerated from \`runtime/atl-manager.mjs\` usage text. Run \`atl --help\` for your installed version. Do not edit this reference by hand.\n\n## How to use commands\n\nRun commands from the managed application and inspect any \`ATL_PROJECT\` override. Replace example task IDs and paths. Preview execution before confirming. Commands that publish, restore, install, or change credentials have material effects; read their guide first.\n\n## Current help\n\n\`\`\`text\n${help.trim().replaceAll('\\\\','\\')}\n\`\`\`\n\n## Related guides\n\n[Getting started](getting-started.md), [tasks and queues](tasks-and-queues.md), [providers](providers.md), [overnight runs](overnight-runs.md), [configuration](configuration.md).\n`);
const server=read('runtime/lib/control-plane-server.mjs');
const routes=[...new Set([...server.matchAll(/["'`](\/api\/[a-zA-Z0-9_/:.-]+)["'`]/g)].map(m=>m[1]))].sort();
write('docs/api-reference.md',`# Local API reference\n\nThis route index is extracted from literal API paths in \`runtime/lib/control-plane-server.mjs\`. It is a source-navigation aid, not a versioned OpenAPI schema. Parameterized/constructed routes may require following their handler.\n\n## How to inspect a request\n\nUse the Control Plane's supported operation and inspect its browser request and source handler. Check the handler's HTTP method, payload validation, owner-session requirements, and response before writing a client. Do not infer an allowed method from a path name.\n\n## Owner-session boundary\n\nThe browser server binds to loopback by default. Browser-origin mutations use same-origin and owner-session/CSRF checks. Origin-less command-line requests remain supported by the outer guard; inspect each route rather than assuming universal session authentication. Some sensitive read operations, including change review, also require the owner cookie and \`x-atl-csrf\` header. A copied URL alone is insufficient authority. The browser client demonstrates the supported request flow.\n\nRead \`runtime/lib/session-auth.mjs\`, route guards in \`control-plane-server.mjs\`, and \`verification/owner_session_approval_test.mjs\` before integrating. Keep tokens out of logs and URLs.\n\n## Literal route index\n\n| Path | Source |\n|---|---|\n${routes.map(r=>`| \`${r}\` | \`runtime/lib/control-plane-server.mjs\` |`).join('\n')}\n\n## Verify behavior\n\nRun \`node verification/control_plane_server_test.mjs\` and the feature-specific verifier from the [feature map](guides.md). This index does not claim every route was exercised during a documentation refresh.\n`);
const groups={
 'commands':'Agent command entry points: invoke the corresponding skill contract.',
 'config':'Runtime and routing contracts: define policy and allowed behavior.',
 'docs':'Developer guides, generated website, visual sources, and historical evidence.',
 'runtime':'Executable runtime, browser client, provider adapters, and role prompts.',
 'scripts':'Build, installation, validation, and maintenance programs.',
 'skills':'Agent instruction contracts, references, assets, and executable helpers.',
 'verification':'Behavior checks, formal models, and synthetic fixtures.',
 'research':'Reviewed improvement proposals, source material, and catalog.',
 'problems':'Problem records and enhancement evidence.',
 '.github':'Continuous verification, Pages deployment, and package publishing.',
 '.codex-plugin':'Plugin discovery metadata for compatible agent hosts.',
 '.githooks':'Repository hooks; inspect before enabling locally.'
};
const excluded=new Set(['node_modules','.git','.trust','.atl-evidence','vendor','assets']);
const extensions=/\.(md|mjs|js|json|ya?ml|py|sh|cmd|ps1|scss|css|html|tla|cfg|svg|png|excalidraw|txt)$/i;
function walk(dir){return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(entry=>{const p=dir?`${dir}/${entry.name}`:entry.name;return entry.isDirectory()?(excluded.has(entry.name)?[]:walk(p)):((extensions.test(entry.name)||dir.startsWith('.githooks'))?[p]:[]);});}
function purpose(file){
 const name=path.basename(file);
 if(file==='docs/repository-map.md')return 'Generated inventory of maintained files and ownership boundaries.';
 if(['docs/search-index.json','docs/robots.txt','docs/sitemap.xml'].includes(file))return 'Generated search/discovery metadata; edit the page manifest or site generator.';
 if(file.startsWith('docs/')&&name.endsWith('.html'))return 'Generated public route; edit its Markdown source in docs/site.json.';
 if(/\.(png|svg|excalidraw)$/.test(file))return 'Visual source or retained historical capture; see the diagram library.';
 if(file.startsWith('verification/')&&name.endsWith('_test.mjs'))return `Executable regression check for ${name.replace('_test.mjs','').replaceAll('_',' ')}.`;
 if(file.startsWith('verification/fixtures/'))return 'Synthetic test input or worker; not a production execution result.';
 if(file.startsWith('commands/'))return 'Agent command wrapper; delegates to the corresponding skill.';
 if(file.includes('/SKILL.md'))return 'Authoritative agent skill contract: invocation, workflow, gates, and evidence.';
 if(file.includes('/references/'))return 'Supporting reference for its parent skill; read when that contract requires it.';
 if(file.includes('/templates/'))return 'Reusable template consumed by its parent workflow.';
 if(file.startsWith('runtime/prompts/'))return 'Role prompt defining responsibilities and evidence requirements.';
 if(file.startsWith('runtime/scss/')||file.startsWith('docs/scss/'))return 'Stylesheet source or theme token; rebuild through its package script.';
 if(file.startsWith('research/records/'))return 'Dated research decision; preserve its provenance and status.';
 if(file.startsWith('problems/'))return 'Historical problem or enhancement evidence; not a current how-to.';
 const text=read(file);const heading=text.match(/^# (.+)/m)?.[1];
 if(heading)return heading.replaceAll('|','/').slice(0,160)+'.';
 const comment=text.match(/^(?:\/\/|#)\s+([^\r\n]{12,180})/m)?.[1];
 if(comment&&!comment.startsWith('!'))return comment.replaceAll('|','/').replace(/`/g,'').trim();
 return `${name.replace(/\.[^.]+$/,'').replaceAll(/[-_]/g,' ')}: ${file.startsWith('runtime/lib/')?'runtime implementation; inspect exports and matching verification.':'source/configuration for its containing feature.'}`;
}
let catalog='# Repository file catalog\n\nGenerated by `scripts/docs-reference.mjs`. This inventories maintained public source families, including skill references and verifiers. Local state, dependencies, private evidence, generated vendor code, and curated screenshot binaries are excluded; see the [resource model](resource-model.md) for those families.\n\n## How to find a change\n\nStart with the [feature map](guides.md), search this catalog for the module or concept, then read the source and matching verifier. A file description explains its role; it does not replace its contract. Regenerate after adding or removing source files.\n';
for(const [dir,description]of Object.entries(groups)){
 if(!fs.existsSync(path.join(root,dir)))continue;
 catalog+=`\n## ${dir}\n\n${description}\n\n| File | Purpose |\n|---|---|\n`;
 const files=[...new Set([...walk(dir),...(dir==='docs'?[...JSON.parse(read('docs/site.json')).map(page=>'docs/'+page.url),'docs/search-index.json','docs/robots.txt','docs/sitemap.xml']:[])])].sort((a,b)=>a.localeCompare(b,'en'));
 for(const file of files)catalog+=`| [${file}](${file.startsWith('problems/')||file.startsWith('.')?'https://github.com/depie99/Agent-Trust-Ladder/blob/main/'+file:'../'+file}) | ${purpose(file)} |\n`;
}
catalog+='\n## Root entry points\n\n| File | Purpose |\n|---|---|\n';
for(const file of fs.readdirSync(root).filter(f=>/^(README(?:\.fa)?\.md|GUIDE\.md|USAGE\.md|package(?:-lock)?\.json|LICENSE)$/.test(f)).sort())catalog+=`| [${file}](../${file}) | ${file==='LICENSE'?'Distribution license.':purpose(file)} |\n`;
write('docs/repository-map.md',catalog);
const skills=fs.readdirSync(path.join(root,'skills')).filter(name=>fs.existsSync(path.join(root,'skills',name,'SKILL.md'))).sort();
write('docs/skills.md',`# Skill catalog\n\nSkills are engineering instruction contracts. Installing them does not start the stateful runtime or grant remote execution authority.\n\n## How to use a skill\n\nInstall as described in [getting started](getting-started.md), restart the agent, and invoke \`$atl\` with the problem. Use a specialist explicitly when its job is clear. Read its contract for prerequisites, gates, and required evidence.\n\n## Available contracts\n\n| Skill | Purpose | Source |\n|---|---|---|\n${skills.map(name=>{const text=read(`skills/${name}/SKILL.md`);const description=text.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^['"]|['"]$/g,'')||'See the skill contract for scope and workflow.';return `| \`$${name}\` | ${description.replaceAll('|','/')} | [SKILL.md](../skills/${name}/SKILL.md) |`;}).join('\n')}\n\n## Find related resources\n\nEach skill may have references, templates, helpers, or assets. Their ownership is listed in the [file catalog](repository-map.md). See [trust vocabulary](reference.md) and [Jev routing](jev.md) for process selection.\n`);
console.log('CLI, route, skill, and file references '+(process.argv.includes('--check')?'checked.':'generated.'));
