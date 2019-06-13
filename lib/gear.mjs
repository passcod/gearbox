'use strict';
import abraxas from 'abraxas';
import uuid from 'uuid';

export const INSTANCE_ID = uuid.v4();

export default function connect (servers = ['127.0.0.1:4730'], opts = {}) {
  // opts.packetDump = true;
  const gear = abraxas.Client.connect(Object.assign({}, opts, { servers }));
  gear.setClientId(INSTANCE_ID);
  return gear;
}
