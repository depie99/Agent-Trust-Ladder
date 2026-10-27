// Disposable fixture server for browser verification; never uses live manager state.
import { fixture } from "./project.mjs";
import { captureChangeReview } from "../../../runtime/lib/change-review-store.mjs";
import { startControlPlaneServer } from "../../../runtime/lib/control-plane-server.mjs";
const f = fixture(); f.edit();
for (let i = 0; i < 110; i++) f.write(`samples/file-${String(i).padStart(3, "0")}.txt`, `sample ${i}\n`);
const capture = captureChangeReview(f.root, f.task);
f.task.evidence = [{ kind: "check", check: "behavior", result: "pass", coverage: "complete", code_revision: capture.output.revision, packet_revision: 1, actor: "beacon" }, { kind: "review", result: "approve", code_revision: f.task.handoff_baseline.revision, packet_revision: 1, actor: "sage" }];
f.persist();
const running = await startControlPlaneServer(f.root);
console.log(running.url);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { running.server.close(() => { f.cleanup(); process.exit(0); }); running.server.closeAllConnections(); });
