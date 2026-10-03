export const INBOUND_QUEUE = "inbound-messages";

export const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export const workerConcurrency = 5;

/** how long /ready waits for Redis before calling it dead */
export const readinessTimeoutMs = 2000;
