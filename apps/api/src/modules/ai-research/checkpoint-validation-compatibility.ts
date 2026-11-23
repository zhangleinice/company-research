/** Audited, exact validator-only transitions. A different future validator is NOT implicitly compatible.
 * Schema, prompt, model, input and plan must still match; all retained outputs are revalidated.
 * Source/Jest and compiled/Nest fingerprints are listed separately. */
const transitions: ReadonlyArray<readonly [string, string]> = [
  [
    '47bc6fb7ec82e37b9dc7a2809c031b931fb81bd2cb029c88925bbbd68a79dc05',
    '928365eb81b9b758f4b833317bf8e24dceb57bb396946e716ae8fc7c6c5b8f5f',
  ],
  [
    '0dd08158dbb6273096ba0f0804a6b6e2fed47a5fe25006f5cf0681a730f4de5a',
    'f457bab30b8467e8cdbf4f6f3b1d62fd6dd565a1e4448f5970c1be9bd0e3306c',
  ],
];
export const compatibleValidationUpgrade = (from: unknown, to: unknown) =>
  transitions.some(
    ([previous, current]) => from === previous && to === current,
  );
