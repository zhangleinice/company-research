/** Conservative evidence recognition, not an amount parser or an event classifier. */
const instrument =
  /\b(debt|notes?|bonds?|loans?|borrowings?|commercial paper|credit facilit(?:y|ies)|credit lines?|capital)\b/i;
const pastAction = /\b(?:issued|borrowed|repaid|redeemed)\b/i;
const cashReceipt =
  /\b(?:received|raised)\b(?:\s+(?:net|gross|total))?(?:\s+[$€£]?\d[\d,.]*\s*(?:million|billion)?)?\s+(?:cash\s+)?(?:proceeds|funds|cash|capital|loans?|debt financing|financing)\b/i;
const nominalAction =
  /\b(?:proceeds from (?:the )?(?:(?:issuance|issuances|issuing) of|debt issuance)|issuance of|repayments? of|redemptions? of|borrowings? under)\b/i;
const hypothetical =
  /\b(?:no|not|never|none|nothing|neither|without|zero|nil|undrawn|unused|unutilized|unfunded|unissued|will|would|may|might|could|plans?|planned|planning|expects?|expected|anticipates?|anticipated|intends?|intended|proposed|potential|future|forecast|budgeted|authorized|authorization|permission|permitted|scheduled|if|subject to|conditional|contingent)\b/i;
const capacity =
  /\b(?:available|availability|capacity|limits?|authorization)\b/i;
const genericDescription =
  /\b(?:consists? primarily|consists? of|typically|generally|can include|may include)\b/i;
const realizedContext =
  /\b(?:was|were|had|totaled|totalled|amounted|completed|increased|decreased|provided|used|recorded|generated|paid)\b/i;
export function hasActualFinancingEvidence(quotes: string[]): boolean {
  // Evaluate each quote on its own: separate evidence fragments cannot invent a sentence.
  return quotes.some((quote) =>
    quote
      .split(
        /[.!?](?=\s+[A-Z]|$)|;|\n|,?\s+\bbut\b\s+|,?\s+and\s+(?=(?:we\s+)?(?:may|will|expect|plan|intend)\b)/i,
      )
      .some((clause) => {
        if (
          !instrument.test(clause) ||
          hypothetical.test(clause) ||
          genericDescription.test(clause)
        )
          return false;
        if (pastAction.test(clause) || cashReceipt.test(clause)) {
          if (
            /\bissued\b/i.test(clause) &&
            !/\b(?:debt|notes?|bonds?|commercial paper|securities)\b/i.test(
              clause,
            )
          )
            return false;
          return true;
        }
        if (
          /\bborrowings? under\b/i.test(clause) &&
          /\b(?:as of|outstanding|balance)\b/i.test(clause)
        )
          return false;
        return (
          nominalAction.test(clause) &&
          !capacity.test(clause) &&
          realizedContext.test(clause)
        );
      }),
  );
}
