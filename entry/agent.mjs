'use strict';
import Agent from '../lib/agent.mjs';
import gear from '../lib/gear.mjs';
import noop from '../lib/util/noop.mjs';

noop(new Agent(gear()));
