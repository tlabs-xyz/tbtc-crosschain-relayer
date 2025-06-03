declare module 'abi-wan-kanabi-v1' {
  const content: any;
  export = content;
}

declare module 'abi-wan-kanabi-v1/index' {
  export type TAbi = any;
  export type TFunctionName = any;
  export type FunctionArgs<TAbi, TFunctionName> = any[];
  export const abi: any;
  export const f: any;
  export const args: any;
}

declare module 'abi-wan-kanabi-v1/kanabi' {
  export type PrimitiveTypeLookup<TAbi> = any;
  export type Abi = any;
}
