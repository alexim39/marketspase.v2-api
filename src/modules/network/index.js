/**
 * Public entry for the network slice (downline tree + upline chain).
 * Read-model only: projected directory-safe nodes, no writes.
 */
export { default, buildNetworkRouter } from './interface/Network.routes.js';
export { GetDownlineTreeUseCase, GetUplineChainUseCase } from './application/Network.queries.js';
