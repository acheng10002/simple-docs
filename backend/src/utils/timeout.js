/**
 * Timeout wrapper for promises
 */
function withTimeout(promise, ms, operation) {
  let timer;
  return Promise.race([
    promise.then(
      (val) => { clearTimeout(timer); return val; },
      (err) => { clearTimeout(timer); throw err; }
    ),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${operation} timeout after ${ms}ms`)),
        ms
      );
    }),
  ]);
}

module.exports = { withTimeout };
