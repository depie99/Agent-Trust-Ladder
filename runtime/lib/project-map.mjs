// Projects work map: how imported requests, plans, plan queues and executable
// tasks relate to each registered repository. Read-only and derived on every
// call from the durable records (state.json tasks, the queue book, Plan
// Studio draft envelopes, the supervisor registry) so it can never drift.
import fs from "node:fs";
import path from "node:path";
import { loadState } from "./state.mjs";
import { queueList } from "./queue.mjs";
import { supervisorSnapshot } from "./supervisor.mjs";
import { planDraftIndex, requestRepositoryIds } from "./plan-studio.mjs";
import { qualifyTaskId } from "./task-refs.mjs";

const IMPORTED = new Set(["azure", "github", "jira"]);
const CLOSED = new Set(["done", "rejected", "archived"]);
const BLOCKED = new Set(["blocked", "escalated"]);
const ACTIVE = new Set(["in_progress", "in_review", "verifying"]);

// Branch comes from .git/HEAD directly: no git process per repository.
function repositoryHealth(root) {
  let exists = false;
  try { exists = fs.statSync(root).isDirectory(); } catch { return { exists, git: false, branch: null }; }
  const dotGit = path.join(root, ".git");
  try {
    if (!fs.statSync(dotGit).isDirectory()) return { exists, git: true, branch: null };
    const head = fs.readFileSync(path.join(dotGit, "HEAD"), "utf8").trim();
    return { exists, git: true, branch: head.startsWith("ref: refs/heads/") ? head.slice(16) : `detached ${head.slice(0, 8)}` };
  } catch { return { exists, git: false, branch: null }; }
}

