import { z } from 'zod';
export const GURI_TOOL_SCHEMAS = {
  find_leads: z.strictObject({ query: z.string().min(1).max(100) }),
  list_lead_tasks: z.strictObject({ leadId: z.number().int().positive() }),
  create_lead_task: z.strictObject({
    leadId: z.number().int().positive(),
    type: z.enum(['CALL', 'EMAIL', 'MEETING', 'WAITING']),
    dueDate: z.iso.date(),
    dueTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .default(null),
    notes: z.string().max(2000).nullable().default(null),
  }),
};
export type GuriTool = keyof typeof GURI_TOOL_SCHEMAS;
export const GURI_EFFECTS: Record<GuriTool, 'read' | 'mutation'> = {
  find_leads: 'read',
  list_lead_tasks: 'read',
  create_lead_task: 'mutation',
};
export function guriTool(name: string): GuriTool {
  if (!Object.hasOwn(GURI_TOOL_SCHEMAS, name))
    throw new Error(`GURI_UNSUPPORTED: ${name}; capability not implemented in the lead-task slice`);
  return name as GuriTool;
}
