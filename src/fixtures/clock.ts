import { Clock } from '#contracts/common';

export function sydneyTime(clock: { instant: string; timezone: 'Australia/Sydney' }) {
  Clock.parse(clock);
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: clock.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(clock.instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    localDate: `${get('year')}-${get('month')}-${get('day')}`,
    localTime: `${get('hour')}:${get('minute')}:${get('second')}`,
    offset: get('timeZoneName'),
  };
}
