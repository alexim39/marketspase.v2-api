/**
 * Public entry for the community slice (internal social network).
 * Visibility derives from the network (team) and the ladder (leadership);
 * recognition posts are minted by progression + training business events.
 */
export { default, buildCommunityRouter } from './interface/Community.routes.js';
export { RecognitionUseCases } from './application/Community.usecases.js';
