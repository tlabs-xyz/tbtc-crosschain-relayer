declare module 'abi-wan-kanabi-v1' {
  const content: unknown;
  export = content;
}

declare module 'abi-wan-kanabi-v1/index' {
  export type TAbi = unknown;
  export type TFunctionName = string;
  export type FunctionArgs<_TAbi = unknown, _TFunctionName = string> = unknown[];
  export const abi: unknown;
  export const f: unknown;
  export const args: unknown;
}

declare module 'abi-wan-kanabi-v1/kanabi' {
  export type PrimitiveTypeLookup<_TAbi = unknown> = unknown;
  export type Abi = unknown;
}
