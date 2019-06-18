'use strict';
import knex from 'knex';

export const JOBS_TABLE = process.env.DB_TABLE_JOBS || 'gearbox_jobs';

export default function connect () {
  return knex({
    client: 'mysql2',
    connection: {
      host: process.env.MYSQL_HOSTNAME,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE
    }
  });
}
