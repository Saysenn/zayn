import { Queue } from "bullmq";
import { defaultJobOptions } from "../config/index.js";
import { redis } from "../system/redis.js";

export const PAYDAY_SEND_QUEUE = "payday-send";

/**
 * One job per person per group, each with its own delay.
 *
 * The alternative — a single job that loops and sleeps between sends — would
 * hold a BullMQ lock for a day and lose its place on any restart. Delayed jobs
 * live in Redis, so the run survives a reboot and each person is independently
 * retryable.
 */
export const paydaySendQueue = new Queue(PAYDAY_SEND_QUEUE, {
  connection: redis,
  defaultJobOptions,
});
