// Local, pinned Mermaid bundle; diagrams never require a CDN.
if(document.querySelector('.mermaid'))try {
  await new Promise((resolve,reject)=>{ const script=document.createElement('script'); script.src='vendor/mermaid.min.js'; script.onload=resolve; script.onerror=reject; document.head.append(script); });
  globalThis.mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral',flowchart:{htmlLabels:false},suppressErrorRendering:true});
  await globalThis.mermaid.run({querySelector:'.mermaid'});
} catch (error) {
  document.documentElement.dataset.diagramError='true';
  console.error('Documentation diagram failed',error);
}
