/**
 * Wraps async route handlers so rejected promises reach the
 * central `errorMiddleware` instead of crashing Express 4.
 * @param {(req:any,res:any,next:any)=>Promise<any>} fn
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
