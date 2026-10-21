# Spec — 012 Archive skill adaptation

Status: approved by explicit implementation request · 2026-10-21

## Behavior

1. SEO/content requests route to `atl-content-quality` and preserve evidence
   boundaries around crawlability, metadata, schema observation, and claims.
2. Technical documentation requests route to `atl-tech-docs` with audience,
   source-of-truth, content type, examples, links, and freshness checks.
3. Site-copy and product-specific import/commit instructions from Archive are
   not presented as generic ATL behavior.
4. Archive files remain reference material; ATL remains dependency-light.

## Acceptance examples

| Given | When | Then |
|---|---|---|
| task says SEO audit | route runs | `atl-content-quality` is selected when available |
| task says developer guide | route runs | `atl-tech-docs` is selected |
| task needs both page copy and docs | route runs | specialists are named separately with distinct ownership |
| Archive-only Mishka import detail | ATL docs are read | it is not claimed as a universal command |
