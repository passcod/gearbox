'use strict';
import { INSTANCE_ID } from './gear.mjs';
import { JOBS_TABLE } from './sql.mjs';
import { Gearman as Rpc, RpcError } from './rpc.mjs';
import { core as debug } from './util/debug.mjs';
import { jittery, watcher } from './util/time.mjs';
import log from './util/log.mjs';
import assert from 'assert';
import uuid from 'uuid';
import ms from 'ms';

// This *should* be unnecessary, so it should be fine to have it very long.
// Everything that triggers jobs should instead call recheckAJob(on the relevant
// thing when it knows something happens, and thus everything should be instant!
const CHECK_JOBS_INTERVAL = 60000;

// Timeout after which a missing job is assumed failed.
const MISSING_TIMEOUT = 5000;

export default class Core {
  constructor (gear, db) {
    log.out('=== Starting core');
    this.gear = gear;
    this.db = db;
    this.rpc = new Rpc(gear, { ns: ['gearbox', 'core'],
      methods: {
        queue: this.queue.bind(this),
        watch: this.watch.bind(this),
        job_data: this.jobData.bind(this),
        status: this.status.bind(this),
        stats: this.stats.bind(this),
        noop: this.noop.bind(this),
        noopwait: this.noopwait.bind(this),
        noopgo: this.noopgo.bind(this),
      } });

    this.waiting = new Map();
    this.watching = new Map();
    this.nooping = new Map();

    log.out(`=== Fallback check on jobs every ${ms(CHECK_JOBS_INTERVAL)}`);
    this.jobCheckInterval = setInterval(() => this.checkOnJobs().catch(console.error), CHECK_JOBS_INTERVAL);
    this.gear.on('connect', () => {
      debug('connected to gearman');
      this.checkOnJobs().catch(console.error);
    });
  }

  async noop (_, { meta: { gearbox_id } }) {
    setImmediate(() => this.rpc.notify('gearbox\\core::job_data', {
      id: gearbox_id,
      data: null,
      status: 'complete',
    }));
  }

  async noopwait (_, { meta: { gearbox_id } }) {
    const watch = watcher();
    this.nooping.set(gearbox_id, watch);
    await watch.er;
    setImmediate(() => this.rpc.notify('gearbox\\core::job_data', {
      id: gearbox_id,
      data: null,
      status: 'complete',
    }));
  }

  async noopgo (id, { meta: { gearbox_id } }) {
    const watch = this.nooping.get(id);
    let data = false;
    if (!watch) {
      watch.fn();
      this.nooping.delete(id);
      data = true;
    }

    setImmediate(() => this.rpc.notify('gearbox\\core::job_data', {
      id: gearbox_id,
      data,
      status: 'complete',
    }));
  }

  get dbJobs () {
    return this.db(JOBS_TABLE);
  }

  waitUntil (job, after = job.after_date) {
    const { id } = job;

    const until = after
      ? (after - new Date())
      : jittery(5000, 30000);

    if (until > 0) {
      debug(`waiting ${ms(until)} for job ${id}`);
      if (this.waiting.has(id)) clearTimeout(this.waiting.get(id));
      this.waiting.set(id, setTimeout(() => {
        debug(`waited ${ms(until)} for job ${id}, now rechecking`);
        this.waiting.delete(id);
        this.recheckJob(id);
      }, until));
      return;
    } else {
      debug('recheck job immediately as the waiting period isn’t positive');
      this.recheckJob(id);
    }
  }

  async queue ({ name, args, ...job }) {
    debug(`received queue request for '${name}'`);

    if (!name) throw new RpcError({ code: 400, message: 'missing method name' });

    if (job.disambiguator) {
      debug(`checking running jobs for disambiguator '${job.disambiguator}'`);
      const ambigu = await this.dbJobs.where({
        status: 'running',
        disambiguator: job.disambiguator
      }).first();

      if (ambigu) {
        debug(`found duplicate job: ${ambigu.id}, rechecking`);
        this.recheckJob(ambigu.id);
        return ambigu.id;
      }
    } else {
      job.disambiguator = uuid.v4();
      debug(`assigning disambiguator: ${job.disambiguator}`);
    }

    if (job.after_date) {
      job.after_date = new Date(job.after_date);
    }

    const [id] = await this.dbJobs.insert({
      method_name: name,
      arguments: JSON.stringify(args),
      priority: job.priority,
      disambiguator: job.disambiguator,
      after_date: job.after_date,
      after_id: job.after_id,
      before_id: job.before_id,
      max_retries: job.max_retries,
      retry_delay: job.retry_delay
    });

    debug(`inserted new job: ${id}`);
    this.recheckJob(id);
    return id;
  }

