import { classifyKeyword } from '../../src/services/sms-opt-out';

describe('classifyKeyword', () => {
  it.each([
    ['STOP', 'STOP'],
    ['stop', 'STOP'],
    ['  STOP  ', 'STOP'],
    ['StopAll', 'STOP'],
    ['UNSUBSCRIBE', 'STOP'],
    ['cancel', 'STOP'],
    ['END', 'STOP'],
    ['quit', 'STOP'],
  ])('classifies %j as STOP', (input, expected) => {
    expect(classifyKeyword(input)).toBe(expected);
  });

  it.each([
    ['START', 'START'],
    ['start', 'START'],
    ['YES', 'START'],
    ['Unstop', 'START'],
  ])('classifies %j as START', (input, expected) => {
    expect(classifyKeyword(input)).toBe(expected);
  });

  it.each([
    ['HELP', 'HELP'],
    ['help', 'HELP'],
    ['INFO', 'HELP'],
  ])('classifies %j as HELP', (input, expected) => {
    expect(classifyKeyword(input)).toBe(expected);
  });

  it.each([
    'please stop calling',  // keyword embedded but not exact
    'I need help with my appointment',
    'hello',
    '',
    '   ',
    'Stop the bleeding',
    'startup',
  ])('returns null for non-keyword message %j', (input) => {
    expect(classifyKeyword(input)).toBeNull();
  });
});
