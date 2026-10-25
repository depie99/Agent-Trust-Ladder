## Reconcile bounded memory and learning
@priority: normal
@risk: normal
@labels: memory,learning,mem0

Reconcile the local learning journal and optional Mem0 graph memory against its spec. Keep default ATL deterministic and low-token.
Checks:
  - local learning is bounded and inspectable
  - Mem0 is optional and failure-safe
  - memory cannot override policy or evidence

## Reconcile low-token Jev routing
@priority: normal
@risk: normal
@labels: jev,routing,tokens

Reconcile the optional Jev decision aid against its spec. Keep deterministic routing as the default and fallback.
Checks:
  - default route makes no network/model call
  - smart route sends only compact task fields
  - low confidence and failures fall back honestly

## Reconcile ATL package and installer
@priority: high
@risk: normal
@labels: package,install,github

Reconcile the installable ATL package, user-level installer, project init, and GitHub Packages workflow.
Checks:
  - package dry-run contains required files
  - init separates user install from project state
  - no third-party vendor directories are created

## Reconcile visual handoffs without vendor directories
@priority: normal
@risk: normal
@labels: visual,pr,show-me

Reconcile show-me and visual-pr output, compact diagrams, and the rule that external HumanLayer skills are never copied into ATL.
Checks:
  - multi-file output is compact and evidence-shaped
  - unavailable screenshots are not invented
  - repository contains no .humanlayer task directory

## Reconcile the ATL team runtime and owner guide
@priority: high
@risk: normal
@labels: team,runtime,overnight

Reconcile installation, init, role usage, bounded local worker execution, and overnight documentation.
Checks:
  - owner can install and initialize a target project
  - bounded worker sessions stop at limits and log evidence
  - open laptop and Claude cloud are not described as hidden local daemons

## Adapt Archive content and docs skills
@priority: normal
@risk: normal
@labels: seo,content,docs,archive

Reconcile the archived SEO, site-copy, and docs-writing skills with native ATL content and technical-doc routes.
Checks:
  - SEO tasks select atl-content-quality
  - technical docs tasks select atl-tech-docs
  - product-specific Archive commands are not misrepresented as ATL behavior
