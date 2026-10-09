// Minimal types for the parts of Joplin's turndown fork the tests use.
declare module "@joplin/turndown" {
  export default class TurndownService {
    constructor(options?: Record<string, unknown>);
    use(plugin: unknown): this;
    turndown(node: string | Node): string;
  }
}

declare module "@joplin/turndown-plugin-gfm" {
  export const gfm: unknown;
}
