import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from '@nestjs/cache-manager';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GannService } from './gann.service';
import { NseService } from './nse.service';
import { ShoonyaService } from './shoonya.service';
import { HeartbeatService } from './heartbeat.service';
import { PaperTradingService } from './paper.service';
import { ScannerService } from './scanner.service';
import { PrismaService } from './prisma.service';
import { GannAngleService } from './gann-angle.service';
import { Ema5Service } from './ema5.service';
import { CandleBreakoutService } from './candle-breakout.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CacheModule.register()
  ],
  controllers: [AppController],
  providers: [AppService, GannService, NseService, ShoonyaService, HeartbeatService, PaperTradingService, ScannerService, PrismaService, GannAngleService, Ema5Service, CandleBreakoutService],
})
export class AppModule { }
