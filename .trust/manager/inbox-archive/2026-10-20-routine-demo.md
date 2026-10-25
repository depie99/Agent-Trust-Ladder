# Inbox — routine flow demo

## Fix API timeout on bulk import endpoint
@source: https://devops.soitco.net:32678/Solico-Group/Middleware-and-Portals/_workitems/edit/5312
@priority: normal
Bulk import over 500 rows hits the gateway timeout.
Checks:
- bulk import of 500 rows completes under the gateway timeout
- partial failures return a resumable batch id
