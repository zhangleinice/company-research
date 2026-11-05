import { Module } from '@nestjs/common';
import { SecClient } from './sec.client';
import { SecService } from './sec.service';

@Module({ providers: [SecClient, SecService], exports: [SecService] })
export class SecModule {}
