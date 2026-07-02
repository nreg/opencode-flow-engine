export interface MailMessage {
  from: string;
  to: string;
  type: string;
  payload: unknown;
  timestamp: Date;
  id: string;
}

type MessageHandler = (msg: MailMessage) => void | Promise<void>;

let msgCounter = 0;

export class Mailbox {
  private inbox: MailMessage[] = [];
  private handlers = new Map<string, Set<MessageHandler>>();
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  send(to: string, type: string, payload: unknown): MailMessage {
    const msg: MailMessage = {
      from: this.agentId,
      to,
      type,
      payload,
      timestamp: new Date(),
      id: `msg_${++msgCounter}`,
    };
    return msg;
  }

  receive(msg: MailMessage): void {
    if (msg.to !== this.agentId && msg.to !== '*') return;
    this.inbox.push(msg);
    const handlers = this.handlers.get(msg.type);
    if (handlers) {
      for (const handler of handlers) {
        Promise.resolve(handler(msg));
      }
    }
  }

  on(type: string, handler: MessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  off(type: string, handler: MessageHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  drain(type?: string): MailMessage[] {
    if (type) {
      const filtered = this.inbox.filter(m => m.type === type);
      this.inbox = this.inbox.filter(m => m.type !== type);
      return filtered;
    }
    const all = [...this.inbox];
    this.inbox = [];
    return all;
  }

  get pendingCount(): number {
    return this.inbox.length;
  }
}

export class MessageBus {
  private mailboxes = new Map<string, Mailbox>();

  register(agentId: string): Mailbox {
    const mb = new Mailbox(agentId);
    this.mailboxes.set(agentId, mb);
    return mb;
  }

  unregister(agentId: string): void {
    this.mailboxes.delete(agentId);
  }

  dispatch(msg: MailMessage): void {
    const recipient = this.mailboxes.get(msg.to);
    if (recipient) {
      recipient.receive(msg);
    }
    const wildcard = this.mailboxes.get('*');
    if (wildcard) {
      wildcard.receive(msg);
    }
  }

  getMailbox(agentId: string): Mailbox | undefined {
    return this.mailboxes.get(agentId);
  }
}
