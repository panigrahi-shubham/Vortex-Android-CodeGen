// Types for the parts of tree.js used from TypeScript.
export interface TreeNode {
  id: number;
  parentId: number | null;
  childIds: number[];
  depth: number;
  ref: string;
  type: string;
  text: string;
  label: string;
  identifier: string;
  placeholder: string;
  rect: { x: number; y: number; w: number; h: number };
  selected: boolean;
  checked: boolean | null;
  enabled: boolean;
  target?: unknown;
}
export function parseTree(raw: Buffer | string): TreeNode[];
export function appNodes(nodes: TreeNode[], pkg: string, extraPackages?: string[]): TreeNode[];
export function detectPackage(nodes: TreeNode[]): string | null;
