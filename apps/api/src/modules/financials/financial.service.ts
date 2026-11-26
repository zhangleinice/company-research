import type { DepreciationDisclosure } from './depreciation-amortization';
import type { DebtDisclosure } from './debt-disclosure';
import { Injectable } from '@nestjs/common';
import { normalizeCompanyFacts } from './normalize-company-facts';

@Injectable()
export class FinancialService {
  normalize(
    raw: unknown,
    disclosures: readonly DebtDisclosure[] = [],
    sic: string | null = null,
    depreciationDisclosures: readonly DepreciationDisclosure[] = [],
  ) {
    return normalizeCompanyFacts(
      raw,
      disclosures,
      sic,
      depreciationDisclosures,
    );
  }
}
