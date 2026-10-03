import { Queue } from "bullmq";
import { INBOUND_QUEUE, defaultJobOptions } from "../config/index.js";
import { redis } from "./redis.js";

export { INBOUND_QUEUE };

export const inboundQueue = new Queue(INBOUND_QUEUE, {
  connection: redis,
  defaultJobOptions,
});
