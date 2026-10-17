/**
 * vars.yaml 读取与校验。
 * 变量表只放“走向分支”的数值（如三把尺 hiro.explore / meruru.explore / reia.explore）。
 * 信息差（know）与关系（rel）不进这里。
 */
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { VarDefs } from './types';

const VarDefSchema = z.object({
  min: z.number(),
  max: z.number(),
  init: z.number(),
});

const VarDefsSchema = z.record(z.string(), VarDefSchema);

/** 解析 vars.yaml 文本，返回校验通过的变量表；有问题抛中文错误 */
export function parseVars(text: string): VarDefs {
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (e) {
    throw new Error(`vars.yaml 不是合法 YAML：${(e as Error).message}`);
  }
  const result = VarDefsSchema.safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new Error(`vars.yaml 校验失败：${issue.path.join('.') || '(根)'} — ${issue.message}`);
  }
  const defs = result.data;
  for (const [name, d] of Object.entries(defs)) {
    if (d.min > d.max) throw new Error(`变量 ${name}：min(${d.min}) 大于 max(${d.max})`);
    if (d.init < d.min || d.init > d.max) {
      throw new Error(`变量 ${name}：init(${d.init}) 不在 [${d.min}, ${d.max}] 范围内`);
    }
  }
  return defs;
}

/** 按变量表生成初始变量状态 */
export function initVars(defs: VarDefs): Record<string, number> {
  const vars: Record<string, number> = {};
  for (const [name, d] of Object.entries(defs)) vars[name] = d.init;
  return vars;
}

/** 把一个变量的值夹在 [min, max] 内；变量未声明则抛错 */
export function clampVar(defs: VarDefs, name: string, value: number): number {
  const d = defs[name];
  if (!d) throw new Error(`变量 ${name} 未在 vars.yaml 声明`);
  return Math.min(d.max, Math.max(d.min, value));
}
