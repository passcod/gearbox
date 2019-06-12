'use strict';
import knex from 'knex';

export default function connect ({
  user, password,
  host = 'sql.ubercontrol.ubergroup.co.nz',
  database = 'ucontrol_production'
} = {}) {
  return knex({
    client: 'mysql2',
    connection: {
      host,
      user,
      password,
      database
    }
  });
}
