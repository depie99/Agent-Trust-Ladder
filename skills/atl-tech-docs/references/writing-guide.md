# Technical documentation writing guide

## Content contract

Before writing, record:

- audience and prerequisite knowledge;
- one primary task or concept;
- scope and non-scope;
- expected reader outcome;
- terminology and source-of-truth links;
- version, locale, accessibility, and publication constraints.

## Style

- Lead with the conclusion, goal, or expected result.
- Use plain, precise, active language and short sentences.
- Address the reader as `you` when instructions require an actor.
- Use numbered steps for ordered procedures and bullets for unordered choices.
- Put conditions before the instruction they qualify.
- Define unfamiliar terms and expand acronyms at first use.
- Use one term for one concept; do not alternate between synonyms for style.
- Prefer literal, objective language. Avoid vague words such as "simply," "easy," "properly," and "quickly."
- State the trigger condition and the consequence in every warning: what causes the failure and what breaks.
- Use present tense for stable behavior; future tense only for planned changes.
- Delete outdated content. Do not leave "this may be outdated" hedges in place.
- Use headings, tables, code blocks, examples, and links to make content scannable. Keep emphasis sparse.
- Write inclusive, accessible content; provide useful alt text and do not put essential meaning only in an image.

## Banned patterns

- Marketing hype and unsupported superlatives ("blazingly fast", "best-in-class") — state measured behavior or nothing.
- Claims about performance, security, or compatibility without a source observation.
- AI disclaimers and self-reference ("As an AI model…", "I hope this helps").
- Conclusion filler that restates the page ("In conclusion…").
- Clichés and metaphors where a precise statement exists.

## Agents are readers

Documentation is retrieved by AI agents as well as humans, so:

- Make every section self-contained: an agent should answer the heading's question from that section alone.
- Never point across sections with "as mentioned above", "this", or "it" — name the thing.
- Use descriptive, unique headings that state the section's question or task.
- Use one identifier-consistent name per concept; match the code's own names.
- Keep examples complete and copyable, with expected output where success must be recognized.

## Procedures and examples

Every procedure should state prerequisites, actions, expected result, and recovery/troubleshooting where failure is plausible. Keep steps atomic and verify commands in the real repository. Examples should be copyable, safe, complete enough to run, and labeled when they are illustrative rather than production-ready.

## Editing pass

1. Remove material outside scope.
2. Put the most important information first.
3. Check terminology, links, headings, code formatting, and version claims.
4. Read from the audience's starting point, not the author's implementation history.
5. Review as a user: run the commands; confirm the reader can recognize success and recover from the most plausible failure.
6. Review as a retrieval target: sample sections; each must answer its heading without the page's earlier sections.
7. Ask for peer or subject-matter review when correctness cannot be established from the repository.
