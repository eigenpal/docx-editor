export class HeadlessRepackRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'HeadlessRepackRefusal';
    this.code = code;
  }
}
