'use strict';
import { INSTANCE_ID } from './gear.mjs';
import { Gearman as Rpc, RpcError } from './rpc.mjs';
import { dcore } from './util/debug.mjs';
import uuid from 'uuid';
import ms from 'ms';

// This *should* be unnecessary, so it should be fine to have it very long.
// Everything that triggers jobs should instead call recheckAJob(on the relevant
// thing when it knows something happens, and thus everything should be instant!
const CHECK_JOBS_INTERVAL = 60000;

export default class Core {
  constructor (gear, db) {
    this.gear = gear;
    this.db = db;
    this.rpc = new Rpc(gear, { ns: ['gearbox', 'core'],
      methods: {
        queue: this.queue.bind(this)
    } });

    this.waiting = new Map;

    this.jobCheckInterval = setInterval(() => this.checkOnJobs().catch(console.error), CHECK_JOBS_INTERVAL);
    this.gear.on('connect', () => this.checkOnJobs().catch(console.error));
  }

  get db_jobs () {
    return this.db('pure_gearbox_jobs');
  }

  waitUntil (job) {
    // this is not just for convenience but also because `job` is an
    // object, so we retrieve the values here and can trust they won't
    // change on us (e.g. later on, when the timeout runs).
    const { after_date, id } = job;

    if (after_date) {
      const until = after_date - new Date;
      if (until > 0) {
        dcore(`waiting ${ms(until)} for job ${id}`);
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
    dcore(`received queue request for '${name}'`);

    if (!name) throw new RpcError({ code: 400, message: 'missing method name' });

    if (job.disambiguator) {
      dcore(`checking running jobs for disambiguator '${job.disambiguator}'`);
      const ambigu = await this.db_jobs.where({
        status: 'running',
        disambiguator: job.disambiguator,
      }).first();

      if (ambigu) {
        dcore(`found duplicate job: ${ambigu.id}`);
        this.recheckJob(ambigu.id);
        return ambigu.id;
      }
    } else {
      job.disambiguator = uuid.v4();
      dcore(`assigning disambiguator: ${job.disambiguator}`);
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
    });

    dcore(`inserted new job: ${id}`);
    this.recheckJob(id);
    return id;
  }

  recheckJob(id) {
    this.checkJob({ id }).catch(console.error);
  }

  async checkJob ({ id, job }) {
    if (!id) id = job.id;
    if (!job) job = await this.db
      .select('current.*', 'prior.status as prior_status')
      .from('pure_gearbox_jobs as current')
      .leftJoin('pure_gearbox_jobs as prior', 'current.after_id', 'prior.id')
      .where('current.id', id)
      .first();

    dcore(`checking over job ${id}`);

    switch (job.status) {
      case 'ready':
        // continue after
        break;

      case 'waiting':
        if (
          (job.after_date ? job.after_date < new Date : true) &&
          (job.after_id ? job.prior_status === 'complete' : true)
        ) {
          dcore(`job ${id} was waiting but is now ready`);
          await this.db_jobs.where({ id }).update({ status: 'ready', updated: this.db.raw('CURRENT_TIMESTAMP') });
          job.status = 'ready';
          break;
        } else {
          dcore(`job ${id} is waiting on condition`);
          this.waitUntil(job);
          return;
        }

      case 'running':
        if (!(await this.gear.getuniquejobs()).includes(job.disambiguator)) {
          dcore(`job ${id} was running but is no longer on gearman, assuming failure`);
          await this.failJob(job, 'missing from gearman');
          return;
        }

        if (job.runner_instance !== INSTANCE_ID) {
          dcore(`job ${id} is running but it's no longer being watched, resuming monitoring`);
          // because all our jobs have disambiguators aka a uniqueid,
          // and all jobs are run in foreground, we can force another
          // job to run with the same uniqueid and that will actually
          // "connect" to the current job and we'll be able to watch.
        } else {
          dcore(`job ${id} is running`);
        }

        return;

      case 'complete':
      case 'invalid':
      case 'errored':
      default:
        // ignore
        return;
    }

    if (
      (job.after_date && job.after_date >= new Date) ||
      (job.after_id && job.prior_status !== 'complete')
    ) {
      dcore(`job ${id} was ready but actually needs to wait`);
      await this.db_jobs.where({ id }).update({ status: 'waiting', updated: this.db.raw('CURRENT_TIMESTAMP') });
      this.waitUntil(job);
      return;
    }

    // TODO: check disambiguator

    dcore(`job ${id} is ready to be scheduled`);

    try {
      const args = JSON.parse(job.arguments);
      let { priority, disambiguator } = job;
      if (priority === 'normal') priority = null;

      await this.db_jobs.where({ id }).update({
        status: 'running',
        updated: this.db.raw('CURRENT_TIMESTAMP'),
        runner_instance: INSTANCE_ID,
      });
      dcore(`job ${id} marked as running`);

      dcore(`job ${id} running with: rpc from core`);
      const result = await this.rpc.request(job.method_name, args, { priority, disambiguator });
      dcore(`job ${id} done running`);

      await this.db_jobs.where({ id }).update({
        status: 'complete',
        updated: this.db.raw('CURRENT_TIMESTAMP'),
        completed: this.db.raw('CURRENT_TIMESTAMP'),
        result_data: JSON.stringify(result),
      });
      dcore(`job ${id} marked as complete`);

      // const successors = await ...
      // if (successors.length) {
      //   const ids = successors.map(({ id }) => id);
      //   dcore(`job ${id} has successors: ${ids.join(', ')}`);
      //   ids.map(id => this.recheckAJob(id });
      // }
    } catch (err) {
      await this.failJob(job);
    }
  }

  async failJob (job, err) {
    const { id } = job.id;
    dcore(`job ${id} failed`);

    const update = {
      status: 'errored',
      updated: this.db.raw('CURRENT_TIMESTAMP'),
      result_data: (err instanceof RpcError)
        ? JSON.stringify(err.toJSON())
        : (err.stack || err.toString())
    };

    if (job.retries < job.max_retries) {
      dcore(`job ${id} can be retried (${job.max_retries - job.retries} left of ${job.max_retries})`);
      update.status = 'ready';
      update.retries = job.retries + 1;
    }

    await this.db_jobs.where({ id }).update(update);
    dcore(`job ${id} marked as ${update.status}`);

    if (update.retries) this.recheckJob(id);
  }

  get currentJobs () {
    return this.db
      .select('current.*', 'prior.status as prior_status')
      .from('pure_gearbox_jobs as current')
      .leftJoin('pure_gearbox_jobs as prior', 'current.after_id', 'prior.id')
      .whereNotIn('current.status', ['errored', 'complete', 'invalid'])
      .where(q => q
        .where('current.after_id', null)
        .orWhere('prior.id', null)
        .orWhere('prior.status', 'complete')
      )
      .orderBy('current.created', 'desc');
  }

  async checkOnJobs () {
    dcore('fetching current job list');
    const jobs = await this.currentJobs;
    dcore(`there are ${jobs.length} current jobs`);
    for (const job of jobs) {
      this.checkJob({ job }).catch(console.error);
    }
  }
}
