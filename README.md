# Gearbox

...

## Protocol

The gearbox protocol layers JSON-RPC over Gearman jobs. All data, whether calls
result in success or error, is returned via `WORK_DATA` and underlying gearman
tasks are marked as `WORK_COMPLETE`, unless a hard error occurs.

### `gearbox\core::queue`

Queues a job for scheduling, returns its job id, which is the handle by
which the job can be watched or managed from then on.

#### Params

 - **`name`** (_string_): Method name. (required)
 - **`args`** (_any_): Arguments. (required)
 - **`priority`** (_either of `normal`, `high`, `low`_): Priority.
 - **`disambiguator`** (_string_): Arbitrary string that serves to de-duplicate
   jobs when scheduling. If a job with a disambiguator is running at the time
   another job with that same disambiguator is getting scheduled, the newer job
   will immediately be marked as _duplicate_ of the first.
 - **`after_date`** (_iso8601 string_): If provided, the job will not be
   scheduled before then.
 - **`after_id`** (_unsigned integer_): If provided, the job will not be
   scheduled until the other job described by that ID is complete (that is,
   successful). Note that this doesn't currently work properly with duplicated
   jobs (see **disambiguator** description).
 - **`max_retries`** (_unsigned integer_): If provided, the job will be
   automatically retried up to that number of times until it succeeds. Jobs
   marked _invalid_ or _duplicate_ are not retried.
 - **`retry_delay`** (_unsigned integer_): The time in seconds between each
   retry. Defaults to 1 second.

#### Return

(_unsigned integer_) the job id


### `gearbox\core::watch`

Watches a job until it either completes or fails, then returns its result.

#### Params

 - **`id`** (_unsigned integer_): Job id. (required)
 - **`wait_for_id`** (_boolean_): If true, doesn't immediately fail if the job
   id provided doesn't exist, but instead waits until that id becomes real, and
   then watches that job. May be useful in some race condition situations.

#### Return

(_mixed_) the job result


### `gearbox\core::jobData`

Updates a running job's data, status, or progress. To be used by workers,
usually as an implementation detail of the worker abstraction (data returned
via Gearman's `WORK_DATA` / JSON-RPC for scheduled jobs is ignored & discarded.)

#### Params

 - **`id`** (_unsigned integer_): Job id. (required)
 - **`data`** (_mixed_): Some data to replace the job results with.
 - **`status`** (_either `complete` or `errored`_): If provided, updates
   a running job to that status. Ignored if the job isn't running.
 - **`progress`** (_floating-point number_): If provided, updates the
   job's progress field. (The number is arbitrary but generally is
   interpreted as a percentage out of 100.)

#### Return

Nothing. (Method should be called as a notification.)
