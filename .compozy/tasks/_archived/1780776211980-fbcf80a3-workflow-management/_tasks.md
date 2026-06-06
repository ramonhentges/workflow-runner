# Workflow Management (Create, Edit, Delete) — Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | API schemas and error codes for workflow CRUD and IDE catalog | completed | medium | — |
| 02 | Run-active guard helper | completed | low | task_01 |
| 03 | Workflow CRUD routes (read-one, create, update/rename, delete) | completed | high | task_01, task_02 |
| 04 | probeIdeCatalog ACP discovery probe | completed | medium | — |
| 05 | GET /ide/{ide}/catalog route | completed | medium | task_01, task_04 |
| 06 | Web API client functions and wire types | completed | medium | task_01 |
| 07 | Workflows list page with delete and navigation | completed | medium | task_03, task_06 |
| 08 | Workflow editor (create/edit) with react-hook-form and zod | completed | high | task_03, task_06 |
| 09 | Agent/model picker wired to the IDE catalog | completed | medium | task_05, task_06, task_08 |
| 10 | Documentation update (README and CLAUDE.md) | completed | low | task_03, task_05, task_09 |
