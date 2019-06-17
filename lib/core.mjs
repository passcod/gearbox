'use strict';
import { INSTANCE_ID } from './gear.mjs';
import { Gearman as Rpc, RpcError } from './rpc.mjs';
import { core as debug } from './util/debug.mjs';
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
    this.gear = gear;
    this.db = db;
    this.rpc = new Rpc(gear, { ns: ['gearbox', 'core'],
      methods: {
        queue: this.queue.bind(this),
        job_data: this.jobData.bind(this),
    } });

    this.waiting = new Map;

    this.jobCheckInterval = setInterval(() => this.checkOnJobs().catch(console.error), CHECK_JOBS_INTERVAL);
    this.gear.on('connect', () => this.checkOnJobs().catch(console.error));
  }

  get db_jobs () {
    return this.db('pure_gearbox_jobs');
  }

  waitUntil (job, after = job.after_date) {
    const { id } = job;

    if (after) {
      const until = after - new Date;
      if (until > 0) {
        debug(`waiting ${ms(until)} for job ${id}`);
        if (this.waiting.has(id)) clearTimeout(this.waiting.get(id));
        this.waiting.set(id, setTimeout(() => {
          this.waiting.delete(id);
          this.recheckJob(id);
        }, until));
        return;
      }
    }

    // otherwise recheck it cause either time passed or something's odd
    this.recheckJob(id);
  }

  async queue ({ name, args, ...job }) {
    debug(`received queue request for '${name}'`);

    if (!name) throw new RpcError({ code: 400, message: 'missing method name' });

    if (job.disambiguator) {
      debug(`checking running jobs for disambiguator '${job.disambiguator}'`);
      const ambigu = await this.db_jobs.where({
        status: 'running',
        disambiguator: job.disambiguator,
      }).first();

      if (ambigu) {
        debug(`found duplicate job: ${ambigu.id}`);
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

    const [id] = await this.db_jobs.insert({
      method_name: name,
      arguments: JSON.stringify(args),
      priority: job.priority,
      disambiguator: job.disambiguator,
      after_date: job.after_date,
      after_id: job.after_id,
      max_retries: job.max_retries,
      retry_delay: job.retry_delay,
    });

    debug(`inserted new job: ${id}`);
    this.recheckJob(id);
    return id;
  }

  recheckJob(id) {
    this.checkJob({ id }).catch(console.error);
  }

  async jobData ({ id, data = null, status = null, progress = null }) {
    const job = await this.db_jobs.where({ id }).first();
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

    await this.db_jobs.where({ id }).update(update);
    if (update.status) debug(`job ${id} marked as ${update.status}`);
    else debug(`job ${id} updated from worker`);

    if (status === 'errored') {
      this.failJob(job).catch(console.error);
    } else if (status === 'complete') {
      this.checkSuccessors(id).catch(console.error);
    }
  }

  async checkJob ({ id, job }) {
    if (!id) id = job.id;
    if (!job) job = await this.db
      .select('current.*', 'prior.status as prior_status')
      .from('pure_gearbox_jobs as current')
      .leftJoin('pure_gearbox_jobs as prior', 'current.after_id', 'prior.id')
      .where('current.id', id)
      .first();

    assert(id);
    assert(job);
    debug(`checking over job ${id}`);

    switch (job.status) {
      case 'ready':
        // continue after
        break;

      case 'waiting':
        if (
          (job.after_date ? job.after_date < new Date : true) &&
          (job.after_id ? job.prior_status === 'complete' : true)
        ) {
          debug(`job ${id} was waiting but is now ready`);
          await this.db_jobs.where({ id }).update({ status: 'ready', updated: this.db.raw('CURRENT_TIMESTAMP') });
          job.status = 'ready';
          break;
        } else {
          debug(`job ${id} is waiting on condition`);
          this.waitUntil(job);
          return;
        }

      case 'running':
        if (!(await this.gear.getuniquejobs()).includes(job.disambiguator)) {
          debug(`job ${id} was running but is no longer on gearman`);
          await this.db_jobs.where({ id }).update({
            status: 'missing',
            updated: this.db.raw('CURRENT_TIMESTAMP')
          });
          debug(`job ${id} marked as missing`);
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
          debug(`job ${id} has been missing for ${ms(new Date - job.updated)}, assuming failed`);
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
      (job.after_date && job.after_date >= new Date) ||
      (job.after_id && job.prior_status !== 'complete')
    ) {
      debug(`job ${id} was ready but actually needs to wait`);
      await this.db_jobs.where({ id }).update({ status: 'waiting', updated: this.db.raw('CURRENT_TIMESTAMP') });
      this.waitUntil(job);
      return;
    }

    debug(`checking running jobs for disambiguator '${job.disambiguator}'`);
    const ambigu = await this.db_jobs.where({
      status: 'running',
      disambiguator: job.disambiguator,
    }).first();

    if (ambigu) {
      debug(`found duplicate job: ${ambigu.id}`);
      await this.db_jobs.where({ id }).update({
        status: 'duplicate',
        updated: this.db.raw('CURRENT_TIMESTAMP'),
        see_other: ambigu.id,
      });
      debug(`job ${id} marked as duplicate`);
      return;
    }

    debug(`job ${id} is ready to be scheduled`);

    try {
      const args = JSON.parse(job.arguments);
      let { priority, disambiguator } = job;
      if (priority === 'normal') priority = null;

      await this.db_jobs.where({ id }).update({
        status: 'running',
        updated: this.db.raw('CURRENT_TIMESTAMP'),
        runner_instance: INSTANCE_ID,
      });
      debug(`job ${id} marked as running`);

      debug(`job ${id} running with: rpc from core`);
      const result = await this.rpc.request(job.method_name, args, {
        priority, disambiguator, meta: { gearbox_id: job.id }
      });
      debug(`job ${id} done running`);

      await this.db_jobs.where({ id }).update({
        status: 'almost-done',
        updated: this.db.raw('CURRENT_TIMESTAMP'),
      });
      debug(`job ${id} marked as almost-done`);
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

    await this.db_jobs.where({ id }).update(update);
    debug(`job ${id} marked as ${update.status}`);

    if (update.retries) this.recheckJob(id);
  }

  async checkSuccessors (jobid) {
    const successors = await this.db_jobs.where('after_id', jobid);
    if (successors.length < 1) return;

    const ids = successors.map(({ id }) => id);
    debug(`job ${jobid} has successors: ${ids.join(', ')}`);
    for (const id of ids) this.recheckJob(id);
  }

  get currentJobs () {
    return this.db
      .select('current.*', 'prior.status as prior_status')
      .from('pure_gearbox_jobs as current')
      .leftJoin('pure_gearbox_jobs as prior', 'current.after_id', 'prior.id')
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
