'use strict';
import { Gearman as Rpc, RpcError } from './rpc.mjs';

const CHECK_JOBS_INTERVAL = 5000;

export default class Core {
  constructor (gear, db) {
    this.gear = gear;
    this.db = db;
    this.rpc = new Rpc(gear, { ns: ['gearbox', 'core'],
      methods: {
        queue: this.queue.bind(this)
    } });

    this.lastJobCheck = 0;
    this.jobCheckInterval = setInterval(() => this.deboJobs(), CHECK_JOBS_INTERVAL * 2);
    this.deboJobs();
  }

  get db_jobs () {
    return this.db('pure_gearbox_jobs');
  }

  async queue ({ name, args, priority = null }) {
    console.log(name, args, priority);
    if (!name) throw new RpcError({ code: 400, message: 'missing method name' });

    await this.db_jobs.insert({
      method_name: name,
      arguments: JSON.stringify(args),
      priority: priority || 'normal',
    });

    this.deboJobs();
  }

  async deboJobs () {
    if (((new Date) - this.lastJobCheck) < CHECK_JOBS_INTERVAL) return;
    try {
      this.lastJobCheck = new Date;
      await this.checkOnJobs();
    } catch (err) {
      console.error(err);
    }
  }

  async checkOnJobs () {
    const jobs = await this.db_jobs
      .whereNotIn('status', ['errored', 'complete', 'invalid'])
      .where(q => q
        .where('after_date', null)
        .orWhere('after_date', '<', this.db.raw('CURRENT_TIMESTAMP'))
      )
      .orderBy('created', 'desc');

    console.log(jobs);
  }
}
