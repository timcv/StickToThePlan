// Ambient module declaration for @garmin/fitsdk.
//
// The package ships ESM type declarations whose index.d.ts re-exports its classes with
// extensionless `export *` paths. NodeNext module resolution cannot follow those, so the
// named members (Decoder, Stream, Encoder, Profile) appear missing to tsc even though they
// exist at runtime: index.js does `export { CrcCalculator, Decoder, Encoder, Stream, ... }`.
// This declaration restores the members we use. Runtime is unaffected.
declare module '@garmin/fitsdk' {
  export class Stream {
    static fromByteArray(data: number[] | Uint8Array): Stream;
    static fromBuffer(data: Uint8Array): Stream;
  }
  export class Decoder {
    constructor(stream: Stream);
    read(options?: Record<string, unknown>): { messages: Record<string, any[]>; errors: unknown[] };
    isFIT?(): boolean;
    checkIntegrity?(): boolean;
  }
  export class Encoder {
    constructor(options?: Record<string, unknown>);
    writeMesg(mesg: Record<string, unknown>): this;
    onMesg(mesgNum: number, mesg: Record<string, unknown>): this;
    close(): Uint8Array;
  }
  export const Profile: { MesgNum: Record<string, number>; [key: string]: unknown };
  export const Utils: Record<string, unknown>;
}
