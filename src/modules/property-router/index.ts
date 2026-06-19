export {
  routeInboundContact,
  resolvePropertyByDid,
  listRoutesForProperty,
  selectRoute,
  normalizeDid,
  type ContactChannel,
  type InboundContact,
  type RouteDecision,
  type RoutingRow,
} from "./service";
export {
  upsertMapping,
  deactivateMapping,
  listMappings,
  type UpsertMappingInput,
} from "./mapping";
export { default as propertyRouterRoutes } from "./routes";
