import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PrismaService.name);

    async onModuleInit() {
        await this.$connect();
        this.logger.log('📦 Connected to Prisma SQLite Database.');
        await this.runMigrations();
    }

    private async runMigrations() {
        const cols = [
            `ALTER TABLE "ShoonyaConfig" ADD COLUMN IF NOT EXISTS "candleNiftyLots" INTEGER NOT NULL DEFAULT 1`,
            `ALTER TABLE "ShoonyaConfig" ADD COLUMN IF NOT EXISTS "candleBankNiftyLots" INTEGER NOT NULL DEFAULT 1`,
        ];
        for (const sql of cols) {
            try { await this.$executeRawUnsafe(sql); } catch { /* column already exists */ }
        }
    }

    async onModuleDestroy() {
        await this.$disconnect();
        this.logger.log('📦 Disconnected from Prisma Database.');
    }
}
