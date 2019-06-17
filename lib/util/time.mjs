'use strict';

export function sleep (n) {
  return new Promise((resolve) => setTimeout(resolve, n));
}

export function jittery (min, max) {
  return Math.round(Math.random() * (max - min) + min);
}

let watcher_n = 0;
export function watcher (timeout) {
  const id = (watcher_n += 1);

  let fn;
  const er = new Promise(done => {
    setTimeout(done, timeout);
    fn = () => done();
  });

  return { id, fn, er };
}
