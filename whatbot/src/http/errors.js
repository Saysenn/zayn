/** got all the way to the bottom without matching any route */
export const notFound = (_req, res) => {
  res.status(404).json({ error: "not_found" });
};

/**
 * Last line of defence.
 *
 * Logs the real error on our side, sends back something generic. A stack trace
 * in the response tells whoever is poking at the server how it's built.
 *
 * Express 5 sends async errors here on its own. Express 4 didn't.
 */
export const onError = (err, req, res, _next) => {
  req.log.error({ err }, "unhandled error");
  res.status(500).json({ error: "internal_error" });
};
