'use strict';
import abraxas from 'abraxas';

export default function connect (servers = ['127.0.0.1:4730'], opts = {}) {
  // opts.packetDump = true;
  return abraxas.Client.connect(Object.assign({}, opts, { servers }));
}