  async watch ({ id, wait_for_id: waitForId = false }) {
    debug(`received watch request for job ${id}`);

    id = parseInt(id);
    if (id <= 0 || isNaN(id)) throw new RpcError({ code: 400, message: 'invalid job id' });

    return this.watchImpl(id, waitForId);
  }

  async watchImpl (id, wait = false) {
    const job = await this.dbJobs.where({ id }).first();
    if (!job && !wait) throw new RpcError({ code: 404, message: 'no such job' });
    else if (job) wait = false;

    switch (job && job.status) {
      case 'complete':
        debug(`job ${id} is complete, return`);
        let data = job.result_data;
        try {
          data = JSON.parse(data);
        } catch (_) {}
        return data;

      case 'errored':
        debug(`job ${id} is errored, return`);
        let err = job.result_data;
        try {
          err = JSON.parse(err);
          if (err.code && err.message) {
            err = new RpcError({ code: err.code, message: err.message, data: err.data });
          }
        } catch (_) {
          // do nothing, tis not json
        } finally {
          if (!(err instanceof RpcError)) {
            err = new Error(err);
          }
        }

        throw err;

      case 'invalid':
        debug(`job ${id} is invalidated, return`);
        throw new RpcError({
          code: -28000,
          message: 'Job was invalid, or was invalidated when scheduled.',
          data: job.result_data
        });

      case 'duplicate':
        debug(`job ${id} is duplicate, proxy`);
        return this.watchImpl(job.see_other);
    }

    debug(`waiting ${wait ? 'for' : 'on'} job ${id}`);

    // bit of a complicated-looking machinery, but is actually fairly
    // simple: populates a Map<JobId, Map<WatchId, WatchFn>> and then
    // unpopulates it after use, waiting on the Watch in between.
    //
    // the Watch is a Promise that can never reject, and it will resolve
    // only if either the WatchFn is called, or the watch times out.
    //
    // so essentially we're checking the job every two seconds, and also
    // when we're told there's an update by other parts of this class.
    const watch = watcher(2000);
    const list = this.watching.get(id) || new Map();
    list.set(watch.id, watch.fn);
    this.watching.set(id, list);

    await watch.er;

    if (this.watching.has(id)) {
      const list = this.watching.get(id);
      list.delete(watch.id);
      if (list.size > 0) {
        this.watching.set(id, list);
      } else {
        this.watching.delete(id);
      }
    }

    if (!this.waiting.has(id)) {
      debug(`not currently waiting on job ${id}, rechecking`);
      this.recheckJob(id);
    }

    return this.watchImpl(id, wait);
  }

  async jobData ({ id, data = null, status = null, progress = null }) {
    // TODO: add append: bool|string to get the data appended to the
    // result instead of overwriting. string to be the separator,
    // defaults to newline
    const job = await this.dbJobs.where({ id }).first();
    if (!job) throw new RpcError({ code: 404, message: 'no such job' });

    debug(`got an update about a job: ${id}`);
    const update = {
      updated: this.db.raw('CURRENT_TIMESTAMP')
    };

    if (data !== undefined && data !== null) {
      debug(`job ${id} receiving data`);
      update.result_data = JSON.stringify(data);
    }

    if (progress !== undefined && progress !== null) {
      progress = parseFloat(progress);
      if (!isNaN(progress) && progress >= 0) {
        debug(`job ${id} receiving progress: ${progress}`);
        update.progress_status = progress;
        update.progress_updated = this.db.raw('CURRENT_TIMESTAMP');
      }
    }

    if (status && ['running', 'almost-done'].includes(job.status)) {
      if (!['complete', 'errored'].includes(status)) {
        debug(`job ${id} incoming status was invalid: ${status}`);
        status = 'invalid';
      }

      if (status === 'complete') update.status = 'complete';
      update.completed = this.db.raw('CURRENT_TIMESTAMP');
    } else if (status) {
      debug(`job ${id} status was unexpected: ${job.status}`);
    }

    await this.dbJobs.where({ id }).update(update);
    if (update.status) debug(`job ${id} marked as ${update.status}`);
    else debug(`job ${id} updated from worker`);

    if (status === 'errored') {
      this.failJob(job).catch(console.error);
      this.checkSuccessors(job).catch(console.error);
    } else if (status === 'complete') {
      this.checkSuccessors(job).catch(console.error);
    }

    this.triggerWatchersForJob(id);
  }

