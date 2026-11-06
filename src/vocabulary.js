// The vocabularies this build was compiled against, as one import for hosts.
//
// `HaivenClient` requires its vocabulary rather than defaulting it (see
// client.js), so a host has to get the registered values from somewhere. They
// are emitted from haiven-contracts by codegen/emit-vocabulary.mjs; this module
// only re-exports them so a host depends on the package, not on the codegen
// tree's layout.
export * from "./generated/vocabulary/ErrorCode.js";
export * from "./generated/vocabulary/WsErrorCode.js";
export * from "./generated/vocabulary/MessageType.js";
