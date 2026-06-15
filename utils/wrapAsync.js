'use strict';

/**
 * Wraps an async route handler to forward rejected promises to Express error handling.
 */
module.exports = (fn) => {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
};
