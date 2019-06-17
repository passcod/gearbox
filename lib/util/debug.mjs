'use strict';
import topdebug from 'debug';

export default function debug (name, ...args) {
  return topdebug('gearbox:' + name, ...args);
}

export const core = debug('core');
export const rpc = debug('rpc');
export const worker = debug('cli:worker');