const sourceView = (task) => ({ type: task.source?.type || null, remote_id: task.source?.remote_id ?? null, url: /^https:\/\//i.test(task.source?.url || "") ? task.source.url : null });
const itemId = (item) => item?.id || item?.taskId || null;

export function projectWorkMap(root) {
  const supervisor = supervisorSnapshot();
  const projects = supervisor.projects || [];
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const tasks = Object.values(loadState(root).tasks || {});
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const drafts = planDraftIndex(root);
  const queues = queueList(root, { includeArchived: false });
  const queueOf = new Map();
  for (const queue of queues) for (const item of queue.items || []) if (itemId(item) && !queueOf.has(itemId(item))) queueOf.set(itemId(item), queue.id);
  const requests = tasks.filter((task) => IMPORTED.has(task.source?.type) && !["archived", "rejected"].includes(task.status));
  const sourceTitle = (taskId) => (taskId ? taskById.get(taskId)?.title || null : null);

  const repositories = projects.map((project) => {
    const linked = requests.filter((task) => requestRepositoryIds(task).includes(project.id)).map((task) => {
      const here = drafts.filter((draft) => draft.source_task_id === task.id && draft.repository?.id === project.id);
      const approved = here.find((draft) => draft.approved) || null;
      const latest = approved || here[0] || null;
      return {
        id: task.id, qualified_id: qualifyTaskId(project, task.id), title: task.title, source: sourceView(task), imported_at: task.imported_at || task.created_at || null,
        status: approved ? "planned" : latest ? "drafting" : "needs-plan",
        draft: latest ? { id: latest.id, stage: latest.stage, review: latest.review, approved: latest.approved, queue_id: latest.queue_id } : null,
        draft_count: here.length,
        also: requestRepositoryIds(task).filter((id) => id !== project.id).map((id) => ({ id, name: names.get(id) || "unregistered repository", registered: names.has(id) })),
      };
    });
    const plans = drafts.filter((draft) => draft.repository?.id === project.id).map((draft) => ({ ...draft, source_title: sourceTitle(draft.source_task_id) }));
    const repoTasks = tasks.filter((task) => task.repository_id === project.id && !task.intake_only && task.status !== "archived");
    const repoTaskIds = new Set(repoTasks.map((task) => task.id));
    const repoQueues = queues.filter((queue) => queue.repository_id === project.id || (queue.items || []).some((item) => repoTaskIds.has(itemId(item)))).map((queue) => {
      const members = (queue.items || []).map((item) => taskById.get(itemId(item))).filter(Boolean);
      const draft = queue.plan_draft_id ? drafts.find((entry) => entry.id === queue.plan_draft_id) : null;
      return {
        id: queue.id, name: queue.name || queue.id, status: queue.status || null, plan_draft_id: queue.plan_draft_id || null,
        source_task_id: draft?.source_task_id || null, source_title: sourceTitle(draft?.source_task_id),
        total: members.length, done: members.filter((task) => task.status === "done").length,
        active: members.filter((task) => ACTIVE.has(task.status)).length, blocked: members.filter((task) => BLOCKED.has(task.status)).length,
        queued: members.filter((task) => task.status !== "done" && !ACTIVE.has(task.status) && !BLOCKED.has(task.status)).length,
        task_ids: members.map((task) => task.id),
      };
    });
    const taskRows = repoTasks.map((task) => ({
      id: task.id, qualified_id: qualifyTaskId(project, task.id), title: task.title, status: task.status, worker: task.proposed_worker || null, queue_id: queueOf.get(task.id) || task.plan_queue_id || null,
      plan_draft_id: task.plan_draft_id || null, depends_on: task.plan_depends_on || [], updated_at: task.updated_at || null,
      blocker: BLOCKED.has(task.status) ? task.blocker?.reason || task.waiting_reason || null : null,
    }));
    const taskRowsById = new Map(taskRows.map((task) => [task.id, task]));
    const workstreams = linked.map((request) => {
      const requestPlans = plans.filter((plan) => plan.source_task_id === request.id);
      const branches = requestPlans.map((plan) => {
        const queue = repoQueues.find((entry) => entry.plan_draft_id === plan.id) || null;
        const branchTasks = (queue?.task_ids || []).map((id) => taskRowsById.get(id)).filter(Boolean);
        return { plan, queue, tasks: branchTasks };
      });
      return { request, branches };
    });
    return {
      id: project.id, name: project.name, root: project.root, maxConcurrent: project.maxConcurrent, registered_at: project.registered_at || null,
      health: repositoryHealth(project.root),
      requests: linked, plans, queues: repoQueues, tasks: taskRows, workstreams,
      counts: {
        requests: linked.length, needs_plan: linked.filter((request) => request.status !== "planned").length,
        plans: plans.length, queues: repoQueues.length, tasks: taskRows.length,
        open: taskRows.filter((task) => !CLOSED.has(task.status)).length, active: taskRows.filter((task) => ACTIVE.has(task.status)).length,
        blocked: taskRows.filter((task) => BLOCKED.has(task.status)).length, done: taskRows.filter((task) => task.status === "done").length,
      },
    };
  });

  // Requests with no registered repository: never linked, or linked only to
  // repositories that were since removed from the registry.
  const unassigned = requests.filter((task) => !requestRepositoryIds(task).some((id) => names.has(id))).map((task) => ({
    id: task.id, title: task.title, source: sourceView(task), imported_at: task.imported_at || task.created_at || null,
    needs_plan: Boolean(task.plan_review_required), draft_count: drafts.filter((draft) => draft.source_task_id === task.id).length,
    stale_links: requestRepositoryIds(task).filter((id) => !names.has(id)).length,
  }));
  const workspaceTasks = tasks.filter((task) => !task.repository_id && !task.intake_only && task.plan_draft_id && task.status !== "archived");
  return {
    generated_at: new Date().toISOString(),
    defaults: supervisor.defaults || {},
    repositories,
    unassigned,
    workspace: {
      plans: drafts.filter((draft) => !draft.repository).length,
      queues: queues.filter((queue) => queue.plan_draft_id && !queue.repository_id).length,
      tasks: workspaceTasks.length,
    },
  };
}
