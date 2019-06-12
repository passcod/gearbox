'use strict';

import { Gearman as Rpc, RpcError } from '../lib/rpc.mjs';
import gear from '../lib/gear.mjs';
import ms from 'ms';
import noop from '../lib/util/noop.mjs';
import yargs from 'yargs';

function baseRunArgs (yargs) {
  return yargs
    .positional('name', { describe: 'method name' })
    .option('priority', { describe: 'normal, high, low', default: 'normal' })
    .option('json', { describe: 'always parse args as JSON', default: false, type: 'boolean' })
    .demandOption(['name']);
}

function parseRunArgs (argv) {
  const name = argv.name.replace('/', '\\');
  const priority = argv.priority === 'normal' ? null : argv.priority;

  let args;
  if (argv.json) {
    if (argv.args.length === 1) {
      args = JSON.parse(argv.args[0]);
    } else {
      args = argv.args.map(a => JSON.parse(a));
    }
  } else if (argv.args.some(a => a.toString().includes('='))) {
    args = {};
    for (const [k, v = null] of argv.args.map(a => a.split('=', 2))) { args[k] = v || args[k] || null; }
  }

  if (!args) args = argv.args;

  return { name, priority, args };
}

async function run (argv) {
  const start = new Date();
  const rpc = new Rpc(gear());

  try {
    const data = await rpc.request(argv.name, argv.args, argv.priority);
    if (data !== null) console.log(data);
  } catch (err) {
    console.error('<== Received an error');
    if (err instanceof RpcError) {
      const re = err.toJSON().error;
      console.error('code:', re.code);
      console.error('message:', re.message);
      if (re.data) console.error('data:', re.data);
    } else {
      console.error(err);
    }
  } finally {
    console.error('=== Took', ms((new Date()) - start));
  }
}

function wrap (fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(err);
    }
  };
}

noop(yargs
  .strict()
  .command('queue <name> [args...]', 'Queue a job', yargs => {
    baseRunArgs(yargs);
  }, wrap(argv => {
    const args = parseRunArgs(argv);
    console.error(`==> Queueing ${args.name} with ${args.priority || 'normal'} priority`);
    console.error('==> Arguments:', args.args);
    return run({ name: 'gearbox\\core::queue', args });
  }))
  .command('raw <name> [args...]', 'Run an RPC job directly', yargs => {
    baseRunArgs(yargs);
  }, wrap(argv => {
    const args = parseRunArgs(argv);
    console.error(`==> Running ${args.name} with ${args.priority || 'normal'} priority`);
    console.error('==> Arguments:', args.args);
    return run(args);
  }))
  .demandCommand(1, 'Missing command')
  .argv);