  async status (ids = []) {
    const current = await (ids.length ? this.dbJobs.whereIn('id', ids) : this.currentJobs);
    for (const job of current) {
      try {
        job.arguments = JSON.parse(job.arguments);
      } catch (_) {}

      job.retries = job.max_retries ? { n: job.retries, max: job.max_retries, delay: job.retry_delay } : false;
      delete job.max_retries;
      delete job.retry_delay;

      job.progress = job.progress_updated ? { n: job.progress_status || 0, updated: job.progress_updated } : false;
      delete job.progress_status;
      delete job.progress_updated;

      try {
        job.data = JSON.parse(job.result_data);
      } catch (_) {
        job.data = job.result_data;
      }
      delete job.result_data;

      delete job.runner_instance;
      delete job.prior_status;
      delete job.prior_retries;
      if (job.status !== 'duplicate') delete job.see_other;
    }
    return current;
  }

  async stats ({ method }) {
    const { totalRuns, earliest, latest, avgRetries, avgTime, stdevRetries, stdevTime } = await this.dbJobs
      .select([
        this.db.raw('count(*) as totalRuns'),
        this.db.raw('min(created) as earliest'),
        this.db.raw('max(created) as latest'),
        this.db.raw('avg(retries) as avgRetries'),
        this.db.raw('avg(completed - created) as avgTime'),
        this.db.raw('stddev(retries) as stdevRetries'),
        this.db.raw('stddev(completed - created) as stdevTime')
      ])
      .where({ method_name: method })
      .first();

    const { stdAvgRetries } = await this.dbJobs
      .select(this.db.raw('avg(retries) as stdAvgRetries'))
      .where({ method_name: method })
      .whereRaw('retries > ?', avgRetries - stdevRetries)
      .whereRaw('retries < ?', avgRetries + stdevRetries)
      .first();

    const { stdAvgTime } = await this.dbJobs
      .select(this.db.raw('avg(completed - created) as stdAvgTime'))
      .where({ method_name: method })
      .whereRaw('(completed - created) > ?', avgTime - stdevTime)
      .whereRaw('(completed - created) < ?', avgTime + stdevTime)
      .first();

    const statuses = await this.dbJobs
      .select(['status', this.db.raw('count(status) as n')])
      .where({ method_name: method })
      .groupBy('status');

    const states = {};
    for (const { status, n } of statuses) { states[status] = n; }

    return {
      totalRuns,
      earliest,
      latest,
      averageRetries: +avgRetries,
      averageCompletionTime: +avgTime || null,
      stdAverageRetries: +stdAvgRetries,
      stdAverageCompletionTime: +stdAvgTime || null,
      states
    };
  }

  triggerWatchersForJob (id) {
    if (this.watching.has(id)) { for (const fn of this.watching.get(id).values()) fn(); }
  }

  recheckJob (id) {
    this.checkJob({ id }).catch(console.error);
  }

