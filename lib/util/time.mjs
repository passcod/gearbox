'use strict';
import Luxon from 'luxon';
const { DateTime } = Luxon;

export function sleep (n) {
  return new Promise((resolve) => setTimeout(resolve, n));
}

export function jittery (min, max) {
  return Math.round(Math.random() * (max - min) + min);
}

let watcher_n = 0;
export function watcher (timeout = null) {
  const id = (watcher_n += 1);

  let fn;
  const er = new Promise(done => {
    if (timeout) setTimeout(done, timeout);
    fn = () => done();
  });

  return { id, fn, er };
}

export const LOG_TIME_FORMAT = 'dd MMM yy HH:mm:ss';

export function now () {
  return DateTime.local();
}

export function logtime (start) {
  const diff = start.diffNow();
  const secs = Math.floor(Math.abs(diff.as('seconds')));
  const s = secs.toString().padStart(3, '0');
  const us = Math.floor(Math.abs(diff.as('milliseconds')) - secs * 1000).toString().padStart(6, '0');
  return `${DateTime.local().toFormat(LOG_TIME_FORMAT)} [${s}.${us}]`;
}
