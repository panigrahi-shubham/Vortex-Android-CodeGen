export interface DomNode {
  id: string; tag: string; text: string; label: string; domId: string; role: string;
  editable: boolean; sensitive: boolean; enabled: boolean;
  selector: string; matches: number; source: string;
  alternatives: { selector: string; matches: number; source: string }[];
  warnings: string[];
  rect: { x: number; y: number; width: number; height: number };
}
export interface DomSnapshot {
  url: string; title: string; capturedAt: string;
  viewport: { width: number; height: number };
  nodes: DomNode[]; frames: number; truncated: boolean; limitations: string;
}
export function collectDomSnapshot(): DomSnapshot;
