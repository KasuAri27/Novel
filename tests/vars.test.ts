import { describe, expect, it } from 'vitest';
import { clampVar, initVars, parseVars } from '../src/engine/vars';

const SAMPLE = `
# 全局变量表
hiro.explore:   { min: 0, max: 3, init: 0 }
meruru.explore: { min: 0, max: 3, init: 1 }
reia.explore:   { min: 0, max: 3, init: 0 }
`;

describe('parseVars', () => {
  it('解析三把尺并返回带默认值的变量表', () => {
    const defs = parseVars(SAMPLE);
    expect(Object.keys(defs)).toEqual(['hiro.explore', 'meruru.explore', 'reia.explore']);
    expect(defs['hiro.explore']).toEqual({ min: 0, max: 3, init: 0 });
    expect(defs['meruru.explore']!.init).toBe(1);
  });

  it('空文件得到空表', () => {
    expect(parseVars('')).toEqual({});
  });

  it('min 大于 max 报错', () => {
    expect(() => parseVars('a: { min: 3, max: 1, init: 2 }')).toThrow(/min/);
  });

  it('init 越界报错', () => {
    expect(() => parseVars('a: { min: 0, max: 3, init: 9 }')).toThrow(/init/);
  });

  it('缺少字段报错', () => {
    expect(() => parseVars('a: { min: 0, max: 3 }')).toThrow(/校验失败/);
  });
});

describe('initVars', () => {
  it('按 init 生成初始状态', () => {
    expect(initVars(parseVars(SAMPLE))).toEqual({
      'hiro.explore': 0,
      'meruru.explore': 1,
      'reia.explore': 0,
    });
  });
});

describe('clampVar', () => {
  const defs = parseVars(SAMPLE);
  it('低于下限夹到 min', () => {
    expect(clampVar(defs, 'hiro.explore', -5)).toBe(0);
  });
  it('高于上限夹到 max', () => {
    expect(clampVar(defs, 'hiro.explore', 99)).toBe(3);
  });
  it('区间内保持不变', () => {
    expect(clampVar(defs, 'hiro.explore', 2)).toBe(2);
  });
  it('未声明变量报错', () => {
    expect(() => clampVar(defs, 'nope.x', 1)).toThrow(/未在 vars.yaml 声明/);
  });
});
