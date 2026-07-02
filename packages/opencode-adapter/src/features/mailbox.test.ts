import { describe, it, expect } from 'bun:test';
import { Mailbox, MessageBus } from './mailbox.js';

describe('Mailbox', () => {
  it('should send and receive messages', () => {
    const parent = new Mailbox('parent');
    const child = new Mailbox('child');
    const bus = new MessageBus();
    bus.register('parent');
    bus.register('child');

    const msg = parent.send('child', 'task', { action: 'explore' });
    bus.dispatch(msg);

    const received = bus.getMailbox('child')!.drain();
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('task');
    expect(received[0].from).toBe('parent');
  });

  it('should trigger handlers on message receipt', () => {
    const child = new Mailbox('child');
    const bus = new MessageBus();
    bus.register('child');

    let handled: string | null = null;
    bus.getMailbox('child')!.on('task', (msg) => {
      handled = msg.type;
    });

    const parent = new Mailbox('parent');
    const msg = parent.send('child', 'task', {});
    bus.dispatch(msg);

    expect(handled).toBe('task');
  });

  it('should filter drain by type', () => {
    const mb = new Mailbox('test');
    const bus = new MessageBus();
    bus.register('test');

    bus.dispatch(mb.send('test', 'task', {}));
    bus.dispatch(mb.send('test', 'result', {}));

    const tasks = bus.getMailbox('test')!.drain('task');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].type).toBe('task');

    const remaining = bus.getMailbox('test')!.drain();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].type).toBe('result');
  });

  it('should support wildcard recipient', () => {
    const broadcaster = new Mailbox('broadcaster');
    const listener = new Mailbox('listener');
    const bus = new MessageBus();
    bus.register('broadcaster');
    bus.register('listener');

    bus.dispatch(broadcaster.send('listener', 'announcement', { text: 'hello' }));

    const received = bus.getMailbox('listener')!.drain();
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('announcement');
  });

  it('should track pending count', () => {
    const mb = new Mailbox('test');
    const bus = new MessageBus();
    bus.register('test');

    bus.dispatch(mb.send('test', 'msg1', {}));
    bus.dispatch(mb.send('test', 'msg2', {}));
    expect(bus.getMailbox('test')!.pendingCount).toBe(2);

    bus.getMailbox('test')!.drain();
    expect(bus.getMailbox('test')!.pendingCount).toBe(0);
  });

  it('should support handler removal', () => {
    const mb = new Mailbox('test');
    const bus = new MessageBus();
    bus.register('test');

    let count = 0;
    const handler = () => { count++; };
    bus.getMailbox('test')!.on('task', handler);
    bus.getMailbox('test')!.off('task', handler);

    bus.dispatch(mb.send('test', 'task', {}));
    expect(count).toBe(0);
  });

  it('should route messages between parent and child agents', () => {
    const bus = new MessageBus();
    bus.register('sflow');
    bus.register('need-explorer');

    const parentMailbox = bus.getMailbox('sflow')!;
    const explorerMailbox = bus.getMailbox('need-explorer')!;

    let taskReceived = false;
    explorerMailbox.on('delegate', () => { taskReceived = true; });

    bus.dispatch(parentMailbox.send('need-explorer', 'delegate', { task: 'explore requirements' }));
    expect(taskReceived).toBe(true);

    bus.dispatch(explorerMailbox.send('sflow', 'result', { status: 'done' }));
    const parentMessages = bus.getMailbox('sflow')!.drain();
    expect(parentMessages).toHaveLength(1);
    expect(parentMessages[0].type).toBe('result');
  });
});
