CREATE TABLE `gearbox_jobs` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `method_name` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `arguments` text COLLATE utf8mb4_bin,
  `priority` enum('high','normal','low') COLLATE utf8mb4_bin NOT NULL DEFAULT 'normal',
  `created` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` enum('ready','waiting','running','almost-done','errored','complete','invalid','missing','duplicate') COLLATE utf8mb4_bin NOT NULL DEFAULT 'ready',
  `after_date` datetime DEFAULT NULL,
  `after_id` int(10) unsigned DEFAULT NULL,
  `completed` datetime DEFAULT NULL,
  `retries` int(10) unsigned NOT NULL DEFAULT '0',
  `max_retries` int(10) unsigned NOT NULL DEFAULT '0',
  `progress_status` double DEFAULT NULL,
  `progress_updated` datetime DEFAULT NULL,
  `result_data` text COLLATE utf8mb4_bin,
  `disambiguator` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `runner_instance` char(36) COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'UUID of the core or agent instance that''s currently monitoring the run of this job.\n\nUsed when checking if a running job is still being monitored (e.g. detecting when a core/agent has restarted).',
  `retry_delay` int(10) unsigned NOT NULL DEFAULT '1',
  `see_other` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `status` (`status`),
  KEY `created` (`created`),
  KEY `disambiguator` (`disambiguator`),
  KEY `fk_gearbox_jobs_after_id_idx` (`after_id`),
  CONSTRAINT `fk_gearbox_jobs_after_id` FOREIGN KEY (`after_id`) REFERENCES `gearbox_jobs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
