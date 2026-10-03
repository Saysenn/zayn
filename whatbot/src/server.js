import { buildApp } from "./http/app.js";
import { env } from "./config/index.js";
import { logger, installProcessErrorHandlers } from "./system/logger.js";
import { printBanner } from "./system/banner.js";

printBanner("web", { mode: env.NODE_ENV, port: env.PORT });

installProcessErrorHandlers("web");

const app = buildApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "web process listening");
});

// finish whatever requests are mid-flight before actually exiting
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down web process");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
