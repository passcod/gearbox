'use strict';

let loud = true;

export default {
  quiet () { loud = false; },
  crit (...args) { console.error(...args) },
  err (...args) { if (loud) console.error(...args) },
  info (...args) { if (loud) console.log(...args) },
  out (...args) { console.log(...args) },
  wcrit (msg) { process.stderr.write(msg) },
  werr (msg) { if (loud) process.stderr.write(msg) },
  winfo (msg) { if (loud) process.stdout.write(msg) },
  wout (msg) { process.stdout.write(msg) },
};
