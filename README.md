# Gearbox

Running an intermediary daemon and an advanced job protocol on top of [Gearman]
and a (My)SQL table, Gearbox provides job scheduling, job dependency, retries,
the possibility of advanced analytics and a complete monitoring and audit trail
for your job system.

The protocol is fairly simple to implement, and there is a full suite of
ready-made command-line tools to hit the ground running.

[Gearman]: http://gearman.org/

## Good to know

 - Jobs pre-emptively fail if the Gearman function to run them is not available
   when they’re ready for scheduling. This is in contrast to Gearman, which
   will queue the job until the function is available.

 - Jobs can depend on other jobs in two different ways: `after` requirements
   and `before` requirements. A job can only have one of each, but together
   these two low-level controls compose into useful patterns. Both requirements
   declare that a job may only run after one or some others have completed:
   `after` is N:1 (many jobs running after one), `before` is 1:N (one job
   running only after N others are all done).

 - The special `gearbox\core::noop` method discards all input, returns only `null`,
   and is always available. It can be used as a meta job for dependency
   composition, or for testing.

## Tools

All tools log to the console, and also have [a debug facility][debug]. Generally
debugging can be enabled by running with the `DEBUG=gearbox:*` env variable, and
SQL queries can be shown with `DEBUG=knex:query`.

While methods formally follow the `name\space::method` format, in command-line
arguments they can be written with forward slashes instead (`name/space::method`)
for ease of use and to avoid escaping.

Coming from Gearman, the `disambiguator` of a job is like the `uniqueid`, except
that in the case of scheduled or dependent jobs, two jobs with the same
disambiguator can be input so long as they're not scheduled to run immediately,
and if one job later becomes schedulable while another with the same
disambiguator is current running, the former is marked as a duplicate of the
latter, and `watch` queries are redirected transparently.

[debug]: https://www.npmjs.com/package/debug

### g-core

The Gearbox daemon. Connects to MySQL, connects to Gearman, and manages the lot.

Takes no options, instead is controlled via the environment:

 - MySQL connection:
   + `MYSQL_HOSTNAME`
   + `MYSQL_DATABASE`
   + `MYSQL_USER`
   + `MYSQL_PASSWORD`
 - Gearman connection (also used by other tools below):
   + `GEARMAN_SERVER`


### g-client

A full command-line client to the gearbox interface. You can:

 - **`queue`** jobs, which displays a job ID and returns immediately;
 - **`watch`** jobs, which waits for a job given its ID and prints its output;
 - **`run`** jobs, which does both of the above in one convenient command;
 - issue **`raw`** gearbox RPC calls, for advanced use or debugging;
 - get the **`status`** of all current jobs or of specific job IDs;
 - get some **`stats`** about a method, including average run times and current use.

You can watch jobs several times! That is, you can:

```bash
# Queue a job...
$ g-client queue a::job
...
==> Job ID: 208

# Watch it...
$ g-client watch 208

# In another terminal, on another machine, watch it also:
$ g-client watch 208

# ^ both of these will return and print the job's output when the job ends.
```

You can also "watch" a completed (or errored) job after the fact, which will
return immediately and print the job's output.

When passing arguments for jobs:

 - `a b c` is interpreted as `["a", "b", "c"]`;
 - `a=b c=d` is interpreted as `{"a": "b", "c": "d"}`;
 - `a=b c` is interpreted as `{"a": "b", "c": null}`;
 - `1 2 3` is interpreted as `["1", "2", "3"]`;
 - `1 2 3` with `-J` is interpreted as `[1, 2, 3]`;
 - `a=true c` with `-J` is interpreted as `{"a": true, "c": null}`;
 - `'{"a":[123,true]}'` with `-J` is interpreted as `{"a":[123,true]}`;
 - `'{"a":[123,true]}'` without `-J` is interpreted as `"{"a":[123,true]}"`.


### g-worker

Operates a single gearbox method based on command-line arguments.

