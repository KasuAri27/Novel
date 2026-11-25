/**
 * DSL 抽象语法树类型：解析器把文本行先归为这些结构，再由 compiler 组装成 Story。
 */
import type { Condition, Effect } from '../engine/types';

export interface StoryMetaDecl {
  id: string;
  title: string;
}

export interface CharDecl {
  id: string;
  name: string;
  immortal: boolean;
  asset?: string;
  me?: boolean;
  color?: string;
}

export interface FactDecl {
  id: string;
  label?: string;
}

/** 节点体内的一行内容（no 为源行号，供校验期报错定位） */
export type NodeItem =
  | { kind: 'line'; speaker: string | null; text: string; no: number }
  | { kind: 'goto'; target: string; no: number }
  | { kind: 'enter'; effects: Effect[]; no: number }
  | {
      kind: 'choice';
      label: string;
      goto: string;
      when: Condition;
      do: Effect[];
      no: number;
    };

export interface NodeDecl {
  id: string;
  items: NodeItem[];
  no: number;
}

export interface EndDecl {
  id: string;
  title: string;
  text: string;
  when: Condition;
  priority: number;
  no: number;
}

/** 一个文本文件解析后的 AST */
export interface FileAst {
  meta?: StoryMetaDecl;
  chars: CharDecl[];
  facts: FactDecl[];
  nodes: NodeDecl[];
  ends: EndDecl[];
  /** 显式入口节点（@entry） */
  entry?: string;
}
