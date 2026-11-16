export interface DomCommand {
  action: 'tap' | 'type' | 'clear'; selector: string; url: string;
  tag: string; text: string; label: string; value?: string;
}
export interface DomActionOutcome { outcome: 'completed' | 'rejected'; code?: string; }
export function performDomAction(command: DomCommand): DomActionOutcome;