```
Usage: worker [options] <name/space::method> <command> [arguments...]

Options:
  --help             Show help                                         [boolean]
  --version          Show version number                               [boolean]
  --concurrency, -j  how many jobs can run at the same time.
                                                           [number] [default: 1]
  --input, -I        handle job input
            [choices: "stdin", "append", "prepend", "ignore"] [default: "stdin"]
  --output, -O       handle command output
  [choices: "string", "buffer", "json", "nl-json", "ignore"] [default: "string"]
  --log              log every run to a file                            [string]
  --log-output       also write the output of each job to the log      [boolean]
  --log-no-time      don’t prepend timestamps to log lines             [boolean]
  --quiet, -q        output minimally                                  [boolean]
```

See the multiworker option description below for details.


### g-multiworker

Reads one or more [TOML] configuration files and sets up methods and workers
as described. Supports reloading the config via signal and gearman job.

[TOML]: https://github.com/toml-lang/toml#objectives

```bash
$ g-multiworker /path/to/config.toml
```

Here's a sample config file:

```toml
[config]
reload_worker = true

[Test.sleep]
command = "sleep"
input = "append"
output = "ignore"
concurrency = 4

[Test.Foo.echo]
command = "echo test"
input = "append"
concurrency = 10

[Php.eval]
command = ['php', '-R', '$expr = implode(" ", json_decode($argn)); echo json_encode(eval("return $expr;"))."\n";']
output = "nl-json"
concurrency = 1
log = "/var/log/gearbox/php_eval.log"
log_output = true
```

This defines three methods:

 - `Test::sleep` runs `sleep` in a shell (`command` is a string) with any
   arguments the job brings as inputs appended to the command string. It
   discards (`ignore`) any output from the command, and up to 4 jobs run
   at the same time.

 - `Test\Foo::echo` runs `echo test` in a shell with job inputs appended
   to the command. It interprets the output of the command as a string and
   can run up to 10 jobs at once.

 - `Php::eval` runs `php -R ...` as a direct program call (which is safer)
   with job input passed to the program on STDIN. It interprets the output
   of the command as newline-separated JSON and can only run one at a time.
   It also writes a full log, including job output, to /var/log/gearbox/...

#### Global options

 - **`reload_worker`** (_boolean_): Installs a method called `gearbox\reloadmw::UUID`
   where `UUID` is the instance ID (randomised at tool start) which reloads the
   configuration files and updates the workers when called.

#### Method options

 - **`command`**: What the method runs for each job. (Required.)
   There are several forms:
   + (_string_) Runs the command within a shell (usually `/bin/sh`).
     `input=prepend` is not available in this form.
   + (_array of strings_) Runs the command directly, where the first string is
     the program, and any others are arguments.
 - **`input`** (_string_): How job inputs are handled. Defaults to `stdin`:
   + `stdin`: Writes the inputs as JSON to STDIN I/O.
   + `append`: Transforms the inputs to strings\* and appends them to the arguments.
   + `prepend`: Transforms the inputs to strings\* and prepends them to the arguments.
   + `ignore`: Discards any inputs.
 - **`output`** (_string_): How job output is handled. Defaults to `string`:
   + `string`: Sent back as a string.
   + `buffer`: Sent back as a byte array, of the form `{"type":"Buffer","data":[byte,byte,byte]}`
     where bytes are integers. This is more appropriate than `string` for binary data.
   + `json`: Parsed as JSON (_will throw if malformed!_) and sent back as such.
   + `nl-json`: Each line is parsed as JSON (_will throw!_) and collected in an array.
   + `ignore`: Discarded.
 - **`log`** (_string_): Logs job events to a file.
 - **`log_output`** (_boolean_): With `log`, also writes the output of each job
   to the log, even if `output = ignore`.
 - **`log_no_time`** (_boolean_): With `log`, don't prepend timestamps to log lines.
 - **`concurrency`** (_unsigned integer_): How many jobs can run in parallel in
   this multiworker instance. (NB. this doesn't control how many jobs can run
   across the entire gearman cluster, nor even for other multiworkers.) If this
   is zero or less, will disable the method.
 - **`disabled`** (_boolean_): If true, the method is ignored.

