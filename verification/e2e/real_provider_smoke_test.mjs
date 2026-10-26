const provider = process.env.ATL_SMOKE_PROVIDER;
const credential = process.env.ATL_SMOKE_CREDENTIAL;
if (!provider || !credential) { console.log("BLOCKED: real-provider containment smoke test requires ATL_SMOKE_PROVIDER and ATL_SMOKE_CREDENTIAL; no live credentials were used"); process.exit(0); }
console.log(`READY: real-provider smoke adapter ${provider} supplied; execute the adapter-specific containment contract before marking PASS`);
