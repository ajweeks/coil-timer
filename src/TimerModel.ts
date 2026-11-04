import z from 'zod';
import { TimerRestorePointSchema } from './TimerRestorePoint';
import { TimerStateSchema } from './TimerState';

export const SessionHistoryEntrySchema = z.object({
  id: z.string(),
  duration: z.number(),
  mode: z.enum(['hours', 'minutes']),
  name: z.string().max(150).optional(),
  timestamp: z.number(),
});
export type SessionHistoryEntry = z.infer<typeof SessionHistoryEntrySchema>;

export const TimerModelSchema = z.object({
  state: TimerStateSchema,
  restorePoint: TimerRestorePointSchema,
  sessionHistory: z.array(SessionHistoryEntrySchema).default([]),
  accumulatedMs: z.number().default(0), // total ms across all continues since last Log
});
export type TimerModel = z.infer<typeof TimerModelSchema>;
