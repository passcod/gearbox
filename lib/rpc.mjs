'use strict';
import { INSTANCE_ID } from './gear.mjs';

let id = 0;
function getId () {
  return INSTANCE_ID + '-' + (id += 1);
}

const common = {
  send (method, params = {}, id = null) {
    const pack = {
      jsonrpc: '2.0',
      method,
      params,
      _meta: { host: 'gearbox' }
    };

    if (id) pack.id = id;
    return pack;
  },

  cacheKey ({ method, params = {} }) {
    return JSON.stringify([method, params]);
  },

  copy (arg) {
    return JSON.parse(JSON.stringify(arg));
  },

  respond (id, result) {
    return { jsonrpc: '2.0', id, result };
  },

  error (id, code, message, data = null) {
    const pack = { jsonrpc: '2.0', id, error: { code, message } };
    if (data) pack.error.data = data;
    return pack;
  }
};

export class RpcError extends Error {
  constructor ({ code, message, data = null }) {
    super(`Remotec: ${message} (code ${code}, m.${id})`);

    this.id = 0;
    this.code = code;
    this.message = message;
    this.data = data;
  }

  toString () {
    return `Error: ${this.message} (code ${this.code}, m.${this.id})`;
  }

  toJSON () {
    return common.error(this.id, this.code, this.message, this.data);
  }
}

function checkData (data) {
  if (!data || data.jsonrpc !== '2.0') {
    throw new RpcError({ code: -32600, message: 'not jsonrpc response', data });
  } else if (data.error) {
    if (data.jsonrpc === '2.0') {
      throw new RpcError(data.error);
    } else if (data.error.toString() === data.error) {
      throw new RpcError({ code: -33020, message: data.error });
    } else {
      throw new RpcError({ code: -33040, message: JSON.stringify(data.error), data });
    }
  }

  return data;
}

function checkResult (id, data) {
  if (!data.hasOwnProperty('result')) throw new Error('not jsonrpc result');
  if (data.id !== id) throw new Error('unmatched request id');
  return data.result;
}

export class Gearman {
  constructor (gear, worker = null) {
    this.gear = gear;

    if (worker) {
      this.namespace = worker.ns.join('\\');
      this.methods = worker.methods;

      for (const [name, fn] of Object.entries(this.methods)) {
        const method = `${this.namespace}::${name}`;
        console.error(`Installing method ${method}`);
        this.gear.registerWorker(method, this.makeHandle(name, fn));
      }
    }
  }

  // priority can be null (normal) or 'high' or 'low'

  async request (method, params = {}, { priority = null, disambiguator = null, meta = null } = {}) {
    const pack = common.send(method, params, getId());
    if (meta) Object.assign(pack._meta, meta);
    const data = await this.gear.submitJob(pack.method, {
      priority,
      uniqueid: disambiguator
    }, JSON.stringify(pack));
    return checkResult(pack.id, checkData(JSON.parse(data)));
  }

  async notify (method, params = {}, { priority = null, disambiguator = null, meta = null } = {}) {
    const pack = common.send(method, params);
    if (meta) Object.assign(pack._meta, meta);
    await this.gear.submitJobBg(pack.method, {
      priority,
      uniqueid: disambiguator,
    }, JSON.stringify(pack));
  }

  makeHandle (name, fn) {
    return async (task) => {
      const method = `${this.namespace}::${name}`;
      const uid = task.uniqueid ? ('#' + task.uniqueid) : '';
      console.error(`Processing ${method}${uid}`);

      let data;
      try {
        try {
          data = JSON.parse(task.payload);
        } catch (err) {
          throw new RpcError({ code: -32600, message: 'invalid json', data: task.payload });
        }

        const meta = data._meta || {};
        meta.jobid = task.jobid;
        meta.uniqueid = task.uniqueid;

        data = checkData(data);

        if (data.hasOwnProperty('result')) {
          throw new RpcError({ code: -32603, message: 'result sent as request', data });
        }

        if (!data.method || data.method.toString() !== data.method || data.method === '') {
          throw new RpcError({ code: -32600, message: 'invalid request', data });
        }

        if (data.method !== method) {
          throw new RpcError({ code: -32601, message: 'method not found', data });
        }

        const result = await fn(data.params, {
          meta,
          progress (percent) {
            task.status(percent);
          },
          warn (message) {
            task.warn(message);
          }
        }) || null;

        if (data.id) {
          task.end(JSON.stringify(common.respond(data.id, result)));
        } else {
          // if notification, don't reply, but still signal to gearman
          task.end('');
        }
      } catch (e) {
        try {
          let err = e;
          if (!(err instanceof RpcError)) {
            console.error(`While processing ${method}${uid}, handler threw unexpected:`, err);
            err = new RpcError({
              code: err.code || 500,
              message: err.message || err.toString(),
              data: {
                stack: err.stack.split('\n').slice(1).map(l => l.trim())
              }
            });
          }

          // console.log('Handling err', err);
          if (data.id) {
            err.id = data.id;
            task.end(JSON.stringify(err.toJSON()));
          } else {
            // if notification, don't reply, but still signal to gearman
            task.end('');
          }
        } catch (err) {
          // this is essentially a gearbox error, so fail hard
          task.error(err.stack || err.toString());
          console.error(err);
        }
      } finally {
        console.error(`Done with ${method}${uid}`);
      }
    };
  }
}
