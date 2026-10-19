# Documentation type chooser

Choose a document from the reader's need and primary outcome. Do not combine unrelated needs into one page.

| Reader need | Document type | The page should answer |
|---|---|---|
| Learn a skill | Tutorial / quickstart | Can you teach me to do this? |
| Complete a task | How-to / runbook | How do I achieve this goal safely? |
| Look up exact facts | Reference / API or config reference | What are the supported facts, fields, defaults, and limits? |
| Understand why | Explanation / architecture overview | Why does this work this way? |
| Record a durable choice | ADR / decision record | What was chosen, why, and what follows from it? |
| Shape a product or business outcome | Product brief / PRD / business brief | Who needs what value, under which constraints, and how will success be known? |
| Describe a business process | BPMN companion / process guide | Who does what, in what order, with which decisions and outcomes? |
| Operate or recover a system | Runbook / troubleshooting guide | What should the operator observe and do next? |

## Minimal classifier

```text
Audience:
User situation: learning, working, looking up, deciding, operating, or understanding
Primary outcome:
Source of truth:
```

Return one primary type, one optional companion link, and the source/owner/update trigger. A business brief is not a technical reference; a tutorial is not a runbook; an ADR is not a task list.

The four learning/work/knowledge needs follow [Diátaxis](https://diataxis.fr/start-here/): tutorial, how-to, reference, and explanation. Business, product, architecture, and operational documents are domain shapes layered on top of those reader needs, not replacements for them.
