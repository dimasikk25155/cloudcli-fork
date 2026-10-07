// API responses must never come from the browser HTTP cache. Express adds an
// ETag, so the browser revalidates, gets a 304 and replays the stored response
// with its stored headers — including an old X-Refreshed-Token. The client then
// saves that expired token and the next /api/auth/user call bounces the user
// back to the login form right after a successful login.
const noStoreApi = (req, res, next) => {
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
};

export { noStoreApi };
