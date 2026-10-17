import { describe, expect, it } from 'vitest';
import { ExprError, collectVars, evalExpr, parseExpr } from '../src/engine/expr';

const vars = { 'hiro.explore': 2, 'meruru.explore': 1, 'reia.explore': 0 };

const run = (src: string, v: Record<string, number> = vars) => evalExpr(parseExpr(src), v);

describe('parseExpr / evalExpr', () => {
  it('空串恒真', () => {
    expect(run('')).toBe(true);
  });

  it('基本比较', () => {
    expect(run('hiro.explore >= 2')).toBe(true);
    expect(run('hiro.explore > 2')).toBe(false);
    expect(run('meruru.explore == 1')).toBe(true);
    expect(run('reia.explore != 0')).toBe(false);
    expect(run('5 > 3')).toBe(true);
  });

  it('&& 与 ||', () => {
    expect(run('hiro.explore >= 2 && meruru.explore >= 2')).toBe(false);
    expect(run('hiro.explore >= 2 || meruru.explore >= 2')).toBe(true);
  });

  it('! 与非零真值', () => {
    expect(run('!reia.explore')).toBe(true);
    expect(run('hiro.explore')).toBe(true);
    expect(run('reia.explore')).toBe(false);
  });

  it('括号改变优先级', () => {
    expect(run('(hiro.explore >= 2 || meruru.explore >= 2) && reia.explore >= 2')).toBe(false);
    expect(run('hiro.explore >= 2 && (meruru.explore >= 2 || reia.explore >= 2)')).toBe(false);
  });

  it('&& 优先级高于 ||', () => {
    // a || b && c  等价  a || (b && c)
    expect(run('reia.explore >= 2 || hiro.explore >= 2 && meruru.explore >= 2')).toBe(false);
    expect(run('reia.explore >= 2 || hiro.explore >= 2 && meruru.explore >= 1')).toBe(true);
  });

  it('解析非法字符报错', () => {
    expect(() => parseExpr('hiro.explore @ 2')).toThrow(ExprError);
  });

  it('括号不闭合报错', () => {
    expect(() => parseExpr('(hiro.explore >= 2')).toThrow(/右括号/);
  });

  it('表达式结尾多余内容报错', () => {
    expect(() => parseExpr('hiro.explore >= 2 3')).toThrow(/多余/);
  });

  it('求值遇到未声明变量报错', () => {
    expect(() => run('nope.x >= 1')).toThrow(/未声明的变量/);
  });
});

describe('真实路由条件', () => {
  it('第四章四条件按尺判断', () => {
    // explore(蕾雅)<2 最先命中
    expect(run('reia.explore < 2')).toBe(true);
  });
});

describe('collectVars', () => {
  it('收集表达式中的全部变量名', () => {
    const set = collectVars(parseExpr('(hiro.explore >= 2 && meruru.explore < 2) || !reia.explore'));
    expect([...set].sort()).toEqual(['hiro.explore', 'meruru.explore', 'reia.explore']);
  });

  it('纯数字表达式不收集变量', () => {
    expect(collectVars(parseExpr('5 > 3')).size).toBe(0);
  });
});