  async checkJob ({ id, job }) {
    if (!id) id = job.id;
    if (!job) {
      job = await this.db
        .select('current.*', 'prior.status as prior_status', 'prior.retries as prior_retries')
        .from(`${JOBS_TABLE} as current`)
        .leftJoin(`${JOBS_TABLE} as prior`, 'current.after_id', 'prior.id')
        .where('current.id', id)
        .first();
    }

    assert(id);
    assert(job);
    debug(`checking over job ${id}`);

    const befores = await this.dbJobs
      .where('before_id', id)
      .whereNot('status', 'complete');

    const allBeforesErrored = befores.length > 0 && befores
      .every(({ status, retries }) => status === 'errored' && retries <= 0);
    const someBeforesRemain = befores.length > 0 && !allBeforesErrored && !befores
      .every(({ status }) => status === 'complete');
    const allBeforesComplete = befores.length <= 0 || (!allBeforesErrored && !someBeforesRemain);

    switch (job.status) {
      case 'ready':
        // continue after
        break;

      case 'waiting':
        if (
          (job.after_date ? job.after_date < new Date() : true) &&
          (job.after_id ? job.prior_status === 'complete' : true) &&
          (allBeforesComplete)
        ) {
          debug(`job ${id} was waiting but is now ready`);
          await this.dbJobs.where({ id }).update({ status: 'ready', updated: this.db.raw('CURRENT_TIMESTAMP') });
          job.status = 'ready';
          this.triggerWatchersForJob(id);
          break;
        } else if (job.prior_status === 'errored' && job.prior_retries <= 0) {
          return this.failJob(job, new RpcError({ code: -28523, message: 'Dependency (after) errored' }));
        } else if (allBeforesErrored) {
          return this.failJob(job, new RpcError({ code: -28524, message: 'Dependency (before) errored' }));
        } else {
          debug(`job ${id} is waiting on condition`, job);
          this.waitUntil(job);
          return;
        }

      case 'running':
        if (!await this.jobIsOnGearman(job)) {
          debug(`job ${id} was running but is no longer on gearman`);
          await this.dbJobs.where({ id }).update({
            status: 'missing',
            updated: this.db.raw('CURRENT_TIMESTAMP')
          });
          debug(`job ${id} marked as missing`);
          this.triggerWatchersForJob(id);
          this.waitUntil(job, job.updated + MISSING_TIMEOUT);
          return;
        }

        if (job.runner_instance !== INSTANCE_ID) {
          debug(`job ${id} is running but it's no longer being watched`);
          // eventually it will either disappear from gearman and we'll
          // mark it missing, or it will return some data to us and we'll
          // mark it complete/errored or retry it as appropriate.
        } else {
          debug(`job ${id} is running`);
        }

        return;

      case 'almost-done':
        // this is when the job is done but we're still waiting on its
        // data and final state to come in.
        return;

      case 'missing':
        if (((+job.updated) + MISSING_TIMEOUT) < Date.now()) {
          debug(`job ${id} has been missing for ${ms(new Date() - job.updated)}, assuming failed`);
          this.failJob(job, 'went missing');
        } else {
          debug(`job ${id} is missing`);
          this.waitUntil(job, (+job.updated) + MISSING_TIMEOUT);
        }
        return;

      case 'complete':
      case 'errored':
      case 'invalid':
      case 'duplicate':
      default:
        // ignore
        return;
    }

    if (
      (job.after_date && job.after_date >= new Date()) ||
      (job.after_id && job.prior_status !== 'complete')
    ) {
      debug(`job ${id} was ready but actually needs to wait (after)`);
      await this.dbJobs.where({ id }).update({ status: 'waiting', updated: this.db.raw('CURRENT_TIMESTAMP') });
      this.triggerWatchersForJob(id);
      this.waitUntil(job);
      return;
    }

    if (someBeforesRemain) {
      debug(`job ${id} was ready but actually needs to wait (before)`);
      await this.dbJobs.where({ id }).update({ status: 'waiting', updated: this.db.raw('CURRENT_TIMESTAMP') });
      return;
    }

    debug(`checking running jobs for disambiguator '${job.disambiguator}'`);
    const ambigu = await this.dbJobs.where({
      status: 'running',
      disambiguator: job.disambiguator
    }).first();

    if (ambigu) {
      debug(`found duplicate job: ${ambigu.id}`);
      await this.dbJobs.where({ id }).update({
        status: 'duplicate',
        updated: this.db.raw('CURRENT_TIMESTAMP'),
        see_other: ambigu.id
      });
      debug(`job ${id} marked as duplicate`);
      this.triggerWatchersForJob(id);
      return;
    }

    debug(`job ${id} is ready to be scheduled`);

    if (!await this.gearmanHasWorker(job.method_name))
      return this.failJob(job, new RpcError({ code: -28404, message: 'No worker available' }));

    try {
      const args = JSON.parse(job.arguments);
      let { priority, disambiguator } = job;
      if (priority === 'normal') priority = null;

      await this.dbJobs.where({ id }).update({
        status: 'running',
        updated: this.db.raw('CURRENT_TIMESTAMP'),
        runner_instance: INSTANCE_ID
      });
      debug(`job ${id} marked as running`);
      this.triggerWatchersForJob(id);

      /// SCHEDULING ///
      debug(`job ${id} running with: rpc from core`);
      await this.rpc.request(job.method_name, args, {
        priority, disambiguator, meta: { gearbox_id: job.id }
      });
      debug(`job ${id} done running`);

      await this.dbJobs.where({ id }).update({
        status: 'almost-done',
        updated: this.db.raw('CURRENT_TIMESTAMP')
      });
      debug(`job ${id} marked as almost-done`);
      this.triggerWatchersForJob(id);
    } catch (err) {
      await this.failJob(job);
    }
  }

