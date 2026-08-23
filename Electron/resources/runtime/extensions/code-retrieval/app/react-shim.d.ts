declare module "react" {
  export function useState<T>(initial: T | (() => T)): [T, (value: T) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
}

declare module "react/jsx-runtime" {
  export function jsx(type: unknown, props: unknown, key?: unknown): unknown;
  export function jsxs(type: unknown, props: unknown, key?: unknown): unknown;
  export function Fragment(props: { children?: unknown }): unknown;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: Record<string, unknown> | null | undefined;
  }
}
