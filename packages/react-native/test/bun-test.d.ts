declare module "bun:test" {
  export const mock: { module(specifier: string, factory: () => unknown): void };
  export function beforeEach(fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
}
