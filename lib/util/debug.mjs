'use strict';
import topdebug from 'debug';

export default function debug (name, ...args) {
  return topdebug('gearbox:' + name, ...args);
}

export const dcore = debug('core');
