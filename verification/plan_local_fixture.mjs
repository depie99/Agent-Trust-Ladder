// Test fixture: the legacy local plan shape (generic template paths, typed
// cards, no plan_contract_version) as it existed before local generation
// became skeleton-only. Production generateLocalPlan now returns a
// non-approvable skeleton; suites that exercise card editing and approval on
// a full draft rebuild the legacy shape here.
import { generateLocalPlan } from "../runtime/lib/plan-studio.mjs";

export function legacyLocalPlan(intent) {
  const skeleton = generateLocalPlan(intent);
  return {
    ...skeleton,
    plan_skeleton: undefined,
    stage: "plan",
    completion_checks: [
      "The requested behavior is observable from the real user-facing surface.",
      "Regression checks cover the changed state and interaction contracts.",
      "Failure and recovery behavior remain explicit and auditable.",
    ],
    acceptance_examples: [
      { given: "the requested change is implemented", when: "the owner reviews it against the original request", then: "the stated outcome and constraints can be demonstrated" },
      { given: "a relevant failure or edge case", when: "the change is exercised", then: "the result is checked against the agreed behavior" },
    ],
    implementation_steps: [
      { step: "Specify observable behavior and preserve the approved intent", files: ["project specification and affected contracts"], verify: "Review acceptance examples and scope boundaries" },
      { step: "Write or strengthen failing regression checks", files: ["verification/"], verify: "Run the focused tests and observe the intended failure before implementation" },
      { step: "Implement the smallest complete vertical slice", files: ["responsible runtime and UI modules"], verify: "Run the focused tests and inspect the real surface" },
      { step: "Verify recovery, adjacent behavior, and evidence", files: ["runtime evidence and task brief"], verify: "Run the project checks and record observed versus unobserved boundaries" },
    ],
    verifier_commands: ["Not determined: identify actual project-specific checks during review."],
    task_proposals: [
      { id: "p1", source: "local", title: "Specify observable behavior", objective: `Specify observable behavior and preserve the approved intent.\n\nOriginal request:\n${skeleton.objective}`, completion_checks: ["Acceptance examples and scope boundaries are reviewed and recorded"], proposed_worker: "rowan", selected_skills: ["atl-specify"], depends_on: [], files: ["project specification and affected contracts"], verify: "Review acceptance examples and scope boundaries" },
      { id: "p2", source: "local", title: "Write failing regression checks", objective: `Write or strengthen failing regression checks.\n\nOriginal request:\n${skeleton.objective}`, completion_checks: ["Focused tests exist and observed the intended failure before implementation"], proposed_worker: "pip", selected_skills: ["atl-verify"], depends_on: ["p1"], files: ["verification/"], verify: "Run the focused tests and observe the intended failure before implementation" },
      { id: "p3", source: "local", title: "Implement the vertical slice", objective: `Implement the smallest complete vertical slice.\n\nOriginal request:\n${skeleton.objective}`, completion_checks: ["Focused tests pass and the real surface shows the behavior"], proposed_worker: "pip", selected_skills: ["atl-implement"], depends_on: ["p2"], files: ["responsible runtime and UI modules"], verify: "Run the focused tests and inspect the real surface" },
      { id: "p4", source: "local", title: "Verify recovery and evidence", objective: `Verify recovery, adjacent behavior, and evidence.\n\nOriginal request:\n${skeleton.objective}`, completion_checks: ["Project checks pass and observed versus unobserved boundaries are recorded"], proposed_worker: "pip", selected_skills: ["atl-verify"], depends_on: ["p3"], files: ["runtime evidence and task brief"], verify: "Run the project checks and record observed versus unobserved boundaries" },
    ],
    generated_by: "atl-local-sdd-tdd-planner",
  };
}
