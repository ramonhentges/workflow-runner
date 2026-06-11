// The start-run picker consumes the same combined (global + project) workflow
// list as the workflows feature. Re-export the shared hook so there is a single
// source of truth for the list query and its key (`workflowListQueryKey`),
// keeping the picker in sync with the create/edit/delete mutation invalidations
// (see useWorkflow.ts) and avoiding latent query-key drift.
export { useWorkflowList as useWorkflows } from '@/features/workflows/useWorkflowList'
