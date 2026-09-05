import type { Node, Root } from 'mdast';

export type EntityKind = 'task' | 'inbox';

export interface EntityToken {
  kind: EntityKind;
  id: string;
  start: number;
  end: number;
}

export type RenderPart =
  | { type: 'text'; value: string }
  | { type: 'entity'; token: EntityToken };

export interface VitalEntity extends Node {
  type: 'vitalEntity';
  kind: EntityKind;
  id: string;
}

export interface FillHeadings {
  tasks: string;
  inbox: string;
}

export interface PmMark {
  type: string;
  attrs?: Record<string, string | number | boolean | null>;
}

export interface PmNode {
  type: string;
  attrs?: Record<string, string | number | boolean | null>;
  content?: PmNode[];
  marks?: PmMark[];
  text?: string;
}

export type MdastRoot = Root;

declare module 'mdast' {
  interface PhrasingContentMap {
    vitalEntity: VitalEntity;
  }
  interface RootContentMap {
    vitalEntity: VitalEntity;
  }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    vitalEntity: 'vitalEntity';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isVitalEntity(node: unknown): node is VitalEntity {
  if (!isRecord(node) || node.type !== 'vitalEntity') return false;
  return (
    (node.kind === 'task' || node.kind === 'inbox') && typeof node.id === 'string' && node.id !== ''
  );
}

export function isEntityKind(value: string): value is EntityKind {
  return value === 'task' || value === 'inbox';
}
