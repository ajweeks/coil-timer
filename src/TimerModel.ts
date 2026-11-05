import z from 'zod';
import { TimeBlockSchema } from './TimeBlocks';
import { TimerRestorePointSchema } from './TimerRestorePoint';
import { TimerStateSchema } from './TimerState';

export const TimerModelSchema = z.object({
  state: TimerStateSchema,
  restorePoint: TimerRestorePointSchema,
  blocks: z.array(TimeBlockSchema).default([]),
  runningSince: z.number().nullable().default(null),
});
export type TimerModel = z.infer<typeof TimerModelSchema>;
