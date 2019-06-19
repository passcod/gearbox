'use strict';
import abraxas from 'abraxas';
import uuid from 'uuid';
import { gear as debug } from './util/debug.mjs';

export const INSTANCE_ID = uuid.v4();

export default function connect (opts = {}) {
  const finalOpts = Object.assign({
    maxJobs: 100,
    servers: [process.env.GEARMAN_SERVER || '127.0.0.1:4730']
    // packetDump: true,
  }, opts);

  debug('starting gearman connection with', finalOpts);
  const gear = abraxas.Client.connect(finalOpts);
  gear.setClientId(INSTANCE_ID);
  return gear;
}
