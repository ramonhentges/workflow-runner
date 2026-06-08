import { z } from 'zod'
import type { Cwd } from '@/stores/cwd-store'

/**
 * Schema for the register-directory form. `.trim()` normalizes the values so a
 * whitespace-only entry fails `min(1)` and the stored value is always trimmed.
 * Uniqueness is checked against the directories that already exist (case-insensitive
 * label, exact path); pass `excludeId` when editing so a row doesn't clash with itself.
 */
export function cwdFormSchema(existing: Cwd[], options?: { excludeId?: string }) {
  const others = options?.excludeId
    ? existing.filter(c => c.id !== options.excludeId)
    : existing

  return z
    .object({
      label: z
        .string()
        .trim()
        .min(1, 'Label is required')
        .max(60, 'Label must be 60 characters or fewer'),
      path: z
        .string()
        .trim()
        .min(1, 'Path is required')
        .max(4096, 'Path is too long')
        .refine(
          v => v.startsWith('/') || v.startsWith('~'),
          'Enter an absolute path (starting with / or ~)',
        ),
    })
    .superRefine((val, ctx) => {
      if (others.some(c => c.label.toLowerCase() === val.label.toLowerCase())) {
        ctx.addIssue({
          code: 'custom',
          path: ['label'],
          message: 'A directory with this label already exists',
        })
      }
      if (others.some(c => c.path === val.path)) {
        ctx.addIssue({
          code: 'custom',
          path: ['path'],
          message: 'This path is already registered',
        })
      }
    })
}

export type CwdFormValues = z.infer<ReturnType<typeof cwdFormSchema>>
