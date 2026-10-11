export class Exit extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}
export const fail = (message: string, code = 1): never => { throw new Exit(message, code); };
