import 'vitest';

declare module 'vitest' {
  interface ProvidedContext {
    runId: string;
  }
}
