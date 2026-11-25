/**
 * 内部 Story 模型的 zod schema —— 内容层与引擎层的边界契约。
 * compiler 产出 Story 后用其校验；任何解析/拼装错误都会在此暴露。
 */
import { z } from 'zod';

export const compareOpSchema = z.enum(['>=', '<=', '>', '<', '==', '!=']);

export const conditionSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('lit'), value: z.boolean() }),
    z.object({
      kind: z.literal('atom'),
      verb: z.string().min(1),
      args: z.array(z.string()),
      op: compareOpSchema.optional(),
      value: z.number().optional(),
    }),
    z.object({ kind: z.literal('and'), parts: z.array(conditionSchema) }),
    z.object({ kind: z.literal('or'), parts: z.array(conditionSchema) }),
    z.object({ kind: z.literal('not'), part: conditionSchema }),
  ]),
);

export const effectSchema = z.object({
  verb: z.string().min(1),
  args: z.array(z.string()),
  value: z.union([z.number(), z.string(), z.boolean()]).optional(),
});

export const lineSchema = z.object({
  speaker: z.string().nullable(),
  text: z.string(),
});

export const choiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  goto: z.string(),
  when: conditionSchema,
  do: z.array(effectSchema),
});

export const nodeSchema = z.object({
  id: z.string(),
  lines: z.array(lineSchema),
  onEnter: z.array(effectSchema),
  choices: z.array(choiceSchema),
  next: z.string().nullable(),
});

export const charSchema = z.object({
  id: z.string(),
  name: z.string(),
  immortal: z.boolean(),
  asset: z.string().optional(),
  me: z.boolean().optional(),
  color: z.string().optional(),
});

export const endingSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  when: conditionSchema,
  priority: z.number(),
});

export const storySchema = z.object({
  meta: z.object({
    id: z.string(),
    title: z.string(),
    sources: z.array(z.string()),
  }),
  chars: z.record(charSchema),
  facts: z.record(z.object({ label: z.string().optional() })),
  entry: z.string(),
  nodes: z.record(nodeSchema),
  endings: z.array(endingSchema),
});

export type StoryInput = z.infer<typeof storySchema>;
