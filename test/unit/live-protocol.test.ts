import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PlayMode } from '../../src/core/constants';
import { isServerNotice, LiveReceiver } from '../../src/io/live/protocol';
import { fixturePath } from './helpers';

const liveMessages = readFileSync(fixturePath('live-before-kickoff.jsonl'), 'utf-8')
  .split('\n')
  .filter((l) => l !== '');

describe('LiveReceiver', () => {
  it('applies the messages of a real server', () => {
    const r = new LiveReceiver();
    for (const m of liveMessages) {
      expect(r.receive(m).kind).toBe('json');
    }
    const s = r.store;
    expect(r.jsonMessages).toBe(22);
    expect(r.warnings).toBe(0);
    expect(s.playerTypes).toHaveLength(18);
    expect(s.serverParam.coach).toBe(false);
    expect(s.frameCount).toBe(2);
    expect(s.lastFrame).toMatchObject({ mode: PlayMode.BeforeKickOff });
    expect(s.lastFrame?.teams[0].name).toBe('');
    expect(s.lastFrame?.players).toHaveLength(22);
  });

  it('reports replies in msg and S-expressions', () => {
    const r = new LiveReceiver();
    const msg = (message: string) =>
      r.receive(JSON.stringify({ msg: { time: 0, stime: 3, board: 1, message } }));
    expect(msg('(error illegal_command_form)')).toEqual({
      kind: 'json',
      notices: ['(error illegal_command_form)'],
    });
    expect(msg('(warning compression_unsupported)')).toMatchObject({
      notices: ['(warning compression_unsupported)'],
    });
    expect(msg('(ok change_mode)')).toMatchObject({ notices: [] });
    expect(msg('(change_player_type l 3 5)')).toMatchObject({ notices: [] });
    expect(r.store.messages).toHaveLength(4);
    expect(r.receive('(error no_more_monitor)\0')).toEqual({
      kind: 'text',
      text: '(error no_more_monitor)',
    });
    expect(isServerNotice('(errors)')).toBe(false);
  });

  it('reads a message with control characters, which the server does not escape', () => {
    const r = new LiveReceiver();
    const m = r.receive('{"msg":{"time":1,"board":1,"message":"(say \\"a\nb\tc\\")"}}');
    expect(m.kind).toBe('json');
    expect(r.store.messages[0]?.message).toBe('(say "a\nb\tc")');
    expect(r.receive('{"show":{"time":1,').kind).toBe('broken');
    expect(r.warnings).toBe(1);
  });
});