TOML parsing errors will crash the multiworker, schema errors will only skip the
relevant method definition.


## Protocol

The gearbox protocol layers [JSON-RPC] over Gearman jobs. All data, whether calls
result in success or error, is returned via `WORK_DATA` and underlying gearman
tasks are marked as `WORK_COMPLETE`, unless a hard error occurs.

[JSON-RPC]: https://www.jsonrpc.org/specification

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
   successful). If the other job fails (errors and cannot be retried anymore),
   this job will also be marked as failed. Note that this doesn't currently
   work properly with duplicated jobs (see **disambiguator** description).
 - **`before_id`** (_unsigned integer_): If provided, the job described by that
   ID will not be scheduled until this and all other jobs with this `before_id`
   are complete (that is, successful). If jobs within that “pool” fail, the
   descendent job will be marked as failed, but only once all jobs within the
   pool have completed or failed.
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


### `gearbox\core::status`

Returns status information about jobs. By default returns the status of all
current (running and scheduled) jobs.

#### Params

An _array_ of job ids (_unsigned integers_).

#### Return

An array of status objects, like so:

```json
[{
  "id": 115,
  "method_name": "sample::method",
  "arguments": [
    "a",
    "b",
    "c"
  ],
  "priority": "normal",
  "created": "2019-06-18T02:25:18.000Z",
  "updated": "2019-06-18T02:25:18.000Z",
  "status": "running",
  "after_date": null,
  "after_id": null,
  "before_id": null,
  "completed": null,
  "retries": false,
  "disambiguator": "1984d092-5f6b-4e45-8672-bcc402df2fe4",
  "progress": false,
  "data": null
}]
```


### `gearbox\core::stats`

Returns current and historical stats about a particular method.

#### Params

 - **`method`** (_string_): Method. (required)

#### Return

 - **`totalRuns`** (_unsigned integer_): Total number of jobs ever run for this method.
 - **`earliest`** (_iso8601 string_): Earliest run of this method.
 - **`latest`** (_iso8601 string_): Latest run of this method.
 - **`averageCompletionTime`** (_floating-point number_): In seconds.
 - **`averageRetries`** (_floating-point number_).
 - **`stdAverageCompletionTime`** (_floating-point number_): Averages normalised without outliers.
 - **`stdAverageRetries`** (_floating-point number_): Averages normalised without outliers.
 - **`states`** (_object_): Count of jobs in each status.


### Jobs

The payload a worker gets per job is an RPC request:

```json
{
   "jsonrpc": "2.0",
   "method": "Name\\Space::method",
   "id": 12345,
   "_meta": {
      "gearbox_id": 987
   },
   "params": ...
}
```

Workers _must_ provide the contents of `params` to the actual job, _may_ do
some processing to present these more cromulently to the expectant application,
and _may_ provide the `_meta` contents as an additional argument. They _should
not_ provide access to the rest of the RPC envelope.

Workers _must_ run the job then answer with an RPC response as `WORK_DATA`, and
end the job as `WORK_COMPLETE`, regardless of the actual status of the job. The
RPC `result` field _should_ be `null`. Note that jobs are requests, _not_ RPC
notifications: the worker _must_ answer.

Workers _may_ send an RPC error back with `WORK_COMPLETE`, but that should be
reserved for worker failure, i.e. _not_ for application errors.

Workers _may_ end the job as `WORK_ERROR` as a last resort. In that case, the
payload need not necessarily be formatted as JSON-RPC, and will be assumed an
error in any case if it is received by gearbox.

```json
{
   "jsonrpc": "2.0",
   "id": 12345,
   "result": null
}
```

Job data and status _must_ be returned via a gearman background job, with an
RPC notification payload, to the method `gearbox\core::job_data`, as described
in its documentation above. Whenever possible, that notification _should_ be
sent **after** the gearman job is ended (e.g. with `setImmediate` in Node to
run on next tick).