  async failJob (job, err = null) {
    assert(job);
    const { id } = job;
    assert(id);

    debug(`job ${id} failed`);

    const update = {
      status: 'errored',
      updated: this.db.raw('CURRENT_TIMESTAMP')
    };

    if (err) {
      update.result_data = err instanceof RpcError
        ? JSON.stringify(err.toJSON())
        : (err.stack || err.toString());
    }

    if (job.retries < job.max_retries) {
      debug(`job ${id} can be retried (${job.max_retries - job.retries} left of ${job.max_retries})`);
      update.status = 'ready';
      update.retries = job.retries + 1;
      update.after_date = new Date(Date.now() + job.retry_delay * 1000);
    } else if (job.max_retries > 0) {
      debug(`job ${id} has been retried ${job.retries} out of ${job.max_retries} times, bail`);
    }

    await this.dbJobs.where({ id }).update(update);
    debug(`job ${id} marked as ${update.status}`);
    this.triggerWatchersForJob(id);

    if (update.retries) {
      debug(`job ${id} can retry, rechecking`);
      this.recheckJob(id);
    }
  }

  async checkSuccessors (job) {
    if (job.before_id) this.recheckJob(job.before_id);

    const successors = await this.dbJobs.where('after_id', job.id);
    if (successors.length < 1) return;

    const ids = successors.map(({ id }) => id);
    debug(`job ${job.id} has successors: ${ids.join(', ')}`);
    for (const id of ids) this.recheckJob(id);
  }

  async jobIsOnGearman (job) {
    debug(`checking if job ${job.id} is on gearman`);
    const hasUnique = (await this.gear.getuniquejobs()).includes(job.disambiguator);
    return hasUnique && await this.gearmanHasWorker(job.method_name);
  }

  async gearmanHasWorker (method) {
    return (await this.gear.status())
      .filter(server => Object.keys(server).includes(method))
      .map(server => Object.entries(server).find(([m]) => m === method) || [0, {}])
      .map(([_, status]) => status)
      .map(({ running, workers }) => (running || 0) + (workers || 0))
      .filter(available => available > 0)
      .length > 0;
  }

  get currentJobs () {
    return this.db
      .select('current.*', 'prior.status as prior_status', 'prior.retries as prior_retries')
      .from(`${JOBS_TABLE} as current`)
      .leftJoin(`${JOBS_TABLE} as prior`, 'current.after_id', 'prior.id')
      .whereNotIn('current.status', ['almost-done', 'errored', 'complete', 'invalid', 'duplicate'])
      .where(q => q
        .where('current.after_id', null)
        .orWhere('prior.id', null)
        .orWhere('prior.status', 'complete')
      )
      .orderBy('current.created', 'desc');
  }

  async checkOnJobs () {
    debug('fetching current job list');
    const jobs = await this.currentJobs;
    debug(`there are ${jobs.length} current jobs`);
    for (const job of jobs) {
      this.checkJob({ job }).catch(console.error);
    }
  }
}
