import { Module } from '@nestjs/common';
import { SecClient } from './sec.client';
import { SecService } from './sec.service';

@Module({ providers: [SecClient, SecService], exports: [SecService, SecClient] })
export class SecModule {}
