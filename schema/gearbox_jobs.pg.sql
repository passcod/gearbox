CREATE TYPE gearbox_priority AS ENUM (
  'high',
  'normal',
  'low'
);

CREATE TYPE gearbox_status AS ENUM(
  'ready',
  'waiting',
  'running',
  'almost-done',
  'errored',
  'complete',
  'invalid',
  'missing',
  'duplicate'
);

CREATE TABLE gearbox_jobs (
  id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  method_name text NOT NULL,
  arguments text,
  priority gearbox_priority NOT NULL DEFAULT 'normal',
  created timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status gearbox_status NOT NULL DEFAULT 'ready',
  after_date timestamp with time zone DEFAULT NULL,
  after_id integer DEFAULT NULL,
  before_id integer DEFAULT NULL,
  completed timestamp with time zone DEFAULT NULL,
  retries integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 0,
  progress_status double precision DEFAULT NULL,
  progress_updated timestamp with time zone DEFAULT NULL,
  result_data text,
  dedupe text NOT NULL,
  runner_instance text DEFAULT NULL,
  retry_delay integer NOT NULL DEFAULT 1,
  see_other integer DEFAULT NULL,

  CONSTRAINT fk_gearbox_jobs_after_id FOREIGN KEY (after_id) REFERENCES gearbox_jobs (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_gearbox_jobs_before_id FOREIGN KEY (before_id) REFERENCES gearbox_jobs (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX status_idx ON gearbox_jobs (status);
CREATE INDEX created_idx ON gearbox_jobs (created);
CREATE INDEX dedupe_idx ON gearbox_jobs (dedupe);

COMMENT ON COLUMN gearbox_jobs.runner_instance 'UUID of the core or agent instance that is currently monitoring the run of this job.\n\nUsed when checking if a running job is still being monitored (e.g. detecting when a core/agent has restarted).';
