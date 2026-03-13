declare module 'nspell' {
  export interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): void;
  }

  export default function nspell(dictionary: { aff: string; dic: string }): NSpell;
}
