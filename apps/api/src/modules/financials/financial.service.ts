import { Injectable } from '@nestjs/common';
import { normalizeCompanyFacts } from './normalize-company-facts';

@Injectable()
export class FinancialService {
  normalize(raw: unknown) {
    return normalizeCompanyFacts(raw);
  }
}
