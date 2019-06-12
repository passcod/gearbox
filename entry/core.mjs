'use strict';
import Core from '../lib/core.mjs';
import gear from '../lib/gear.mjs';
import sql from '../lib/sql.mjs';
import { INSTANCE_ID } from '../lib/rpc.mjs';
import noop from '../lib/util/noop.mjs';

console.log('INSTANCE_ID', INSTANCE_ID);
noop(new Core(gear(), sql({ user: 'gearbox', password: 'password' })));
