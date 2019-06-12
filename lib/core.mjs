'use strict';
import { Gearman as Rpc, RpcError } from './rpc.mjs';

export default class Core {
  constructor (gear, db) {
    this.gear = gear;
    this.db = db;
    this.rpc = new Rpc(gear, { ns: ['gearbox', 'core'],
      methods: {
        queue: this.queue.bind(this)
      } });
  }

  async queue ({ name, args, priority = null }) {
    console.log(name, args, priority);
    if (!name) throw new RpcError({ code: 400, message: 'missing method name' });

    throw new RpcError({ code: 501, message: 'not implemented' });
  }
}

// If you have a newer distro with a newer systemd (systemd version 236 or newer), you can set the values of StandardOutput or StandardError to file:YOUR_ABSPATH_FILENAME.
